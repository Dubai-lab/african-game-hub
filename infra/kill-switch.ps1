# The kill switch: takes a site offline, or brings it back, without deleting anything.
#
#   npm run aws:off                 both sites offline
#   npm run aws:on                  both sites back
#   npm run aws:off -- -Site admin  one site only (player or admin)
#
# Use it if a budget alert arrives and you do not yet know why. A switched-off CloudFront
# distribution answers nobody, so it serves no data and costs nothing; the files stay in S3.
# CloudFront stops answering within a minute or two; the command itself waits about five minutes
# for every edge location to confirm.
param(
  [ValidateSet('player', 'admin', 'all')] [string]$Site = 'all',
  [switch]$On,
  [string]$Profile = 'myprofile',
  [string]$Region = 'eu-north-1'
)

$ErrorActionPreference = 'Stop'
$template = Join-Path $PSScriptRoot 'site.yaml'
$enabled = if ($On) { 'true' } else { 'false' }
$sites = if ($Site -eq 'all') { @('player', 'admin') } else { @($Site) }

foreach ($name in $sites) {
  Write-Host "`n== agh-$name -> $(if ($On) { 'ON' } else { 'OFF' })" -ForegroundColor Cyan
  # Only this one setting is given; the stack keeps its other settings as they are.
  aws cloudformation deploy --stack-name "agh-$name" --template-file $template --parameter-overrides "Enabled=$enabled" --profile $Profile --region $Region --no-fail-on-empty-changeset
  if ($LASTEXITCODE -ne 0) { throw "Switching agh-$name failed (exit code $LASTEXITCODE)" }
}
