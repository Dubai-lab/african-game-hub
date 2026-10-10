#!/bin/bash
# Runs ON the game server machine, once a night (installed by deploy-server.ps1 as
# /usr/local/bin/agh-backup, started by agh-backup.timer).
#
# Takes the nightly copy of the books with server/backup.mjs, puts the file in the private S3
# bucket, deletes the local one, and tells CloudWatch how it went. Two numbers are reported:
#   LedgerBackupFailed    1 when the script ended with an error (1 = could not be taken,
#                         2 = the copy does not agree with itself) or the upload failed, else 0
#   LedgerBackupUploaded  1 for each file that reached the bucket
# Alarms on both are in infra/game-server.yaml.
set -uo pipefail
REGION=af-south-1
BUCKET=$(cat /etc/agh/backup-bucket)
OUT=/var/lib/agh-backup
SCRIPT=/opt/agh/repo/server/backup.mjs

mkdir -p "$OUT"; chmod 700 "$OUT"
umask 077
ENVFILE=$(mktemp)
trap 'rm -f "$ENVFILE"' EXIT
param() { aws ssm get-parameter --region "$REGION" --name "$1" --with-decryption --query Parameter.Value --output text; }
# The backup has its own key, kept apart from the server's so the server never sees it.
{
  echo "SUPABASE_URL=$(param /agh/game-server/SUPABASE_URL)"
  echo "SUPABASE_ANON_KEY=$(param /agh/game-server/SUPABASE_ANON_KEY)"
  echo "LEDGER_BACKUP_KEY=$(param /agh/ledger-backup/LEDGER_BACKUP_KEY)"
} > "$ENVFILE"

# Node 22 comes from the game server's own image, so nothing is downloaded at night.
IMAGE=$(docker inspect -f '{{.Config.Image}}' agh-game-server 2>/dev/null)
CODE=1
if [ -n "$IMAGE" ] && [ -f "$SCRIPT" ]; then
  docker run --rm --network host --user 0 --memory 256m --env-file "$ENVFILE" \
    -v "$SCRIPT:/backup.mjs:ro" -v "$OUT:/out" --entrypoint node "$IMAGE" /backup.mjs /out
  CODE=$?
else
  echo '{"level":"error","event":"ledger_backup_not_run","message":"no game server image or no backup.mjs on this machine"}'
fi

# A copy that failed its own check is still kept: it is evidence.
UPLOADED=0
FAILED=0
[ "$CODE" -ne 0 ] && FAILED=1
for file in "$OUT"/ledger-*.json.gz; do
  [ -e "$file" ] || continue
  if aws s3 cp --region "$REGION" --only-show-errors "$file" "s3://$BUCKET/ledger/$(basename "$file")"; then
    rm -f "$file"
    UPLOADED=$((UPLOADED + 1))
    echo "{\"event\":\"ledger_backup_stored\",\"object\":\"s3://$BUCKET/ledger/$(basename "$file")\"}"
  else
    FAILED=1
    echo "{\"level\":\"error\",\"event\":\"ledger_backup_upload_failed\",\"file\":\"$(basename "$file")\"}"
  fi
done
[ "$UPLOADED" -eq 0 ] && FAILED=1

aws cloudwatch put-metric-data --region "$REGION" --namespace AGH/GameServer --metric-data \
  "MetricName=LedgerBackupFailed,Value=$FAILED" "MetricName=LedgerBackupUploaded,Value=$UPLOADED"
[ "$FAILED" -eq 0 ] || exit "$([ "$CODE" -ne 0 ] && echo "$CODE" || echo 1)"
