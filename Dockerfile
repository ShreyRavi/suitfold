# The table, front end and all, in one container.
#
# The front end asks whatever origin it was served from whether there is a
# table server behind it. Serving both from here means the answer is yes and
# there is nothing to configure. Point the domain at this and it works.

FROM oven/bun:1 AS build
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .
# The sha256 of the phrase, never the phrase. Without it the server lets
# anybody pick up a deck, which is fine on a machine only you can reach.
ARG SUITFOLD_KEY=""
ENV VITE_LOCK=$SUITFOLD_KEY
RUN bun run build

FROM oven/bun:1-slim
WORKDIR /app

COPY --from=build /app/dist ./web
COPY --from=build /app/server ./server
COPY --from=build /app/src ./src
COPY --from=build /app/package.json ./

# No node_modules on purpose: the server imports nothing outside the standard
# library and this repository. --no-install below turns a stray import into a
# crash at boot rather than a quiet download from npm on somebody's VPS.

ENV PORT=8123
# Accounts, when you want them: "me@x.com:my password;mum@x.com:hers".
# Set at run time only - the front end must never be built with it.
ENV SUITFOLD_USERS=
ENV SUITFOLD_WEB=/app/web
ENV SUITFOLD_HOME=/data

# Tables are written here. Give it a volume or a restart forgets the game.
VOLUME /data

EXPOSE 8123
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s \
  CMD bun -e "fetch('http://127.0.0.1:'+(process.env.PORT??8123)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["bun", "--no-install", "run", "server/table.ts"]
