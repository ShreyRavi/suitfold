# The optional table server

suitfold does not need this. Left alone, browsers find each other over public
relays and talk directly, whoever starts the table holds it, and it costs
nothing. That is the default and it is a real answer.

Run this when you want the other one: the deck on a machine you own.

## What changes

- **Nobody's tab holds the game.** Everyone can close everything. The table is
  still there, mid-hand, when they come back.
- **Messages arrive, in order.** One socket each, no WebRTC, no NAT traversal,
  no public relay deciding it has heard enough from you today.
- **Reconnecting takes a second.** Anything said while a socket was down is
  said again when it comes back.
- **The server sees every card.** It is running the game, so it holds the deck
  the way a dealer does. That is the trade. Run it somewhere you control.

## Falling back

The front end asks the server whether it is there before using it. If it does
not answer - down, moved, or simply not on this network - the browser plays
peer to peer instead, exactly as it does with no server at all. A server is
worth having and not worth depending on.

## Running it on Coolify

The container carries the front end as well as the table, so one service is the
whole thing and there is nothing to point at anything.

1. **New Resource → Application → Public Repository**, this repository, branch
   `main`, **Build Pack: Dockerfile**.
2. **Port**: `8123`.
3. **Environment Variables**: add `SUITFOLD_KEY` and tick **Build Variable** as
   well, so the front end is built with it too. It is the sha256 of the phrase,
   never the phrase:

   ```sh
   printf '%s' 'your phrase' | shasum -a 256
   ```

   Leave it unset and anybody who can reach the box can open a table.
4. **Persistent Storage**: a volume mounted at `/data`. Without it every
   redeploy forgets every table, which rather defeats the point.
5. Give it a domain, **and turn on https**. This is not optional polish: a
   browser only offers SubtleCrypto on a secure origin, so over plain http the
   phrase cannot be checked at all and nobody can get in. The app says so
   rather than pretending you typed it wrongly, but the only fix is a
   certificate. Coolify terminates TLS and the websocket goes over the same
   one, so there is nothing further to configure.
6. Deploy, then open the domain. Not the Pages site, the domain. That is what
   makes it a table server rather than a static page.

`docker-compose.yml` is here too if you would rather deploy that way, but the
Dockerfile route is fewer moving parts.

There is no `node_modules` in the running image, on purpose: the server imports
nothing outside the standard library and this repository. It runs with
`--no-install` so that if that ever stops being true it crashes on the spot
rather than quietly downloading a package from npm onto your VPS.

## Running it by hand

```sh
bun run build
SUITFOLD_WEB=$PWD/dist \
SUITFOLD_KEY=$(printf '%s' 'your phrase' | shasum -a 256 | cut -d' ' -f1) \
bun run server
```

Then open http://localhost:8123.

| Variable | What it is |
| --- | --- |
| `PORT` | Port to listen on. Default 8123. |
| `SUITFOLD_WEB` | Directory holding the built front end. Unset serves the API only. |
| `SUITFOLD_HOME` | Where tables are written. |
| `SUITFOLD_KEY` | sha256 of the phrase. Unset lets anybody open a table. |

`/health` says what tables exist and who is at them, which is also what the
front end asks to find out whether there is a server here at all.

## Who gets in

The same rule as everywhere else, and the phrase does less than you would
think:

- **Connecting needs the code.** A guest follows a link and has no phrase to
  give, so none is asked for.
- **Picking up the deck of a table nobody is holding needs the phrase.** That
  is the only thing it decides.
- **Everybody else knocks**, and whoever is dealing lets them in or does not.
  The list of people at the door is sent to the dealer and to nobody else.
