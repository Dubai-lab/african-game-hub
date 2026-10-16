#!/usr/bin/env bash
# Publishes one commit of the game server (server/) to the machine in Cape Town.
#
#   npm run deploy:server                       the commit that origin/main points at
#   npm run deploy:server -- --commit abc1234
#
# The commit must already be pushed to GitHub: the machine fetches it from there, builds the
# Docker image itself, stops the running container and starts the new one. If the new one does
# not report healthy within a minute, the machine starts the previous image again and this
# command fails. Players are not cut off: while the server is away the app plays through the
# Edge Functions and reconnects by itself (see server/README.md).
#
# The machine and its alarms are created once from infra/game-server.yaml (stack agh-game-server).
# If AWS says the session has expired, run:  aws login --profile myprofile
set -euo pipefail

commit=''
profile=myprofile
region=af-south-1
while [ $# -gt 0 ]; do
  case "$1" in
    --commit) commit=$2; shift ;;
    --profile) profile=$2; shift ;;
    --region) region=$2; shift ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
  shift
done

root=$(cd "$(dirname "$0")" && pwd)
step() { printf '\n\033[36m== %s\033[0m\n' "$1"; }

if [ -z "$commit" ]; then
  git -C "$root" fetch origin --quiet
  commit=$(git -C "$root" rev-parse origin/main)
fi
if ! [[ "$commit" =~ ^[0-9a-f]{7,40}$ ]]; then echo "Not a commit id: $commit" >&2; exit 1; fi

step 'Finding the machine'
output() {
  aws cloudformation describe-stacks --stack-name agh-game-server --profile "$profile" --region "$region" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text
}
instance=$(output InstanceId)
bucket=$(output BackupBucket)
echo "$instance, commit $commit"

step 'Building and starting it on the machine (two to four minutes)'
# The machine's own programs are kept in infra/game-server/ and put in place on every deploy,
# so changing one of them needs nothing more than this command.
lines=('cloud-init status --wait >/dev/null 2>&1 || true')
declare -A programs=(
  [agh-deploy.sh]=/usr/local/bin/agh-deploy
  [agh-backup.sh]=/usr/local/bin/agh-backup
  [agh-backup.service]=/etc/systemd/system/agh-backup.service
  [agh-backup.timer]=/etc/systemd/system/agh-backup.timer
  [agh-heartbeat.sh]=/usr/local/bin/agh-heartbeat
  [agh-tls.sh]=/usr/local/bin/agh-tls
)
for name in agh-deploy.sh agh-backup.sh agh-backup.service agh-backup.timer agh-heartbeat.sh agh-tls.sh; do
  encoded=$(tr -d '\r' < "$root/infra/game-server/$name" | base64 -w0)
  lines+=("echo $encoded | base64 -d > ${programs[$name]}")
done
lines+=('chmod 755 /usr/local/bin/agh-deploy /usr/local/bin/agh-backup /usr/local/bin/agh-heartbeat /usr/local/bin/agh-tls')
# The nightly copy of the books: where it goes, and the timer that starts it.
if [ -n "$bucket" ] && [ "$bucket" != None ]; then
  lines+=("mkdir -p /etc/agh && echo $bucket > /etc/agh/backup-bucket")
  lines+=('systemctl daemon-reload && systemctl enable --now agh-backup.timer >/dev/null 2>&1')
fi
# The server itself, then the encrypted door in front of it (certificate and nginx; this does
# nothing when both are already in place). Either failing fails the deploy.
lines+=("/usr/local/bin/agh-deploy $commit; server=\$?; /usr/local/bin/agh-tls; door=\$?; exit \$((server | door))")

parameter_file=$(mktemp)
trap 'rm -f "$parameter_file"' EXIT
node -e 'console.log(JSON.stringify({ commands: process.argv.slice(1), executionTimeout: ["900"] }))' "${lines[@]}" > "$parameter_file"
id=$(aws ssm send-command --instance-ids "$instance" --document-name AWS-RunShellScript --comment "deploy $commit" \
  --parameters "file://$parameter_file" --profile "$profile" --region "$region" --query 'Command.CommandId' --output text)

invocation() {
  aws ssm get-command-invocation --command-id "$id" --instance-id "$instance" --profile "$profile" --region "$region" "$@"
}
status=Pending
while [ "$status" = Pending ] || [ "$status" = InProgress ] || [ "$status" = Delayed ]; do
  sleep 8
  # Straight after sending, AWS may not know the invocation yet; keep waiting.
  status=$(invocation --query 'Status' --output text 2>/dev/null || echo Pending)
done
invocation --query '[StandardOutputContent, StandardErrorContent]' --output text
if [ "$status" != Success ]; then
  echo "The deploy did not succeed (status: $status). The machine keeps running the previous version if there was one." >&2
  exit 1
fi

step 'Done'
printf '\033[32mGame server is running commit %s\033[0m\n' "$commit"
