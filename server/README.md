# The optional table server

suitfold does not need this. Left alone, browsers find each other over public
relays and talk directly, and whoever starts the table holds it. That works, and
it costs nothing.

Run this when you want the other thing: one socket per person to a box you own.

## What it buys

- **Messages arrive, in order.** No WebRTC, no NAT traversal, no public relay
  deciding it has heard enough from you today.
- **Reconnecting takes a second**, not a renegotiation. Anything said while a
  socket was down is said again when it comes back.
- **It is your machine.** Nobody else's relay is involved in finding the table.

## What it deliberately does not do

It does not hold the table. The deck still lives in the browser of whoever
started the game, exactly as it does without a server. That means the rules and
the secrecy boundary have one implementation rather than two that drift apart -
and it means **this server never sees a card**. It forwards sealed messages
between browsers and cannot read them, which is worth having even on a box you
own.

The consequence is the one thing it does not fix: if the person who started the
table closes their tab, the game still ends. Their browser offers it back when
they reopen it.

## Running it

```
bun run server/index.ts        # listens on :8787
curl localhost:8787/health     # {"ok":true,"rooms":0,"players":0}
```

## On Coolify

1. New resource, **Docker Compose** or **Dockerfile**, pointed at this repo.
2. Coolify finds the `Dockerfile` in the root. Nothing to configure.
3. Set the port to **8787**, or set `PORT` and match it.
4. Give it a domain. Coolify terminates TLS, so the browser address is
   `wss://` even though the container speaks plain WebSocket.
5. Health check is `GET /health`, already declared in the Dockerfile.

Then tell the app about it, either way round:

- **Everybody, permanently:** build the front end with
  `VITE_TABLE_SERVER=wss://table.example.com bun run build`.
- **Just to try it:** open the app with `?server=wss://table.example.com`, or
  paste the address into the box on the front page. It is remembered in that
  browser, and it is carried on the link you share, so whoever you invite uses
  the same server without being told to.

## Scale

A room is a `Map` of sockets. Messages are forwarded, never parsed beyond their
channel name, and never stored. A family game is a few hundred bytes a second.
Rooms with nobody in them are dropped after thirty minutes.
