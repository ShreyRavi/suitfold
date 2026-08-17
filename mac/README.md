# suitfold for the Mac

A small window that holds a table. Everybody still plays in a browser, this one
included - the app is only the thing holding the deck.

## Why it exists

Without it, the table lives in whoever started the game's browser tab. That
works, and it is what the website does. But a tab gets closed by accident, gets
throttled the moment it is in the background, and dies when the laptop sleeps.

This is a process instead:

- **Nothing to close by accident.** It stops when you quit it.
- **No background throttling.** Browsers slow down tabs you are not looking at.
- **Your Mac will not idle to sleep** while a table is up. The app holds a
  power assertion for exactly as long as the game does.
- **The table is written to disk** after every change, so a crash or a restart
  is not the end of the night.
- **Everyone in the house connects straight to it** over a plain WebSocket. No
  WebRTC, no NAT traversal, no public relay, nothing to type but a code.

Verified: with a game of poker running, closing the browser completely and
coming back restored the same hand and the same chips.

## Building it

```
mac/build.sh                 # compiles, assembles and signs suitfold.app
mac/notarise.sh              # sends it to Apple, staples the ticket, zips it
```

`build.sh` signs with the first `Developer ID Application` identity in your
keychain. Override with `SUITFOLD_SIGN_ID` if you have more than one.

The app bundles a compiled copy of `server/table.ts`, which is the same `Host`
class the browser runs. There is one implementation of the rules and one of the
secrecy boundary; this only changes where they run.

## What it does not do

It cannot make your Mac reachable from outside your house - a laptop behind a
router has no public address, and that is networking rather than a decision.
People elsewhere still join the way they always have, browser to browser. If a
night goes badly there is a table server you can run on a box of your own; see
[`server/README.md`](../README.md).
