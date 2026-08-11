import type { CardId, Slot } from './model.ts'
import { TABLE_H, TABLE_W } from './model.ts'

/**
 * Decks are lists of card ids, and presets are furniture: which cards come out,
 * how many each person gets, and where they start. No rules are enforced
 * anywhere — the game lives in the heads of the people at the table.
 */

export const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K'] as const
export const SUITS = ['S', 'H', 'D', 'C'] as const

export const isUno = (id: CardId) => id.startsWith('U')
export const isJoker = (id: CardId) => id.startsWith('X')
export const rankOf = (id: CardId) => id[0]!
export const suitOf = (id: CardId) => id[1]!
export const isRed = (id: CardId) => id[1] === 'H' || id[1] === 'D'

/**
 * Ids are `<rank><suit>` in the first deck and `<rank><suit>:<n>` after that,
 * because two decks would otherwise put the same id on the table twice.
 */
export function standard(decks = 1, jokers = 0): CardId[] {
  const out: CardId[] = []
  for (let d = 1; d <= decks; d++) {
    const tag = d === 1 ? '' : `:${d}`
    for (const s of SUITS) for (const r of RANKS) out.push(`${r}${s}${tag}`)
  }
  for (let j = 1; j <= jokers; j++) out.push(`X${j}`)
  return out
}

/** Nine through ace only — the short deck euchre uses. */
export const euchre = (): CardId[] => {
  const out: CardId[] = []
  for (const s of SUITS) for (const r of ['9', 'T', 'J', 'Q', 'K', 'A']) out.push(`${r}${s}`)
  return out
}

/** A standard deck with one queen removed, so exactly one is left unpaired. */
export const oldMaid = (): CardId[] => standard(1).filter((id) => id !== 'QC')

// ---------------------------------------------------------------------------
// Uno
// ---------------------------------------------------------------------------

export const UNO_COLOURS = ['R', 'G', 'B', 'Y'] as const
export type UnoColour = (typeof UNO_COLOURS)[number]

/** `U<colour><value>`: UR5, URS skip, URV reverse, URT draw two, UW wild, UF wild draw four. */
export const unoColour = (id: CardId) => id[1]!
export const unoValue = (id: CardId) => id.slice(2).split(':')[0]!
export const isUnoWild = (id: CardId) => id[1] === 'W' || id[1] === 'F'

export const UNO_LABEL: Record<string, string> = {
  S: 'skip',
  V: 'reverse',
  T: '+2',
  W: 'wild',
  F: '+4',
}

/**
 * The real 108: one zero and two of everything else per colour, plus four
 * wilds and four wild draw fours.
 */
export function uno(): CardId[] {
  const out: CardId[] = []
  const push = (id: string, n: number) => {
    for (let i = 1; i <= n; i++) out.push(i === 1 ? id : `${id}:${i}`)
  }
  for (const c of UNO_COLOURS) {
    push(`U${c}0`, 1)
    for (const v of ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'S', 'V', 'T']) push(`U${c}${v}`, 2)
  }
  push('UW', 4)
  push('UF', 4)
  return out
}

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

export type Layout = 'pile' | 'starter' | 'grid'

export interface Preset {
  id: string
  name: string
  players: string
  hint: string
  group: 'card games' | 'family' | 'just cards'
  cards: () => CardId[]
  /** Cards to each player. -1 deals the whole deck out evenly. */
  deal: number
  layout: Layout
  /**
   * Markings on the felt. They hold nothing and enforce nothing — they say
   * where things go, which is what makes a freeform table read as a game.
   */
  slots?: (seats: number) => Slot[]
}

const CX = TABLE_W / 2
const CY = TABLE_H / 2

/** Draw pile on the left of centre, discard on the right. */
const drawDiscard = (): Slot[] => [
  { id: 'draw', x: CX - 62, y: CY, label: 'Draw' },
  { id: 'discard', x: CX + 62, y: CY, label: 'Discard' },
]

/** One slot per player, spread around the middle, plus a shared one. */
const roundTable = (n: number, middle: string): Slot[] => {
  const out: Slot[] = [{ id: 'middle', x: CX, y: CY, label: middle }]
  const rx = 250
  const ry = 168
  for (let i = 0; i < Math.max(n, 2); i++) {
    const angle = (Math.PI * 2 * i) / Math.max(n, 2) - Math.PI / 2
    out.push({
      id: `p${i + 1}`,
      x: CX + rx * Math.cos(angle),
      y: CY + ry * Math.sin(angle),
      label: `Player ${i + 1}`,
    })
  }
  return out
}

