# suitfold — design brief

Paste everything from **§ 1 Brief** through **§ 7 Deliverables** into Claude Design. It is
self-contained; it assumes no prior context.

Full product design doc (engineering detail, not needed for design):
`~/.gstack/projects/ShreyRavi-suitfold/shreyastallamraju-main-design-20260807-035955.md`

---

# 1. Brief

## What suitfold is

A no-login **card table** for one family that lives in different cities. It is a static site
with **no server**: someone starts a table, reads out a six-character code, and everyone
else's browser connects to theirs directly. No accounts, no install, no ads, no real money,
and nothing is saved once the night ends.

It has **two modes**, and both ship in version one:

- **Sandbox.** A freeform table that enforces nothing. Cards, zones, chips, and you move
  them around. Go Fish, War, Rummy, Crazy Eights, Hearts — anything a family plays with a
  standard deck. Like playingcards.io.
- **Poker.** The app is the dealer. It deals, runs the betting, moves the blinds, builds the
  pot, and decides who won. Nobody counts chips or argues about whose turn it is.

Same table underneath, same seats, same chips. Poker is the one mode that enforces rules;
sandbox is the one that doesn't. **More games get added later as
sandbox layouts first, and only get rules if they earn them** — so the sandbox surface is
not a side feature, it is the extensibility story.

Eight people, once a week, forever. That is the entire user base.

**Name:** suitfold. Card suits, and to fold. Do not redesign the name.

## Who is using it, and the one thing that changes everything

Everyone is on a FaceTime or Zoom call in another window while they play. They talk to each
other there. suitfold has no chat, no voice, no video — it is the quiet table in the corner.

Because they are on a video call **on their phone**, suitfold is **backgrounded for most
players most of the time**. This is not an edge case. It is the steady state for seven of
eight players.

We tested the escape hatches. All of them fail:

- Flashing the tab title does nothing — a backgrounded page's timers do not fire, and iOS
  Safari has no persistent title chrome anyway.
- `navigator.vibrate` is not implemented in Safari on iOS.
- Web Push on iOS requires the app to be added to the home screen, and "no install" is a
  hard product constraint.

**So there is no notification channel inside the app.** Someone on the call says "hey,
you're up." That is the turn timer.

**Which makes this the design problem:** the table is not something people watch. It is
something people **return to**. A player foregrounds the app after being away for four
hands. In about one second, without reading, they must know:

1. Is it my turn?
2. What is my stack / what's in my hand?
3. What did I miss?

Everything else is secondary to that. Design for re-entry, not for real-time attention.

## Feel

Cozy, not casino. Warm, calm, unhurried. This is a kitchen table where a family plays cards,
not a card room where strangers take each other's money.

**The obvious move is probably wrong.** Dark green felt, gold chips, ornate card backs,
Vegas neon, leather, "high roller" — every competitor looks like that because they are
chasing poker players. Nobody at this table is optimizing their game. Aunt Susan is here.

Do not treat this as a rule against green or against felt. Treat it as: earn whatever you
pick. If you land on green felt, it should be because it was the best answer, not the
default one.

Reference points for the *feeling*, not the look: a well-worn board game box, a family
recipe card, a good deck of cards that has been played with for years.

## Surface

**Phone, portrait. That is the only surface.** Desktop is explicitly out of scope for v1.

- Design target: **390 × 844** (iPhone 14/15/16 logical viewport). Must also hold at
  **360 × 740** (small Android) and **430 × 932** (Pro Max) without breaking.
- Respect safe-area insets top and bottom.
- Primary actions live in the bottom third — one-handed thumb reach.
- Assume the browser's own chrome is present. No fullscreen, no PWA.
- Text must be readable at arm's length, in a lit living room, by someone in their sixties.

---

# 2. The table model — read this before designing anything

Both modes render the same underlying model. Understanding it is what lets one visual
system serve every card game instead of just poker.

**Zones.** Every card lives in exactly one zone. A zone has:

