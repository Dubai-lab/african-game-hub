# Builds one of the two sites and publishes it to AWS (S3 + CloudFront).
#
#   npm run deploy:player        the player site
#   npm run deploy:admin         the admin site
#
# The AWS resources themselves are created once from infra/site.yaml (stacks agh-player and
# agh-admin); this script only reads their names and uploads files. If AWS says the session has
# expired, run:  aws login --profile myprofile
param(
  [ValidateSet('player', 'admin')] [string]$Site = 'player',
  [string]$Profile = 'myprofile',
  [string]$Region = 'eu-north-1',
  [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$stack = "agh-$Site"
$dist = if ($Site -eq 'admin') { Join-Path $root 'admin\dist' } else { Join-Path $root 'dist' }

function Step($text) { Write-Host "`n== $text" -ForegroundColor Cyan }
function Check($what) { if ($LASTEXITCODE -ne 0) { throw "$what failed (exit code $LASTEXITCODE)" } }

# --- 1. Where to publish: read the bucket, distribution and address from the stack -------------
Step "Reading stack $stack"
$json = aws cloudformation describe-stacks --stack-name $stack --profile $Profile --region $Region --query 'Stacks[0].Outputs' --output json
Check 'Reading the stack'
$out = @{}
($json | Out-String | ConvertFrom-Json) | ForEach-Object { $out[$_.OutputKey] = $_.OutputValue }
$bucket = $out['SiteBucketName']; $distId = $out['DistributionId']; $siteUrl = $out['SiteUrl']
if (-not $bucket -or -not $distId -or -not $siteUrl) { throw "Stack $stack has no bucket, distribution or address" }
Write-Host "$siteUrl  (bucket $bucket, distribution $distId)"

# --- 2. Build -----------------------------------------------------------------------------------
if (-not $SkipBuild) {
  Step "Building the $Site site"
  # A variable set here wins over the same line in .env.local, so link previews carry the real
  # address instead of localhost. The Supabase URL and anon key still come from .env.local.
  $env:VITE_SITE_URL = $siteUrl
  # Player site only: live games use the game server in Cape Town (see server/README.md). It is
  # set here and not in .env.local, so the site on a developer's machine keeps using the Edge
  # Functions. To switch the game server off for players, remove this line and deploy again.
  if ($Site -eq 'player') { $env:VITE_GAME_SERVER_URL = 'wss://d2xirivzgoo9lw.cloudfront.net/ws' }
  if ($Site -eq 'admin') { npm --prefix (Join-Path $root 'admin') run build } else { npm --prefix $root run build }
  Check 'The build'
}
if (-not (Test-Path (Join-Path $dist 'index.html'))) { throw "Nothing to publish: $dist\index.html is missing" }

# --- 3. Refuse to publish a secret --------------------------------------------------------------
# Only the public anon key belongs in a website. If any server-side secret from .env.local has
# found its way into the built files, stop before it reaches the internet.
Step 'Checking the build for secrets'
$secrets = @{}
$envFile = Join-Path $root '.env.local'
if (Test-Path $envFile) {
  Get-Content $envFile | Where-Object { $_ -match '^\s*(SUPABASE_SERVICE_ROLE_KEY|SUPABASE_ACCESS_TOKEN|SMTP_PASS|GAME_SERVER_KEY|LEDGER_BACKUP_KEY)\s*=\s*(.+)$' } | ForEach-Object {
    $value = $Matches[2].Trim().Trim('"').Trim("'")
    if ($value.Length -ge 8) { $secrets[$Matches[1]] = $value }
  }
}
$textFiles = Get-ChildItem $dist -Recurse -File | Where-Object { $_.Extension -in '.js', '.html', '.css', '.json', '.map', '.webmanifest', '.txt' }
foreach ($file in $textFiles) {
  $text = [IO.File]::ReadAllText($file.FullName)
  foreach ($name in $secrets.Keys) {
    if ($text.Contains($secrets[$name])) { throw "STOP: $name is inside $($file.FullName). Nothing was uploaded." }
  }
  if ($text -match 'sb_secret_[A-Za-z0-9_-]{16,}') { throw "STOP: a Supabase secret key is inside $($file.FullName). Nothing was uploaded." }
  foreach ($m in [regex]::Matches($text, 'eyJ[A-Za-z0-9_-]{10,}\.(eyJ[A-Za-z0-9_-]{10,})\.[A-Za-z0-9_-]{10,}')) {
    $b64 = $m.Groups[1].Value.Replace('-', '+').Replace('_', '/'); while ($b64.Length % 4) { $b64 += '=' }
    try { $payload = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($b64)) } catch { $payload = '' }
    # The only key a website may carry is the public one. Any other role is a server's key.
    if ($payload -match '"role"\s*:\s*"(service_role|game_server|ledger_backup)"') { throw "STOP: a $($Matches[1]) key is inside $($file.FullName). Nothing was uploaded." }
  }
}
Write-Host "$($textFiles.Count) files checked, no secrets found"

# --- 4. Upload ----------------------------------------------------------------------------------
# Each file is stored with a Cache-Control header that tells phones and CloudFront how long they
# may keep it. The less often a file is fetched again, the less data players use and the less
# CloudFront serves.
$s3 = "s3://$bucket"
$forever = 'public, max-age=31536000, immutable'   # hashed names: new content always has a new name
$month = 'public, max-age=2592000'
$recheck = if ($Site -eq 'admin') { 'no-store' } else { 'no-cache' }   # entry files: always ask for the latest
$common = @('--profile', $Profile, '--region', $Region, '--only-show-errors')

Step 'Uploading'
# Old hashed files are left in place on purpose: a phone still running yesterday's page can
# finish loading it. They cost nothing measurable.
aws s3 sync (Join-Path $dist 'assets') "$s3/assets" --cache-control $forever @common
Check 'Uploading assets'
if ($Site -eq 'player') {
  foreach ($folder in 'sounds', 'engine', 'landing') {
    aws s3 sync (Join-Path $dist $folder) "$s3/$folder" --cache-control $month --exclude '*.wasm' --delete @common
    Check "Uploading $folder"
  }
  # Browsers only compile WebAssembly quickly when it is labelled as such.
  aws s3 cp (Join-Path $dist 'engine') "$s3/engine" --recursive --exclude '*' --include '*.wasm' --content-type 'application/wasm' --cache-control $month @common
  Check 'Uploading the chess engine'
}
# Everything at the top level: the entry pages, the service worker, the icons.
aws s3 sync $dist $s3 --cache-control $recheck --delete --exclude 'assets/*' --exclude 'sounds/*' --exclude 'engine/*' --exclude 'landing/*' --exclude '*.webmanifest' @common
Check 'Uploading the entry files'
if ($Site -eq 'player') {
  aws s3 cp (Join-Path $dist 'manifest.webmanifest') "$s3/manifest.webmanifest" --content-type 'application/manifest+json' --cache-control $recheck @common
  Check 'Uploading the manifest'
}

# --- 5. Tell CloudFront the entry files changed -------------------------------------------------
# Only the few files without a hash in their name. The first 1,000 paths a month are free.
Step 'Refreshing CloudFront'
$paths = if ($Site -eq 'admin') { @('/', '/index.html') } else { @('/', '/index.html', '/app.html', '/sw.js', '/registerSW.js', '/manifest.webmanifest') }
$invalidation = aws cloudfront create-invalidation --distribution-id $distId --paths $paths --profile $Profile --query 'Invalidation.Id' --output text
Check 'Refreshing CloudFront'
Write-Host "Invalidation $invalidation started (takes about a minute)"

Step 'Done'
Write-Host $siteUrl -ForegroundColor Green