export const PRESETS: Preset[] = [
  // -- card games ---------------------------------------------------------
  {
    id: 'holdem',
    name: 'Poker',
    players: '2–10',
    hint: "Two each, Texas Hold'em",
    group: 'card games',
    cards: () => standard(1),
    deal: 2,
    layout: 'pile',
    slots: () => [
      { id: 'board', x: CX, y: CY - 40, label: 'Board', wide: 5 },
      { id: 'pot', x: CX, y: CY + 90, label: 'Pot' },
    ],
  },
  {
    id: 'indian-rummy',
    name: 'Indian Rummy',
    players: '2–6',
    hint: 'Two decks + jokers, 13 each, open pile',
    group: 'card games',
    cards: () => standard(2, 2),
    deal: 13,
    layout: 'starter',
    slots: drawDiscard,
  },
  {
    id: 'gin',
    name: 'Gin Rummy',
    players: '2',
    hint: '10 each, open pile',
    group: 'card games',
    cards: () => standard(1),
    deal: 10,
    layout: 'starter',
    slots: drawDiscard,
  },
  {
    id: 'blackjack',
    name: 'Blackjack',
    players: '2–7',
    hint: 'Two each, dealer draws from the shoe',
    group: 'card games',
    cards: () => standard(2),
    deal: 2,
    layout: 'pile',
    slots: (n: number) => roundTable(n, 'Dealer'),
  },
  {
    id: 'hearts',
    name: 'Hearts',
    players: '4',
    hint: '13 each, whole deck out',
    group: 'card games',
    cards: () => standard(1),
    deal: 13,
    layout: 'pile',
    slots: (n: number) => roundTable(n, 'Trick'),
  },
  {
    id: 'spades',
    name: 'Spades',
    players: '4',
    hint: '13 each, partners',
    group: 'card games',
    cards: () => standard(1),
    deal: 13,
    layout: 'pile',
    slots: (n: number) => roundTable(n, 'Trick'),
  },
  {
    id: 'euchre',
    name: 'Euchre',
    players: '4',
    hint: '24-card deck, 5 each',
    group: 'card games',
    cards: euchre,
    deal: 5,
    layout: 'starter',
    slots: (n: number) => roundTable(n, 'Trick'),
  },
  {
    id: 'cribbage',
    name: 'Cribbage',
    players: '2',
    hint: '6 each, cut card turned up',
    group: 'card games',
    cards: () => standard(1),
    deal: 6,
    layout: 'starter',
    slots: () => [
      { id: 'crib', x: CX + 130, y: CY, label: 'Crib' },
      { id: 'cut', x: CX - 62, y: CY, label: 'Cut' },
      { id: 'play', x: CX, y: CY + 96, label: 'Play', wide: 4 },
    ],
  },
  {
    id: 'big-two',
    name: 'Big Two / President',
    players: '3–4',
    hint: 'Whole deck dealt out',
    group: 'card games',
    cards: () => standard(1),
    deal: -1,
    layout: 'pile',
    slots: () => [{ id: 'play', x: CX, y: CY, label: 'Play' }],
  },

  // -- family -------------------------------------------------------------
  {
    id: 'uno',
    name: 'Uno',
    players: '2–10',
    hint: '108 cards, 7 each, one turned up',
    group: 'family',
    cards: uno,
    deal: 7,
    layout: 'starter',
    slots: drawDiscard,
  },
  {
    id: 'crazy-eights',
    name: 'Crazy Eights',
    players: '2–7',
    hint: 'Uno with a normal deck, 7 each',
    group: 'family',
    cards: () => standard(1),
    deal: 7,
    layout: 'starter',
    slots: drawDiscard,
  },
  {
    id: 'bluff',
    name: 'Bluff / Cheat',
    players: '3–8',
    hint: 'Whole deck dealt out',
    group: 'family',
    cards: () => standard(1),
    deal: -1,
    layout: 'pile',
    slots: () => [{ id: 'pile', x: CX, y: CY, label: 'Pile' }],
  },
  {
    id: 'go-fish',
    name: 'Go Fish',
    players: '2–6',
    hint: '7 each, rest in the pond',
    group: 'family',
    cards: () => standard(1),
    deal: 7,
    layout: 'pile',
    slots: () => [{ id: 'pond', x: CX, y: CY, label: 'Pond' }],
  },
  {
    id: 'old-maid',
    name: 'Old Maid',
    players: '2–8',
    hint: 'One queen removed, all dealt out',
    group: 'family',
    cards: oldMaid,
    deal: -1,
    layout: 'pile',
    slots: () => [{ id: 'pairs', x: CX, y: CY, label: 'Pairs', wide: 4 }],
  },
  {
    id: 'war',
    name: 'War',
    players: '2',
    hint: 'Deck split in half',
    group: 'family',
    cards: () => standard(1),
    deal: -1,
    layout: 'pile',
    slots: () => [
      { id: 'l', x: CX - 62, y: CY, label: 'Yours' },
      { id: 'r', x: CX + 62, y: CY, label: 'Theirs' },
    ],
  },
  {
    id: 'snap',
    name: 'Snap',
    players: '2–6',
    hint: 'Whole deck dealt out',
    group: 'family',
    cards: () => standard(1),
    deal: -1,
    layout: 'pile',
    slots: () => [{ id: 'pile', x: CX, y: CY, label: 'Pile' }],
  },
  {
    id: 'memory',
    name: 'Memory',
    players: '2+',
    hint: 'Whole deck face down in a grid',
    group: 'family',
    cards: () => standard(1),
    deal: 0,
    layout: 'grid',
  },

  // -- just cards ---------------------------------------------------------
  {
    id: 'deck',
    name: 'Just a deck',
    players: 'any',
    hint: '52 cards, nothing dealt',
    group: 'just cards',
    cards: () => standard(1),
    deal: 0,
    layout: 'pile',
  },
  {
    id: 'deck-jokers',
    name: 'Deck + jokers',
    players: 'any',
    hint: '54 cards, nothing dealt',
    group: 'just cards',
    cards: () => standard(1, 2),
    deal: 0,
    layout: 'pile',
  },
  {
    id: 'double',
    name: 'Two decks',
    players: 'any',
    hint: '104 cards + 2 jokers',
    group: 'just cards',
    cards: () => standard(2, 2),
    deal: 0,
    layout: 'pile',
  },
  {
    id: 'uno-only',
    name: 'Uno deck',
    players: 'any',
    hint: '108 cards, nothing dealt',
    group: 'just cards',
    cards: uno,
    deal: 0,
    layout: 'pile',
  },
]

