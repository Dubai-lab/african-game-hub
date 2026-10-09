# Publishes one commit of the game server (server/) to the machine in Cape Town.
#
#   npm run deploy:server                 the commit that origin/main points at
#   npm run deploy:server -- -Commit abc1234
#
# The commit must already be pushed to GitHub: the machine fetches it from there, builds the
# Docker image itself, stops the running container and starts the new one. If the new one does
# not report healthy within a minute, the machine starts the previous image again and this
# command fails. Players are not cut off: while the server is away the app plays through the
# Edge Functions and reconnects by itself (see server/README.md).
#
# The machine and its alarms are created once from infra/game-server.yaml (stack agh-game-server).
# If AWS says the session has expired, run:  aws login --profile myprofile
param(
  [string]$Commit = '',
  [string]$Profile = 'myprofile',
  [string]$Region = 'af-south-1'
)

$ErrorActionPreference = 'Stop'
function Step($text) { Write-Host "`n== $text" -ForegroundColor Cyan }
function Check($what) { if ($LASTEXITCODE -ne 0) { throw "$what failed (exit code $LASTEXITCODE)" } }

if (-not $Commit) {
  git -C $PSScriptRoot fetch origin --quiet
  $Commit = git -C $PSScriptRoot rev-parse origin/main
  Check 'Reading origin/main'
}
if ($Commit -notmatch '^[0-9a-f]{7,40}$') { throw "Not a commit id: $Commit" }

Step 'Finding the machine'
$instance = aws cloudformation describe-stacks --stack-name agh-game-server --profile $Profile --region $Region --query "Stacks[0].Outputs[?OutputKey=='InstanceId'].OutputValue" --output text
Check 'Reading the stack'
Write-Host "$instance, commit $Commit"

Step 'Building and starting it on the machine (two to four minutes)'
# Waits for the machine's first-boot setup if it is brand new, then runs the deploy program on it.
$commands = '{"commands":["cloud-init status --wait >/dev/null 2>&1 || true","/usr/local/bin/agh-deploy ' + $Commit + '"],"executionTimeout":["900"]}'
$parameterFile = Join-Path ([IO.Path]::GetTempPath()) "agh-deploy-$PID.json"
[IO.File]::WriteAllText($parameterFile, $commands)
try {
  $id = aws ssm send-command --instance-ids $instance --document-name AWS-RunShellScript --comment "deploy $Commit" --parameters "file://$parameterFile" --profile $Profile --region $Region --query 'Command.CommandId' --output text
  Check 'Sending the command'
} finally { Remove-Item $parameterFile -ErrorAction SilentlyContinue }

$status = 'Pending'
while ($status -in 'Pending', 'InProgress', 'Delayed') {
  Start-Sleep -Seconds 8
  $status = aws ssm get-command-invocation --command-id $id --instance-id $instance --profile $Profile --region $Region --query 'Status' --output text
}
$output = aws ssm get-command-invocation --command-id $id --instance-id $instance --profile $Profile --region $Region --query '[StandardOutputContent, StandardErrorContent]' --output text
Write-Host $output
if ($status -ne 'Success') { throw "The deploy did not succeed (status: $status). The machine keeps running the previous version if there was one." }

Step 'Done'
Write-Host "Game server is running commit $Commit" -ForegroundColor Green
