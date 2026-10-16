#!/usr/bin/env bash
# Builds one of the two sites and publishes it to AWS (S3 + CloudFront).
#
#   npm run deploy:player                    the player site
#   npm run deploy:admin                     the admin site
#   npm run deploy:player -- --skip-build    publish what is already in dist/
#
# The AWS resources themselves are created once from infra/site.yaml (stacks agh-player and
# agh-admin); this script only reads their names and uploads files. If AWS says the session has
# expired, run:  aws login --profile myprofile
set -euo pipefail

site=player
profile=myprofile
region=eu-north-1
skip_build=0
while [ $# -gt 0 ]; do
  case "$1" in
    player | admin) site=$1 ;;
    --profile) profile=$2; shift ;;
    --region) region=$2; shift ;;
    --skip-build) skip_build=1 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
  shift
done

root=$(cd "$(dirname "$0")" && pwd)
stack="agh-$site"
if [ "$site" = admin ]; then dist="$root/admin/dist"; else dist="$root/dist"; fi

step() { printf '\n\033[36m== %s\033[0m\n' "$1"; }

# --- 1. Where to publish: read the bucket, distribution and address from the stack -------------
step "Reading stack $stack"
output() {
  aws cloudformation describe-stacks --stack-name "$stack" --profile "$profile" --region "$region" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text
}
bucket=$(output SiteBucketName)
dist_id=$(output DistributionId)
site_url=$(output SiteUrl)
for value in "$bucket" "$dist_id" "$site_url"; do
  if [ -z "$value" ] || [ "$value" = None ]; then echo "Stack $stack has no bucket, distribution or address" >&2; exit 1; fi
done
echo "$site_url  (bucket $bucket, distribution $dist_id)"

# --- 2. Build -----------------------------------------------------------------------------------
if [ "$skip_build" = 0 ]; then
  step "Building the $site site"
  # A variable set here wins over the same line in .env.local, so link previews carry the real
  # address instead of localhost. The Supabase URL and anon key still come from .env.local.
  export VITE_SITE_URL="$site_url"
  if [ "$site" = admin ]; then
    npm --prefix "$root/admin" run build
  else
    # Player site only: live games use the game server in Cape Town (see server/README.md). It is
    # set here and not in .env.local, so the site on a developer's machine keeps using the Edge
    # Functions. To switch the game server off for players, remove this line and deploy again.
    export VITE_GAME_SERVER_URL='wss://d2xirivzgoo9lw.cloudfront.net/ws'
    npm --prefix "$root" run build
  fi
fi
if [ ! -f "$dist/index.html" ]; then echo "Nothing to publish: $dist/index.html is missing" >&2; exit 1; fi

# --- 3. Refuse to publish a secret --------------------------------------------------------------
step 'Checking the build for secrets'
node "$root/scripts/checkBuildSecrets.ts" "$dist"

# --- 4. Upload ----------------------------------------------------------------------------------
# Each file is stored with a Cache-Control header that tells phones and CloudFront how long they
# may keep it. The less often a file is fetched again, the less data players use and the less
# CloudFront serves.
s3="s3://$bucket"
forever='public, max-age=31536000, immutable'   # hashed names: new content always has a new name
month='public, max-age=2592000'
if [ "$site" = admin ]; then recheck='no-store'; else recheck='no-cache'; fi   # entry files: always ask for the latest
common=(--profile "$profile" --region "$region" --only-show-errors)

step 'Uploading'
# Old hashed files are left in place on purpose: a phone still running yesterday's page can
# finish loading it. They cost nothing measurable.
aws s3 sync "$dist/assets" "$s3/assets" --cache-control "$forever" "${common[@]}"
if [ "$site" = player ]; then
  for folder in sounds engine landing; do
    aws s3 sync "$dist/$folder" "$s3/$folder" --cache-control "$month" --exclude '*.wasm' --delete "${common[@]}"
  done
  # Browsers only compile WebAssembly quickly when it is labelled as such.
  aws s3 cp "$dist/engine" "$s3/engine" --recursive --exclude '*' --include '*.wasm' --content-type 'application/wasm' --cache-control "$month" "${common[@]}"
fi
# Everything at the top level: the entry pages, the service worker, the icons.
aws s3 sync "$dist" "$s3" --cache-control "$recheck" --delete --exclude 'assets/*' --exclude 'sounds/*' --exclude 'engine/*' --exclude 'landing/*' --exclude '*.webmanifest' "${common[@]}"
if [ "$site" = player ]; then
  aws s3 cp "$dist/manifest.webmanifest" "$s3/manifest.webmanifest" --content-type 'application/manifest+json' --cache-control "$recheck" "${common[@]}"
fi

# --- 5. Tell CloudFront the entry files changed -------------------------------------------------
# Only the few files without a hash in their name. The first 1,000 paths a month are free.
step 'Refreshing CloudFront'
if [ "$site" = admin ]; then paths=(/ /index.html); else paths=(/ /index.html /app.html /sw.js /registerSW.js /manifest.webmanifest); fi
invalidation=$(aws cloudfront create-invalidation --distribution-id "$dist_id" --paths "${paths[@]}" --profile "$profile" --query 'Invalidation.Id' --output text)
echo "Invalidation $invalidation started (takes about a minute)"

step 'Done'
printf '\033[32m%s\033[0m\n' "$site_url"