export const GROUPS = ['card games', 'family', 'just cards'] as const
export const presetById = (id: string) => PRESETS.find((p) => p.id === id) ?? PRESETS[0]!

// ---------------------------------------------------------------------------
// Where the cards start
// ---------------------------------------------------------------------------

export interface Placed {
  id: CardId
  faceUp: boolean
  x: number
  y: number
}

/**
 * Lay the deck out. Everything left after dealing goes into the draw pile,
 * except the one card a "starter" game turns face up beside it.
 */
export function place(preset: Preset, undealt: CardId[]): Placed[] {
  const mid = { x: TABLE_W / 2, y: TABLE_H / 2 }

  if (preset.layout === 'grid') {
    const cols = 13
    const gapX = 68
    const gapY = 104
    const rows = Math.ceil(undealt.length / cols)
    const left = mid.x - ((cols - 1) * gapX) / 2
    const top = mid.y - ((rows - 1) * gapY) / 2
    return undealt.map((id, i) => ({
      id,
      faceUp: false,
      x: left + (i % cols) * gapX,
      y: top + Math.floor(i / cols) * gapY,
    }))
  }

  if (preset.layout === 'starter' && undealt.length > 1) {
    const [starter, ...rest] = undealt
    return [
      { id: starter!, faceUp: true, x: mid.x + 62, y: mid.y },
      ...rest.map((id) => ({ id, faceUp: false, x: mid.x - 62, y: mid.y })),
    ]
  }

  return undealt.map((id) => ({ id, faceUp: false, x: mid.x, y: mid.y }))
}

/** Unbiased shuffle — rejection sampling, never `% n`. */
export function shuffle<T>(input: readonly T[], rng: () => number = Math.random): T[] {
  const a = input.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const ai = a[i]!
    a[i] = a[j]!
    a[j] = ai
  }
  return a
}

export function cryptoShuffle<T>(input: readonly T[]): T[] {
  return shuffle(input, () => {
    const buf = new Uint32Array(1)
    crypto.getRandomValues(buf)
    return buf[0]! / 2 ** 32
  })
}
