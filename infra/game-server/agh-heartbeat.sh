#!/bin/bash
# Runs ON the game server machine once a minute (installed by deploy-server.sh as
# /usr/local/bin/agh-heartbeat, started by agh-heartbeat.timer). Tells CloudWatch: is the
# server answering, has Docker had to restart it, how full is memory, and how many days the
# machine's certificate has left. The alarms on these numbers are in infra/game-server.yaml.
REGION=af-south-1
CERT=/etc/letsencrypt/live/origin.africangamehub.com/fullchain.pem

BODY=$(curl -s -m 5 http://127.0.0.1:8080/health || true)
HEALTHY=0; echo "$BODY" | grep -q '"ok":true' && HEALTHY=1
GAMES=$(echo "$BODY" | sed -n 's/.*"games":\([0-9]*\).*/\1/p'); [ -z "$GAMES" ] && GAMES=0
CONNECTIONS=$(echo "$BODY" | sed -n 's/.*"connections":\([0-9]*\).*/\1/p'); [ -z "$CONNECTIONS" ] && CONNECTIONS=0
COUNT=$(docker inspect -f '{{.RestartCount}}' agh-game-server 2>/dev/null || echo 0)
LAST=$(cat /run/agh-restarts 2>/dev/null || echo "$COUNT")
echo "$COUNT" > /run/agh-restarts
RESTARTS=$((COUNT - LAST)); [ "$RESTARTS" -lt 0 ] && RESTARTS=0
MEMORY=$(awk '/MemTotal/ {t=$2} /MemAvailable/ {a=$2} END {printf "%.1f", (t-a)*100/t}' /proc/meminfo)

DATA=("MetricName=Healthy,Value=$HEALTHY" "MetricName=Restarts,Value=$RESTARTS" "MetricName=MemoryUsedPercent,Value=$MEMORY" "MetricName=Games,Value=$GAMES" "MetricName=Connections,Value=$CONNECTIONS")
if [ -f "$CERT" ]; then
  ENDS=$(date -d "$(openssl x509 -in "$CERT" -noout -enddate | cut -d= -f2)" +%s)
  DATA+=("MetricName=CertificateDaysLeft,Value=$(( (ENDS - $(date +%s)) / 86400 ))")
fi
aws cloudwatch put-metric-data --region "$REGION" --namespace AGH/GameServer --metric-data "${DATA[@]}"
