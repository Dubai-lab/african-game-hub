# The African Game Hub game server.
# Build from the ROOT of the repository, because the game rules are shared with the Edge
# Functions and live outside this folder:
#
#   docker build -f server/Dockerfile -t agh-game-server .
#
# Runs on ARM64 and x86-64 alike (no native modules).

FROM node:22-alpine AS build
WORKDIR /app
COPY server/package.json server/package-lock.json ./
RUN npm ci
COPY server ./server
COPY supabase/functions/_shared ./supabase/functions/_shared
RUN node server/build.mjs

FROM node:22-alpine
ENV NODE_ENV=production PORT=8080
WORKDIR /app
COPY --from=build /app/server/dist/server.cjs ./server.cjs
USER node
EXPOSE 8080
# The server stops cleanly on SIGTERM: it answers moves in hand, tells players it is
# restarting, and exits within ten seconds.
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD wget -qO- "http://127.0.0.1:${PORT}/health" || exit 1
CMD ["node", "--enable-source-maps", "server.cjs"]
