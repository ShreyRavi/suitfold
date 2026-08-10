# Components

Class names are the contract between these mockups and the React implementation. Generic
names serve both modes; nothing is poker-specific unless the concept is.

## .card
Anatomy: face (`--card-face`), 1px edge, `.card-rank` top-left, `.card-pip` under it,
optional `.card-pip--big` bottom-right on large cards.
Sizes: `.card` (46×65, the size the fan is designed at), `.card--md` (52×74),
`.card--lg` (58×82).
States: default, `.is-red`, `.card--face-down` (printed back, no face), `.card--selected`
(2px accent border, lift, accent underline, opts out of fan overlap).
Tokens: `--card-face --card-edge --card-back --card-back-edge --suit-red --r-card --shadow-card --shadow-lift --dur-move`.

## .zone / .zone-slot / .zone-label / .zone-cards
Kinds: deck (`.stack` for physical thickness), discard (top card visible), board, trick, pile.
Layouts: stack (`.stack`), row (`.zone-cards`), fan (`.hand-inner`), grid.
States: default, `.zone--target` (accent ring + the words MOVE HERE), `.zone--empty`
(dashed slot), count in `.zone-label`.
Tokens: `--accent --ink-soft --font-mono --text-sm --r-card`.

## .seat (poker + sandbox)
Anatomy: `.seat-head` (`.seat-name` + `.seat-metric`) over `.chip-stack`.
Sandbox metric = card count. Poker metric = stack. Chip stack hidden when chips are off.
States: default, `.seat--to-act` (accent ring), `.seat--folded` (dimmed **and** the word
folded), plus all-in / disconnected / busted / stood-up on the same pattern — each carries
a word, never colour alone.
Tokens: `--paper-panel --line --r-panel --text-lg --text-sm --ink-faint`.

## .chips / .chip / .chip-amount
Stacked bars, colour by denomination (`--chip-high`, `--chip-low`, `--chip-pale`), amount
in mono beside them. Same component at seat scale (17×4) and rail scale (24×6).

## .hand / .hand-inner
Fan with `--hand-overlap`. Selected card sets its own margins to break the overlap.
Long hands widen the overlap; the card never shrinks below `--card-w-sm`.

## .rail
Your side of the table: `.rail-label`, `.rail-value` (chips), `.rail-note` (what is
selected, in words). Fixed to the bottom — the re-entry anchor.

## .btn / .btn--primary
Minimum 52px tall (over the 44pt floor), primary is accent-filled and always names the act.

## .nav / .brand / .nav-meta / .nav-menu
Wordmark left, night context right, host menu at a 44×44 target.

## Not yet drawn (specified, pending)
`.pot`, `.pot--side` (one row per pot with an explicit eligible-seat list),
`.raise` (preset chips: min / ½ pot / pot / all-in, plus a keypad — no slider),
`.log-entry`, `.host-action`, `.turn-indicator`, `.zone-menu`.
