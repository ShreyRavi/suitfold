# suitfold - design

**Visual thesis:** a warm printed card table - clay, paper and ink - that reads like a
well-used family game box, not a card room.

## Why this, and what we did instead of casino felt

Every competitor is dark green felt, gold chips and ornate backs because they are chasing
poker players. Nobody at this table is optimising their game. So the surface is a **clay
slab with a raised rim** (`--table`, `--inset-table`) over a **warm paper app background**
(`--paper`), with a single ink blue (`--accent`) doing every piece of asking the app does -
selection, destinations, primary action. Card backs are a printed red (`--card-back`), the
red of a supermarket deck, not a foil. There is exactly one accent hue and two surface
tones in the whole product.

## Typography

- Display / all UI: `"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, "Times New Roman", serif`
  - a warm book serif that ships on Apple and degrades to Georgia everywhere else. No web font, no request.
- Numbers, labels, counts: `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace` -
  chip amounts and card counts are tabular, so they stop jittering as they change.
- Scale: 11 / 12 / 13 / 15 / 17 / 21 / 23. Nothing below 11px, and 11px is reserved for
  letterspaced uppercase mono labels. Seat names are 17px, so the table is readable at arm's
  length in a lit room.

## Colour

Light (default): paper `#e9e2d3`, panels `#f6f1e6`, table `#cbb79a`, ink `#2a251f`,
accent `#1f4b7a`, card back `#c05334`, suit red `#b02b1e`.
Dark (`prefers-color-scheme`): the same structure at lamp light - background `#191714`,
table `#3a3128`, ink `#efe6d6`, accent lifted to `#7fa9d6` to hold 4.5:1 on dark.
Card faces stay paper-coloured in both modes: a card is a physical object, it does not
invert.

## How re-entry is solved

There is no notification channel, so the state on arrival does all the work. Three things
answer the three questions without reading:

1. **Is it my turn / what am I doing?** The primary action button in the thumb zone always
   names the actual pending act in words ("Move 9♦ to discard"). If nothing is pending it
   is not a button.
2. **What is my stack / hand?** The rail is fixed to the bottom: chips on the left, hand on
   the right, always in the same place, never scrolled away.
3. **What did I miss?** Counts are visible on every seat at all times, so a changed table
   is legible by comparison, not by memory.

State is never encoded in colour alone: lit destinations carry the words MOVE HERE, and
folded seats carry the word "folded".

## One system, both modes

Shared: the app shell, the nav, the table slab, the seat panel, the card, the zone, the
hand fan, the rail and the action buttons. The only difference between sandbox and poker
is what `.seat-metric` holds - a card count or a chip stack - and which zones the table
happens to contain. That is why Go Fish and poker look like the same product.

## The 13-card fan

Cards overlap left-over-right at `--hand-overlap: -12px`, so every card's top-left corner
(rank + pip, the only identity a card needs) stays exposed. The selected card **opts out of
the overlap** rather than lifting over its neighbour, which is what made an earlier version
unreadable. At 13 cards the fan widens the overlap rather than shrinking the card, because
the small card size was designed first.

## Eight seats in portrait

Rejected: a literal oval - at 390px the side seats squeeze to ~60px and names wrap.
Chosen: seats ride the rim in **even rows**, two per row, top and bottom of the slab. Every
seat panel is identical, and going from four to eight is adding rim rows, not redesigning.
The table metaphor survives because the slab, the rim and the middle are still there.

## Deliberately left undesigned in this drop

Poker, join, host, reveal, recap, ledger and offline screens - the sandbox table is the
approved direction and everything else follows it. Side pots, the raise control and the
action log are specified in `components.md` but not yet drawn.
