#!/bin/bash
# Runs ON the game server machine (installed by deploy-server.sh as /usr/local/bin/agh-tls and
# run on every deploy; it does nothing when everything is already in place).
#
# Makes the hop from CloudFront to this machine encrypted:
#   - a Let's Encrypt certificate for the machine's own name, proved by one DNS record in
#     Route 53 (so no port has to be opened to the world), renewed by certbot's own timer;
#   - nginx on port 443, which hands /ws to the game server on 127.0.0.1:8080 and answers
#     nothing else.
set -euo pipefail
HOST=origin.africangamehub.com
LIVE=/etc/letsencrypt/live/$HOST

rpm -q nginx certbot python3-certbot-dns-route53 >/dev/null 2>&1 || dnf install -y -q nginx certbot python3-certbot-dns-route53 >/dev/null

if [ ! -f "$LIVE/fullchain.pem" ]; then
  echo "requesting a certificate for $HOST"
  certbot certonly --dns-route53 -d "$HOST" --non-interactive --agree-tos --register-unsafely-without-email \
    --deploy-hook 'systemctl reload nginx' --quiet
fi
systemctl enable --now certbot-renew.timer >/dev/null 2>&1

# The whole of nginx's configuration: one encrypted door, one path.
cat > /etc/nginx/nginx.conf <<NGINX
user nginx;
worker_processes 1;
error_log /var/log/nginx/error.log warn;
pid /run/nginx.pid;
events { worker_connections 4096; }
http {
  access_log off;
  server_tokens off;
  server {
    listen 443 ssl;
    server_name $HOST;
    ssl_certificate $LIVE/fullchain.pem;
    ssl_certificate_key $LIVE/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;

    # Only the game server's WebSocket path. /health stays reachable from this machine alone.
    location = /ws {
      proxy_pass http://127.0.0.1:8080;
      proxy_http_version 1.1;
      proxy_set_header Upgrade \$http_upgrade;
      proxy_set_header Connection "upgrade";
      proxy_set_header Host \$host;
      # Passed on exactly as CloudFront wrote it: the game server trusts the LAST entry (the
      # player's address, added by CloudFront), so nothing may be appended here.
      proxy_set_header X-Forwarded-For \$http_x_forwarded_for;
      # The game server pings every 25 seconds; a quiet connection is never quiet this long.
      proxy_read_timeout 120s;
      proxy_send_timeout 120s;
      proxy_buffering off;
    }
    location / { return 404; }
  }
}
NGINX
nginx -t -q
systemctl enable nginx >/dev/null 2>&1
if systemctl is-active --quiet nginx; then systemctl reload nginx; else systemctl start nginx; fi
echo "certificate for $HOST: $(openssl x509 -in "$LIVE/fullchain.pem" -noout -enddate | cut -d= -f2); nginx $(systemctl is-active nginx)"
