#!/usr/bin/env bash
# The kill switch: takes a site offline, or brings it back, without deleting anything.
#
#   npm run aws:off                     both sites offline
#   npm run aws:on                      both sites back
#   npm run aws:off -- --site admin     one site only (player or admin)
#
# Use it if a budget alert arrives and you do not yet know why. A switched-off CloudFront
# distribution answers nobody, so it serves no data and costs nothing; the files stay in S3.
# CloudFront stops answering within a minute or two; the command itself waits about five minutes
# for every edge location to confirm.
set -euo pipefail

site=all
enabled=false
profile=myprofile
region=eu-north-1
while [ $# -gt 0 ]; do
  case "$1" in
    --site) site=$2; shift ;;
    --on) enabled=true ;;
    --profile) profile=$2; shift ;;
    --region) region=$2; shift ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
  shift
done
case "$site" in
  all) sites=(player admin) ;;
  player | admin) sites=("$site") ;;
  *) echo "--site must be player, admin or all" >&2; exit 1 ;;
esac

template="$(cd "$(dirname "$0")" && pwd)/site.yaml"
for name in "${sites[@]}"; do
  printf '\n\033[36m== agh-%s -> %s\033[0m\n' "$name" "$([ "$enabled" = true ] && echo ON || echo OFF)"
  # Only this one setting is given; the stack keeps its other settings as they are.
  aws cloudformation deploy --stack-name "agh-$name" --template-file "$template" --parameter-overrides "Enabled=$enabled" \
    --profile "$profile" --region "$region" --no-fail-on-empty-changeset
done
