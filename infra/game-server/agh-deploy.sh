#!/bin/bash
# Runs ON the game server machine (installed there by deploy-server.ps1 as /usr/local/bin/agh-deploy).
#
#   agh-deploy <commit>
#
# Builds that commit of the game server and runs it, replacing the copy that was running.
# There is only ever ONE container (see server/README.md). If the new one does not report
# healthy, the previous image is started again.
set -euo pipefail
COMMIT="$1"
REGION=af-south-1
LOG_GROUP=/agh/game-server
REPOSITORY=https://github.com/Dubai-lab/african-game-hub.git

cd /opt/agh
[ -d repo/.git ] || git clone --quiet "$REPOSITORY" repo
cd repo
git fetch --quiet origin
git checkout --quiet --detach "$COMMIT"
SHA=$(git rev-parse --short HEAD)
echo "building $SHA"
docker build --quiet -f server/Dockerfile -t "agh-game-server:$SHA" . >/dev/null

# Secrets come from Parameter Store each time a container is started; they are never in the
# image. Everything under /agh/game-server/ becomes an environment variable of the server, so
# only what the server itself needs belongs there.
umask 077
ENVFILE=$(mktemp)
trap 'rm -f "$ENVFILE"' EXIT
aws ssm get-parameters-by-path --region "$REGION" --path /agh/game-server/ --with-decryption \
  --query 'Parameters[].[Name,Value]' --output text |
  while read -r name value; do echo "$(basename "$name")=$value"; done > "$ENVFILE"
for key in SUPABASE_URL SUPABASE_ANON_KEY GAME_SERVER_KEY APP_ORIGINS ORIGIN_SECRET; do
  grep -q "^$key=" "$ENVFILE" || { echo "missing secret: $key"; exit 1; }
done
if grep -q '^SUPABASE_SERVICE_ROLE_KEY=' "$ENVFILE"; then
  echo "WARNING: the full-access key is still in Parameter Store. Delete /agh/game-server/SUPABASE_SERVICE_ROLE_KEY and deploy again."
fi

start() {
  docker run -d --name agh-game-server --restart unless-stopped --network host \
    --env-file "$ENVFILE" --memory 512m --stop-timeout 12 \
    --log-driver awslogs --log-opt "awslogs-region=$REGION" \
    --log-opt "awslogs-group=$LOG_GROUP" --log-opt awslogs-stream=server \
    "$1" >/dev/null
}
healthy() {
  for _ in $(seq 1 30); do
    curl -fs -m 3 http://127.0.0.1:8080/health >/dev/null && return 0
    sleep 2
  done
  return 1
}

PREVIOUS=$(docker inspect -f '{{.Config.Image}}' agh-game-server 2>/dev/null || true)
# The server tells its players it is restarting and leaves within ten seconds.
docker stop -t 12 agh-game-server >/dev/null 2>&1 || true
docker rm agh-game-server >/dev/null 2>&1 || true
start "agh-game-server:$SHA"
if healthy; then
  echo "running $SHA: $(curl -s -m 3 http://127.0.0.1:8080/health)"
  echo "settings given to the server: $(cut -d= -f1 "$ENVFILE" | sort | tr '\n' ' ')"
else
  echo "$SHA did not become healthy; last lines:"; docker logs --tail 20 agh-game-server 2>&1 || true
  docker rm -f agh-game-server >/dev/null 2>&1 || true
  if [ -n "$PREVIOUS" ]; then start "$PREVIOUS"; echo "went back to $PREVIOUS"; fi
  exit 1
fi
# Keep this image and the one before it; drop older ones.
docker images agh-game-server --format '{{.Repository}}:{{.Tag}}' | tail -n +3 | xargs -r docker rmi >/dev/null 2>&1 || true
docker builder prune -f >/dev/null 2>&1 || true
