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
| `SUITFOLD_KEY` | sha256 of the phrase. Used only when there are no accounts. |
| `SUITFOLD_USERS` | Accounts, if you want them. See below. |
| `SUITFOLD_SECRET` | Optional. Signs sessions. Unset, it is derived from the accounts. |
| `SUITFOLD_KEEP_HOURS` | How long a table nobody is at is kept. Default a week. |

`/health` says what tables exist and who is at them, which is also what the
front end asks to find out whether there is a server here at all.

## Who gets in

The rule never changes, only what the first line asks for:

- **Connecting needs the code.** A guest follows a link and has no phrase and
  no account, so neither is asked for.
- **Picking up the deck of a table nobody is holding needs the door.** That is
  the only thing it decides.
- **Everybody else knocks**, and whoever is dealing lets them in or does not.
  The list of people at the door is sent to the dealer and to nobody else.

## Accounts

Set `SUITFOLD_USERS` and the phrase is replaced by an email and a password.
Semicolons separate people; the first colon separates an address from its
password, so a password may contain colons but not semicolons:

```
SUITFOLD_USERS=me@example.com:my password;mum@example.com:hers
```

Set it in Coolify as a **runtime** variable only. Never a build variable: the
front end must never be built carrying anybody's password.

Things worth knowing before you rely on it:

- **Guests are untouched.** A link still gets somebody as far as knocking with
  no account of any kind. That is the point of the whole thing.
- **The passwords are readable by anyone with Coolify access**, because that is
  where they live. Use passwords nobody reuses anywhere else. A bcrypt hash is
  accepted in the same field if you would rather, with no code change.
- **Adding or removing somebody is an edit and a redeploy.** Removing them takes
  effect immediately: a session is checked against the current list every time
  it is used, not merely when it was issued.
- **Changing any password signs everyone out**, because the signing key is
  derived from the list. Set `SUITFOLD_SECRET` to a long random string if you
  would rather it did not.
- **It needs https.** The session cookie is `Secure`, so over plain http the
  browser will not keep it and nobody stays signed in.
- **Accounts win.** With `SUITFOLD_USERS` set, the phrase stops opening tables
  entirely, so an old browser carrying one cannot get past a login.
- **GitHub Pages keeps the phrase**, because a static page has no server to ask.
  That deployment is the peer to peer fallback and it still works exactly as it
  did.

The boot log says which door is in use and how many accounts loaded - a count,
never the list - so a mistyped variable is visible in the deploy output rather
than at bedtime.
