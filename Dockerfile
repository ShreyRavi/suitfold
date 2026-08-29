# The table, as a service.
#
# One long-lived process holding card tables, reachable from anywhere rather
# than only from the room the host is sitting in. It serves nothing to the
# public: without the phrase it will not open a socket, and there is no front
# end here to browse to. The front end is the Mac app.
FROM oven/bun:1-alpine AS build
WORKDIR /app

COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile || bun install

COPY tsconfig.json ./
COPY src ./src
COPY server ./server

# One binary, so the runtime image carries no source and no package manager.
RUN bun build server/table.ts --compile --minify --outfile /app/table

FROM alpine:3.20
RUN apk add --no-cache libstdc++ libgcc ca-certificates \
  && adduser -D -u 10001 suitfold
WORKDIR /home/suitfold

COPY --from=build /app/table /usr/local/bin/table

# Tables are kept here so a restart does not end somebody's game.
RUN mkdir -p /data && chown suitfold:suitfold /data
VOLUME ["/data"]
ENV SUITFOLD_HOME=/data

USER suitfold
EXPOSE 8123
ENV PORT=8123

# Coolify watches this to decide whether the container is alive.
HEALTHCHECK --interval=30s --timeout=4s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8123/health >/dev/null || exit 1

CMD ["table"]
