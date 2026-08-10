# suitfold

A card table for people who already know each other. Someone starts a table, everyone else
types the code. No accounts, no install, no ads, no money, nothing saved.

Two modes on the same table:

- **Poker** — the app is the dealer. Blinds, betting rounds, side pots, showdown, payouts.
  Nobody counts chips or argues about whose turn it is.
- **Sandbox** — a freeform table that enforces nothing. Go Fish, Rummy, War, Crazy Eights,
  anything you play with a standard deck. Tap a card, tap where it goes.

## There is no server

suitfold is a static site. Browsers find each other through public relays and then talk
**directly**, phone to phone, over WebRTC. Nothing of ours runs anywhere, no card ever
passes through a third party, and hosting costs nothing.

That has three consequences worth knowing before you play:

**One tab is the dealer.** Whoever starts the table shuffles and deals. Their tab runs the
engine; everyone else's tab draws what it is told. If they close it, the game ends.

**The dealer can see the cards.** Not the other players — everyone else only ever receives
their own hand, and that is enforced by a single projection function. But the person
dealing holds the deck, exactly like whoever shuffles at a kitchen table. suitfold makes it
tamper-evident: a fingerprint of the shuffle goes out *before* the hand and the deck is
revealed *after*, so the deal can be checked. It cannot stop someone peeking, and it is not
trying to. Play with people you would hand a real deck to.

**Nothing is saved.** No database, no ledger, no history. Close the tab and the night is
gone. That is the point — it is a game, not a bank.

## Playing

Open the site. Type your name. Either **start a new table** and read the six-character code
out loud, or type someone else's code and **join**. That's it.

Sharing a link works too: `…/suitfold/#PGER8A` pre-fills the code.

## Development

```sh
bun install
bun run dev            # http://localhost:5173
bun test               # 53 tests
bun run fuzz           # 100,000 hands against the engine invariants
bun run typecheck
bun run build          # static files into ./dist
```

Two browser tabs on `localhost` are enough to test a real two-player game.

## Deploying

Push to `main`. GitHub Actions typechecks, runs the tests, runs 25,000 fuzz hands, builds,
and publishes to Pages. Enable Pages once in **Settings → Pages → Source: GitHub Actions**.

Nothing ships that has not passed the engine tests. A wrong payout is the one bug a family
will not forgive.

## Where things live

```
src/core/         the table layer — zones, cards, moves, visibility
  types.ts        every event and command in the system
  state.ts        apply() — the ONLY way state ever changes
  project.ts      the secrecy boundary (below)
  narrate.ts      events → human sentences for the action log
src/games/
  sandbox.ts      the module that enforces nothing
  poker/          the module that enforces everything
src/net/
  peers.ts        WebRTC transport, room codes, deck commitment
  table.ts        the dealer: the engine, driven by peer messages
src/client/       React, phone-first, built from design/
design/           the design system — tokens, base CSS, mockups
tests/
```

## How it works

**Everything is a move between zones.** A zone has a kind (deck, discard, hand, board,
trick), an owner, and a visibility (`public`, `owner`, `hidden`). Dealing is deck → hands.
The flop is deck → board, face up. Folding is hand → discard. Poker and Go Fish are the
same primitives arranged differently, which is why adding a game is not a fork of the app.

**One function decides who sees a card.** `project(state, seatId)` filters zones by
visibility, and everything sent to another player goes through it. A game module cannot
leak a card it has no way to address — secrecy is a type, not a discipline someone has to
remember.

**A data channel is an identity.** The dealer knows which connection a message arrived on,
so nobody can act as a seat they do not hold. The server version needed tokens and cookies
for this; peer-to-peer gets it for free.

**Raw events never leave the dealer.** `hand_started` carries the whole deck. What goes out
is a per-seat snapshot plus narrated lines — "Mom raises to 80" — which is also exactly
what the action log and the re-entry summary need.

**The shuffled deck is logged, not a seed.** With a seed, changing the shuffle
implementation later would silently re-deal every previously logged hand.

## Two things about phones

Everyone plays with a video call open in another window, which means **suitfold is
backgrounded for most players most of the time**. There is no in-app way around it: a
backgrounded page's timers don't fire, `navigator.vibrate` isn't implemented in iOS Safari,
and Web Push needs an install. So the video call is the notification channel — somebody
says "you're up" — and there is no auto-fold timer. If a phone dies, the dealer force-folds
that seat.

That makes the real job **one-second re-entry**: when you come back, the state on arrival
has to tell you whose turn it is, what your stack is, and what you missed, without reading.
That is what the fixed bottom rail, the newest-first action log, and the "while you were
away" note are for.

## Tests

| | |
|---|---|
| `tests/rules.test.ts` | one hand-authored test per poker rule that is easy to get wrong |
| `tests/invariants.test.ts` | F1–F7 over random play, plus a check that the fuzzer reaches side pots at all |
| `tests/eval.test.ts` | validates `pokersolver` (pinned, unmaintained) hand class by hand class |
| `tests/peers.test.ts` | seating, authorization, and that a snapshot never carries someone else's cards |
| `tests/sandbox.test.ts` | every layout preset, and that you cannot move a card you cannot see |

`bun run fuzz` plays 100,000 hands with all-in-biased bots, asserting chips are conserved,
no pot is awarded twice, nobody is eligible for a pot they didn't contribute to, the odd
chip lands left of the button, and replaying the log reproduces live state exactly.

## Known limits

- **Peer-to-peer connections fail on some networks.** Symmetric NATs need a TURN relay,
  which suitfold does not have. If someone cannot connect, that is why. Worth testing with
  your actual family before a real game night.
- **The public relays are shared.** They are used only to introduce peers, never to carry
  cards, but a busy relay can make joining slow.
- **The dealer's tab must stay open and awake.** On a phone, that means the dealer should
  be the person least likely to background the app — or use a laptop.