- **kind** — `deck` (face-down draw pile), `discard`, `hand` (a player's cards), `board`
  (shared, face-up), `trick` (cards played this round), `pile` (generic stack)
- **owner** — a seat, or shared
- **visibility** — `public` (everyone sees the faces), `owner` (only that player sees them),
  `hidden` (nobody sees them)
- **layout** — `stack` (overlapping pile), `fan` (spread in an arc), `row`, `grid`

**Moves.** One action underlies every card game: move a card from one zone to another,
optionally flipping it. Dealing is deck → hands. The flop is deck → board, face-up. Folding
is hand → discard. Playing a trick card is hand → trick.

**What this means for you:** design **a zone**, not "the poker board." Design **a card in a
fan**, **a card in a stack**, **a face-down card**. A game is a particular arrangement of
zones, and the same components have to compose into arrangements you have not seen. Poker
and Go Fish should look like the same product, because they are.

**Chips are optional.** Poker uses them; Go Fish does not. The table must not look broken
when there are no chips on it.

## Poker vocabulary you will need

- **Seat** — a player's spot. Has a name and a **stack** (their chips).
- **Hole cards** — your two private cards in poker.
- **Community cards / the board** — up to five shared face-up cards, revealed in stages
  (3, then 1, then 1).
- **Pot** — chips everyone has bet this hand, in the middle.
- **Side pot** — when someone is all-in for less than others bet, the extra splits off into a
  second pot that the short player cannot win. A hand can have two or three pots at once.
  This must be legible without a poker education.
- **Blinds** — two forced bets that rotate each hand. The **button** marks the dealer
  position and moves one seat left each hand.
- **Actions** — fold, check, call, raise, all-in.
- **Showdown** — the end, where remaining players reveal and the best hand wins.
- **Muck** — to fold without showing. suitfold reveals mucked hands anyway, on purpose.

Sample poker state, for realistic mockup content:

```
Blinds 10 / 20        Table PGER8A
Board: A♠ K♠ 7♦
Pot: 340

Mom       1,240   folded
Uncle R     860   ← to act, has 80 to call
You       2,100   A♠K♥   (button)
Dad         530   all-in 530
Cousin J  1,900   checked
```

Sample sandbox state (a Rummy-ish game), for the sandbox mockup:

```
Deck: 31 face-down       Discard: 7♣ on top (14 below)
Board: (empty)

Mom       7 cards
Uncle R   7 cards
You       7 cards   ← 3♥ 3♠ 9♦ 9♣ J♠ Q♠ K♠
Dad       6 cards
Cousin J  7 cards
```

---

# 3. The eight screens

Build them in the order listed. **Start with the sandbox table** — it is the simpler
surface, and it forces the generic zone system to be right before poker piles specifics on
top of it.

## 1. Sandbox table

A freeform table. The app enforces nothing; the family does whatever they want.

**Interaction is tap-to-move, not drag.** playingcards.io is drag-based and desktop-shaped;
dragging a card with a thumb on a 390px screen is bad. So:

- **Tap a card** → it becomes selected, and valid destination zones highlight.
- **Tap a zone** → the card moves there. Tap the card again to deselect.
- **Long-press a card in your hand** → peek at it privately.
- **Tap a zone's header** → zone actions: shuffle, deal N to each player, gather all cards
  back, flip face-up/face-down.

**What must be on screen:** the deck (with a count), the discard pile (top card visible),
any shared board, every player's seat with a card count, your own hand, and the chip
counters if the room has them on.

**Hard problems:**

- **Your hand is the star here, not the board.** In poker you hold two cards; in Rummy you
  hold seven to thirteen. A fanned hand of thirteen cards on a 390px screen, tappable with a
  thumb, is the core puzzle of this screen.
- **Where do zones live** when there are five of them and the count changes per game?
- **Selected-card state** has to be obvious and instantly reversible — people will mis-tap.
- The screen must not look empty when a game only uses a deck and hands.

## 2. Game picker

The host starts a night and chooses: **Poker** (enforced) or **Sandbox** (freeform). If
sandbox, they pick a starting layout — a small set of presets that just configure zones and
how many cards get dealt:

- *Just a deck* — deck, discard, everyone gets nothing
- *Deal 5* / *Deal 7* / *Deal 13* — plus a discard pile
- *Trick game* — hands plus a shared trick area
- *Everything* — deck, discard, board, trick, hands

These are not game rules. They are furniture arrangements. Keep this screen tiny — it is a
ten-second decision, not a configuration wizard.

## 3. Poker table

Everything below visible at once, no scrolling, no tapping to reveal:

- every seat: name, stack, state, last action
- whose turn it is, unmissably
- the pot (and side pots when they exist)
- the community cards
- your own hole cards
- your action buttons, in the thumb zone

**Hard problems, in priority order:**

**(a) Re-entry comprehension.** The one-second test from § 1. There is no notification
channel, so the *state on arrival* does all the work. Solve this and the turn indicator is
solved.

**(b) Eight seats around a table in portrait.** Each seat needs name + stack + state
(to-act / folded / all-in / disconnected / busted / stood-up) + last action. Eight of those
on a 390px-wide screen is the core layout puzzle. A literal oval may not be the answer; you
may abandon the table metaphor if something reads better — **but whatever you choose has to
also work for sandbox**, where seats show card counts instead of stacks.

**(c) Raise input.** A slider is the convention and is genuinely bad with a thumb. Needs
presets — min, ½ pot, pot, all-in — plus a way to pick an arbitrary amount that is not
dragging a 4px handle. The current bet, what it costs to call, and your stack after the
raise must all be visible while choosing.

**(d) Action log.** What happened, glanceable, must not eat the table. Related to (a) but
distinct — (a) is a *summary on arrival*, this is *the running record*.

**Also needs a home:** blinds level, the button marker, season/night context.

## 4. Host settings and host actions

The host plays from their phone like everyone else. There is no desktop admin panel.

**Setup:** seat names, game mode, blinds and starting stack (poker), sandbox layout preset,
chips on/off, mucked-reveal on/off,
"start a new season."

**In-game, reachable during live play without covering the table:**

- confirm a seat claim
- **force-fold / force-pass a seat** (someone's phone died and the table is blocked — this
  replaces the turn timer entirely, so it must be fast)
- re-stack a busted player (poker, between hands)
- reset the table (sandbox — gather all cards, reshuffle, redeal)
- end the night
- save recap

## 5. Mucked-hand reveal (poker)

After a hand that reaches **showdown**, show what everyone was actually holding — including
players who folded. Real poker apps never do this. For a family it is the best part of the
night; it is how you find out Dad folded a straight.

The most emotionally loaded moment in the product. Needs a beat of drama without being slow
— people are mid-conversation on a call.

**Two endings, and neither should look broken:**

- **Showdown:** full reveal, everyone's cards.
- **Everyone folded:** no reveal. The winner takes it without showing. Quieter, and common.

## 6. Lobby

The first thing anyone sees. Type your name, then either **start a new table** (which
generates a six-character code to read out loud) or type someone else's code and **join**.
Under ten seconds, on a phone, by someone who was told the code over FaceTime.

The code is the whole security model, so it needs to be big, legible, and easy to say —
it uses an alphabet with no I, O, 0 or 1 for exactly that reason.

## 7. Connecting

Peers are finding each other, which takes a few seconds and occasionally fails. Needs to
feel like a doorbell, not a spinner: say what is happening and show the code so the host can
read it out while they wait.

## 8. The dealer left

Whoever was dealing closed their tab, so the game is over. This is a normal way for a night
to end, not an error — it should read like the lights coming up, not like a crash.

---

# 4. States that need designing

Not just the happy path. Each of these is real and will happen on night one:

**Shared:**
- Empty room, waiting for players to arrive
- A player disconnected mid-hand (inert — their seat is fine, but it should be visible)
- A player stood up, with chips parked on the empty seat
- Table full (a ninth person taps the link)
- Night ended

**Sandbox:**
- A card selected, with valid destinations highlighted
- An empty zone (the deck ran out, the board is clear)
- A hand of 13 cards, fanned and tappable
- A zone's action menu open over a live table
- Chips off entirely — the table must not look broken without them

**Poker:**
- All-in showdown, cards revealed, no more betting
- Split pot (two players tie)
- **Side pots** — two or three at once, with it clear who can win which
- A player busts to zero and the host's re-stack affordance appears

---

# 5. Out of scope

Do not design: chat, voice, video, avatars, profile photos, tournaments, clubs, multiple
simultaneous tables, real money or any currency symbol, sound, desktop layouts, onboarding
tutorials, non-standard decks (Uno), custom card art, settings beyond the host list above,
or anything that reads as a casino.

---

# 6. Technical constraints for the output

The implementation is React + Vite, served by a Bun process, with plain CSS. There is no
component library and none will be added.

- **No CSS frameworks.** No Tailwind, no Bootstrap, no Material.
- **No external requests.** No CDN links, no Google Fonts `<link>`, no remote images.
  If a custom font is chosen, name it and provide a system-font fallback stack; do not embed
  a 200KB base64 blob in the mockups.
- **Icons and illustrations: inline SVG only.** No icon libraries.
- **Card faces: draw them.** Do not use the Unicode playing-card block (🂡) — rendering is
  wildly inconsistent across platforms. Suit pips as inline SVG or text glyphs (♠♥♦♣) with
  explicit styling. **Cards must be legible at the small sizes a 13-card fan requires** —
  design the small size first, then scale up, not the reverse.
- **All design values as CSS custom properties** in one file. Colors, type scale, spacing,
  radii, shadows, motion durations, easing. Nothing hardcoded in a screen file.
- **Light and dark.** `prefers-color-scheme` at minimum. If only one is done well, do dark —
  game night is at night.
- **Motion:** durations and easing as tokens. Honor `prefers-reduced-motion`. The only
  animation in v1 is a card moving between zones and chips sliding to the pot.
- **Accessibility:** 4.5:1 contrast on text, 44×44pt minimum touch targets, visible focus
  states, and never encode state in color alone (folded vs. to-act must be distinguishable
  without color).

---

# 7. Deliverables

Return a `design/` folder with exactly this structure. It gets committed to the repo root
as-is.

```
design/
  README.md               # the design rationale — see below
  tokens.css              # ALL design values as CSS custom properties, light + dark
  base.css                # reset + element defaults, built only from tokens
  components.md           # component spec — see below
  screens/
    sandbox.html          # freeform table, mid-game, card selected, destinations lit
    sandbox-states.html   # empty zones, 13-card fan, zone menu, chips off, all labeled
    picker.html           # game mode + sandbox layout presets
    poker.html            # poker table, mid-hand, ordinary state
    poker-states.html     # every seat + hand state incl. side pots, labeled
    host.html             # settings, plus in-game host actions over a live table
    reveal.html           # showdown reveal AND the everyone-folded ending
    lobby.html            # name + room code, start or join
    connecting.html       # peers finding each other, code on screen
    gone.html             # the dealer closed their tab, so the game ended
```

**Every `screens/*.html` file must:**

- be a complete standalone HTML document that opens in a browser with no build step
- link only `../tokens.css` and `../base.css` — no other external references
- render correctly at 390×844 and hold at 360×740 and 430×932
- use **realistic content**: family-sounding names (Mom, Dad, Uncle R, Cousin J), real chip
  amounts, a real board, a real hand. No "Lorem ipsum," no "Player 1"
- carry HTML comments explaining non-obvious decisions, especially anything solving re-entry
- include multiple states on one page where the filename says so, each labeled with a small
  heading so it can be reviewed by scrolling

**`README.md` must cover:**

- the visual thesis in one sentence (mood, material, energy)
- why this direction, and specifically what you did *instead of* casino felt
- typography: exact families with fallback stacks, the scale, and why
- color: the palette with hex values and reasoning, light and dark
- **how the re-entry problem is solved** — the section that matters most
- **how one visual system serves both sandbox and poker** — what is shared, what differs,
  and why they read as the same product
- how a 13-card fan works on a 390px screen with a thumb
- how eight seats fit in portrait, and what you rejected getting there
- how side pots are made legible
- anything deliberately left undesigned, and why

**`components.md` must list**, for each reusable piece — card (face-up, face-down, selected,
small/large), zone (each kind and layout), hand fan, seat (poker and sandbox variants), pot,
side pot, chip counter, action button, raise control, action log entry, host action, turn
indicator, zone action menu:

- anatomy (what it is made of)
- every state it has
- which tokens it consumes
- the class names used in the screens

**Class names are the contract between your mockups and the React implementation.** Keep
them consistent across all screen files. Prefer generic names that serve both modes
(`.zone`, `.card`, `.seat`) over poker-specific ones (`.pot-area`, `.hole-card`) wherever a
component genuinely serves both.

## Process

**Do `sandbox.html` first, and give three directions before committing to one.** Three
distinct aesthetic takes on the sandbox table only — different enough to be a real choice,
not three shades of the same idea. Stop there and wait for a pick.

Sandbox first, not poker, because it exercises the generic zone system with nothing to hide
behind. If the visual language works for a freeform table of arbitrary zones, poker is a
constrained case of it. The reverse is not true.

Everything else follows the chosen direction.

Do not write React. Do not write JavaScript beyond what a static mockup needs (usually
none). The implementation happens separately.
