# suitfold

Live URL: [https://shreyravi.github.io/suitfold/](https://shreyravi.github.io/suitfold/)

A live card table you share with a link. A deck, a table, your hand, and whoever you
invite. Drag the cards around like you would at a kitchen table.

**The app does not know what game you are playing, and does not need to.** It deals cards
and moves them; the rules live in the heads of the people at the table, exactly like they
do with a real deck.

## Playing

Open the site, type your name, and either start a table or type someone's five-character
code. Sharing the link works too - `…/suitfold/#ABC23` fills the code in.

- **Drag** a card to move it. Everyone sees it slide in real time.
- **Drop one card on another** and they snap into a pile.
- **Double-click** a card to flip it.
- **Tap the count** on a pile for flip all, shuffle, take into hand, or spread out.
- **Drag the count** to move the whole pile. Dragging a card takes that card; dragging the
  number on it takes the stack.
- **Drag a card to the bottom** of the screen to take it into your hand.
- Cards in your hand are yours alone. Play them face up or face down.
- **Slots** - the dashed outlines with names on them - are markings on the felt.
  Cards snap into them. They hold nothing and enforce nothing; they just say where
  things go, which is what makes a table read as Hearts rather than a pile of cards.
- **Score** in the toolbar counts whatever this table is counting: tricks, points, lives.
- **New hand** deals the whole table in one press: everything gathered and shuffled, cards to
  each player, and for poker the five middle cards laid face down so you turn the flop, the
  turn and the river as you go.
- **Chips**, on games that use them, live down with your hand: your stack, one-tap amounts,
  and **Take pot** the moment there is one to take - which asks first, since who won is the
  one thing the table cannot settle for you.
- **Gather** puts every card back on the deck's own marked spot.
- **Solitaire** is in there too, for when nobody else is about.
- **Drag a card out of your hand** straight onto the table, or use the buttons.
- **The drawers resize.** Grab the handle at the top of your hand, or the left
  edge of the log, and whatever you set is remembered.
- **Right-click** turns a card over. **Hold** on one for the pile menu, and
  **hover** it to read it at full size.
- **Everyone sits somewhere.** Seats go round the table in the order people
  arrived, with whoever brought the deck at the bottom - the same on every
  screen, so "in front of Mum" means one place rather than a different place in
  every browser. You can see everyone's pointer moving, too.
- **Everyone has a face.** Pick an emoji when you sit down. Two people will
  both type "Dad"; the second becomes "Dad 2", but the face is what actually
  tells them apart.
- **Double-click a card** to read it at full size.
- **Markers** are discs with something written on them - the dealer button, the
  blinds, whose turn it is, or anything you type. Any game, any label.
- **If the dealer's tab dies**, it offers the table back when it reopens. The
  code stays the same, so everyone else reconnects to their own seat with their
  own cards. It is kept in that one browser and nowhere else, and closing the
  table on purpose throws it away.
- **The log** down the right-hand side lists everything that has happened, with
  the time against each line, and is where you talk. Type `@Dad` and Dad gets a
  notice on top of whatever he is looking at; `@all` gets everyone. Whoever is
  holding the deck can clear it. Chips moving also comes past as a toast,
  because that is the one thing you cannot afford to miss while looking at your
  own hand.
- **The dealer button and the blinds** are discs on the felt for poker. Drag
  them a seat to the left between hands. They enforce nothing.
- **A space in front of every player**, marked on the felt, where the cards
  they play land. Somebody's hand is drawn as a fan of backs rather than a
  number, because counting them is part of the game.
- **A help button** in the bar, shown once by itself the first time you sit
  down, with the handful of gestures the table never explains about itself.
- **Chinese Checkers** is in the picker. It is the same table: the board is a
  hundred and twenty one places on the felt, the marbles are markers, and the
  marbles drop into the holes. Nothing about the moves is enforced, exactly as
  nothing about a deck of cards is.
- **Deal → All of them** hands the whole pile out evenly, which is how Bluff, War, Snap and
  Old Maid start. They are drawn as real stacks but they are an amount underneath,
  so calling a bet is one tap rather than dragging seven discs. Nothing is enforced - the
  table only checks you have the chips, never whether the bet was legal.

## Running your own table server

Optional, and off by default. Browsers talk to each other directly and that
needs nothing. If you would rather everything went through a box you own - so
messages arrive in order, reconnecting takes a second, and no public relay is
involved - there is a small server in [`server/`](server/README.md) with a
Dockerfile that Coolify can deploy as it stands. It forwards sealed messages and
never sees a card.

## Games

Thirty three of them now, and not all of them are card games. The table grew a
few primitives to cover the rest, and each one is the same kind of thing the
cards already were: dice the host rolls (because rolling has to be unguessable,
exactly like shuffling), squares of a board, holes, lines drawn underneath,
markers you drag, a shared clock, and a pad only you can see. Tiles and dominoes
are not a new thing at all - they are cards with a different face, so everything
the table already did to a card works on them unchanged.

Every game has a **?** next to it, in the picker and on the table, with the rules in plain
words - including which poker hand beats which, and the bits people actually argue about.

Whoever starts the table picks one. A game only decides **which cards come out, how many
each person gets, and where they start** - nothing is enforced, so you play it the way your
family plays it.

**Card games** - Poker (Hold'em) · Indian Rummy · Gin Rummy · Blackjack · Hearts · Spades ·
Euchre · Cribbage · Big Two / President

**Family** - Uno · Crazy Eights · Bluff / Cheat · Go Fish · Old Maid · War · Snap · Memory

**Just cards** - a deck, a deck with jokers, two decks, or the Uno deck with nothing dealt

Uno brings its own 108-card deck and its own card faces. Indian Rummy uses two decks plus
jokers, thirteen each, with a card turned up. Memory lays the whole deck out face down in a
grid. Everything else is a normal deck arranged differently.

## There is no server

Browsers find each other through public relays and then talk **directly** over WebRTC.
Nothing of ours runs anywhere, nothing is stored, and hosting costs nothing.

Three things follow from that:

**One tab holds the deck.** Whoever starts the table shuffles and deals. If they close the
tab, the table is gone.

**That person could look at the deck.** Everyone else only ever receives what they are
entitled to see - your hand is never sent to anybody else's browser, and a face-down card
has no face in their copy of the table. But the host holds the cards, like whoever shuffles
at a kitchen table. Play with people you would hand a real deck to.

**Nothing is saved.** Close the tab and the game is over. It is a game, not a bank.

## Development

```sh
bun install
bun run dev        # http://localhost:5173
bun test           # table model, visibility, seating
bun run typecheck
bun run build
```

Two tabs on localhost are enough to test a real two-player table.

## Deploying

Push to `main`. GitHub Actions typechecks, tests, builds and publishes to Pages. Enable it
once under **Settings → Pages → Source: GitHub Actions**.

## How it is put together

```
src/table/model.ts   the table: cards at positions, and the only reducer
src/table/deck.ts    decks and presets - just lists of card ids
src/net/peers.ts     WebRTC transport, table codes
src/net/host.ts      the tab that holds the deck
src/client/          React: the felt, the cards, your hand
design/              tokens and base styles
```

**A card is at a position, not in a zone.** That is the whole model, and it is what makes
the table feel alive: you pick a card up, you put it somewhere, everyone sees it move.

**Piles are not a thing.** Cards dropped near each other snap to exactly the same spot, so
a pile is just "the cards sharing a spot". There is no pile to create, split or corrupt.

**Two kinds of traffic.** Actions go to the host, which applies them and sends back the
table - that is the honest path. Drags go straight to everyone many times a second and are
never stored, because routing them through the host would make cards jump instead of
slide.

**One function decides what you can see.** `project()` includes a card's face when it is
face up on the table or in your own hand, and never otherwise.

## Known limits

- **Peer-to-peer fails on some networks.** Symmetric NAT needs a TURN relay, which this
  does not have. Worth testing with the people you actually play with before relying on it.
- **The host's tab must stay open and awake.**
- **Public relays are shared**, so joining can occasionally be slow. No cards go through
  them - they are only how browsers find each other.
