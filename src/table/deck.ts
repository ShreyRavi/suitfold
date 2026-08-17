import type { CardId, Die, Line, Puck, Slot } from './model.ts'
import { CARD_GAP, CARD_H, CARD_W, TABLE_H, TABLE_W } from './model.ts'
import { marbles, starSlots } from './star.ts'
import { bananaTiles, dominoTiles, scrabbleTiles } from './tiles.ts'
import {
  boggleDice,
  boggleTray,
  chessBoard,
  chessPieces,
  fiveDice,
  oneDie,
  scrabbleBoard,
  snakesBoard,
  snakesLines,
  snakesTokens,
} from './boards.ts'

/**
 * Decks are lists of card ids, and presets are furniture: which cards come out,
 * how many each person gets, and where they start. No rules are enforced
 * anywhere - the game lives in the heads of the people at the table.
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

/** Nine through ace only - the short deck euchre uses. */
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

export type Layout = 'pile' | 'starter' | 'grid' | 'klondike'

export interface Preset {
  id: string
  name: string
  players: string
  hint: string
  group: 'card games' | 'family' | 'just cards'
  cards: () => CardId[]
  /**
   * Cards to each player. -1 deals the whole deck out evenly. A function when
   * the real rule depends on how many are playing, which is how the games with
   * a fixed supply of tiles avoid running out.
   */
  deal: number | ((seats: number) => number)
  layout: Layout
  /**
   * Markings on the felt. They hold nothing and enforce nothing - they say
   * where things go, which is what makes a freeform table read as a game.
   */
  slots?: (seats: number) => Slot[]
  /** Chips each player starts with. Omitted means this game is not for chips. */
  chips?: number
  /**
   * What one hand of this game looks like, for the single-press deal: cards to
   * each player, and how many go face down in the middle to be turned over as
   * the hand goes.
   */
  hand?: { each: number | ((seats: number) => number); board?: number; boardSlot?: string }
  /** Draggable markers: the dealer button, the blinds, the playing pieces. */
  pucks?: (seats: number) => Puck[]
  /** Dice on the table when it is set. */
  dice?: () => Die[]
  /** Board furniture drawn underneath: snakes, ladders. */
  lines?: () => Line[]
  /** A clock this game is played against, in seconds. */
  clock?: number
  /** Somewhere private to write. Boggle needs one, Yahtzee needs one. */
  pad?: string
  /**
   * Won tricks are gathered up by whoever took them, over and over, so there
   * is a button for it rather than four separate picks every single trick.
   */
  trick?: boolean
  /**
   * Cards go to the row for their own suit, in rank order out from the seven.
   * Sevens is unplayable otherwise: every card is a drag to the right row.
   */
  bySuit?: boolean
  /**
   * Games where you have to announce something every turn. Saying it out loud
   * used to mean typing a sentence into chat, which cost more than the move it
   * described. 'rank' is what you claim to be putting down, truthfully or not;
   * 'bid' is how many tricks you say you will take.
   */
  claim?: 'rank' | 'bid'
}

const CX = TABLE_W / 2
const CY = TABLE_H / 2

/**
 * The dealer button and the two blinds. Nothing about them is enforced - they
 * sit on the felt and somebody drags them one seat to the left between hands,
 * which is exactly what the plastic discs on a real table are for.
 */
// Tucked under the deck rather than floating in the middle of nothing.
const blinds = (): Puck[] => [
  { id: 'pk-d', x: CX - 476, y: CY + 110, label: 'D', hint: 'Dealer button' },
  { id: 'pk-sb', x: CX - 420, y: CY + 110, label: 'SB', hint: 'Small blind' },
  { id: 'pk-bb', x: CX - 364, y: CY + 110, label: 'BB', hint: 'Big blind' },
  // Knows nothing and enforces nothing. Whoever is next drags it to themselves,
  // which is exactly how a real table remembers whose go it is.
  { id: 'pk-trn', x: CX - 476, y: CY + 175, label: 'TRN', hint: 'Whose turn it is' },
]

/**
 * Dominoes builds a line across the table, so there is nowhere sensible to send
 * a bone automatically - stacking them all on one spot would be worse than
 * making you place them. Just the boneyard, then.
 */
const boneyard = (): Slot[] => [{ id: 'draw', x: CX - 380, y: CY, label: 'Boneyard' }]

/** Draw pile on the left of centre, discard on the right. */
const drawDiscard = (): Slot[] => [
  { id: 'draw', x: CX - CARD_GAP / 2 - 12, y: CY, label: 'Draw' },
  // What you play goes on the discard, which is the whole shape of these games.
  { id: 'discard', x: CX + CARD_GAP / 2 + 12, y: CY, label: 'Discard', play: true },
]

/**
 * Just the middle. There used to be a slot per player as well, but every seat
 * now has its own marked space in front of it, and the two landed on top of
 * each other: two dashed outlines, one labelled "Player 1" and one labelled
 * with your name, a few pixels apart.
 */
const roundTable = (_n: number, middle: string): Slot[] => [{ id: 'middle', x: CX, y: CY, label: middle }]

/** Twenty one each up to four, fifteen up to six, eleven beyond that. */
const dealBanana = (seats: number) => (seats <= 4 ? 21 : seats <= 6 ? 15 : 11)
/** Seven each head to head, five each in a bigger game. */
const dealDominoes = (seats: number) => (seats <= 2 ? 7 : 5)

export const PRESETS: Preset[] = [
  // -- card games ---------------------------------------------------------
  {
    id: 'holdem',
    name: 'Poker',
    players: '2-10',
    hint: "Two each, Texas Hold'em",
    group: 'card games',
    cards: () => standard(1),
    deal: 2,
    layout: 'pile',
    // The middle of the table is the board, and the spaces in front of each
    // player are theirs, so the deck and the pot go out to the sides - but in
    // line with the board, not off in a corner. The pot had been stranded up in
    // the top right, which is nowhere near the cards it belongs to or the
    // people pushing chips into it.
    slots: () => [
      { id: 'deck', x: CX - 420, y: CY, label: 'Deck' },
      { id: 'board', x: CX, y: CY, label: 'Board', wide: 5 },
      { id: 'pot', x: CX + 420, y: CY, label: 'Pot', small: true },
    ],
    chips: 2000,
    hand: { each: 2, board: 5, boardSlot: 'board' },
    pucks: blinds,
  },
  {
    id: 'indian-rummy',
    name: 'Indian Rummy',
    players: '2-6',
    hint: 'Two decks + jokers, 13 each, open pile',
    group: 'card games',
    cards: () => standard(2, 2),
    deal: 13,
    layout: 'starter',
    slots: drawDiscard,
    hand: { each: 13 },
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
    hand: { each: 10 },
  },
  {
    id: 'blackjack',
    name: 'Blackjack',
    players: '2-7',
    hint: 'Two each, dealer draws from the shoe',
    group: 'card games',
    cards: () => standard(2),
    deal: 2,
    layout: 'pile',
    slots: (n: number) => [{ id: 'deck', x: CX - 320, y: CY, label: 'Shoe' }, ...roundTable(n, 'Dealer')],
    chips: 500,
    hand: { each: 2 },
  },
  {
    id: 'hearts',
    name: 'Spade Queen',
    players: '4',
    hint: 'Also called Hearts or Black Maria. Duck the hearts and the black lady',
    group: 'card games',
    cards: () => standard(1),
    deal: 13,
    layout: 'pile',
    slots: () => [{ id: 'middle', x: CX, y: CY, label: 'Pile', play: true }],
    hand: { each: 13 },
    trick: true,
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
    slots: (n: number) => roundTable(n, 'Pile'),
    hand: { each: 13 },
    trick: true,
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
    slots: (n: number) => roundTable(n, 'Pile'),
    hand: { each: 5 },
    trick: true,
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
    hand: { each: 6 },
  },
  {
    id: 'big-two',
    name: 'Big Two / President',
    players: '3-4',
    hint: 'Whole deck dealt out',
    group: 'card games',
    cards: () => standard(1),
    deal: -1,
    layout: 'pile',
    slots: () => [{ id: 'play', x: CX, y: CY, label: 'Play', play: true }],
  },

  // -- family -------------------------------------------------------------
  {
    id: 'uno',
    name: 'Uno',
    players: '2-10',
    hint: '108 cards, 7 each, one turned up',
    group: 'family',
    cards: uno,
    deal: 7,
    layout: 'starter',
    slots: drawDiscard,
    hand: { each: 7 },
  },
  {
    id: 'crazy-eights',
    name: 'Crazy Eights',
    players: '2-7',
    hint: 'Uno with a normal deck, 7 each',
    group: 'family',
    cards: () => standard(1),
    deal: 7,
    layout: 'starter',
    slots: drawDiscard,
    hand: { each: 7 },
  },
  {
    id: 'bluff',
    name: 'Bluff / Cheat',
    players: '3-8',
    hint: 'Whole deck dealt out',
    group: 'family',
    cards: () => standard(1),
    deal: -1,
    layout: 'pile',
    slots: () => [{ id: 'pile', x: CX, y: CY, label: 'Pile', play: true }],
    claim: 'rank',
  },
  {
    id: 'go-fish',
    name: 'Go Fish',
    players: '2-6',
    hint: '7 each, rest in the pond',
    group: 'family',
    cards: () => standard(1),
    deal: 7,
    layout: 'pile',
    slots: () => [{ id: 'draw', x: CX, y: CY, label: 'Pond' }],
    hand: { each: 7 },
  },
  {
    id: 'old-maid',
    name: 'Old Maid',
    players: '2-8',
    hint: 'One queen removed, all dealt out',
    group: 'family',
    cards: oldMaid,
    deal: -1,
    layout: 'pile',
    slots: () => [{ id: 'pairs', x: CX, y: CY, label: 'Pairs', wide: 4, play: true }],
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
    players: '2-6',
    hint: 'Whole deck dealt out',
    group: 'family',
    cards: () => standard(1),
    deal: -1,
    layout: 'pile',
    slots: () => [{ id: 'pile', x: CX, y: CY, label: 'Pile', play: true }],
  },
  {
    id: 'solitaire',
    name: 'Solitaire',
    players: '1',
    hint: 'Klondike, laid out and ready',
    group: 'just cards',
    cards: () => standard(1),
    deal: 0,
    layout: 'klondike',
    slots: () => [
      { id: 'draw', x: CX - 3.5 * CARD_GAP, y: CY - 190, label: 'Stock' },
      { id: 'waste', x: CX - 2.5 * CARD_GAP, y: CY - 190, label: 'Waste' },
      ...['Spades', 'Hearts', 'Diamonds', 'Clubs'].map((suit, i) => ({
        id: `f${i}`,
        x: CX + (i - 0.5) * CARD_GAP,
        y: CY - 190,
        label: suit,
      })),
      ...Array.from({ length: 7 }, (_, i) => ({
        id: `t${i}`,
        x: CX + (i - 3) * CARD_GAP,
        y: CY + 40,
        label: '',
      })),
    ],
  },
  {
    id: 'judgement',
    name: 'Judgement',
    players: '3-7',
    hint: 'Bid your tricks exactly, or score nothing',
    group: 'card games',
    cards: () => standard(1),
    // One each for the first round, which is how the game starts. Every round
    // after that is one more, and the dealer sets that with Deal.
    deal: 1,
    layout: 'starter',
    slots: (n: number) => roundTable(n, 'Pile'),
    hand: { each: 1 },
    trick: true,
    claim: 'bid',
  },
  {
    id: 'kot-pees',
    name: 'Kot Pees',
    players: '4',
    hint: 'Court Piece: partners, thirteen each, trump called on the first four',
    group: 'card games',
    cards: () => standard(1),
    deal: 13,
    layout: 'pile',
    slots: (n: number) => roundTable(n, 'Pile'),
    hand: { each: 13 },
    trick: true,
  },
  {
    id: 'spade-seven',
    name: 'Sevens',
    players: '3-8',
    hint: 'Satti, Fan Tan, Parliament: build out from the sevens',
    group: 'card games',
    cards: () => standard(1),
    deal: -1,
    layout: 'pile',
    slots: () => [
      { id: 'sp', x: CX - 3 * CARD_GAP, y: CY, label: 'Spades', wide: 2 },
      { id: 'he', x: CX - CARD_GAP, y: CY, label: 'Hearts', wide: 2 },
      { id: 'di', x: CX + CARD_GAP, y: CY, label: 'Diamonds', wide: 2 },
      { id: 'cl', x: CX + 3 * CARD_GAP, y: CY, label: 'Clubs', wide: 2 },
    ],
    bySuit: true,
  },
  {
    id: 'chess',
    name: 'Chess',
    players: '2',
    hint: 'Thirty two pieces, sixty four squares',
    group: 'family',
    cards: () => [],
    deal: 0,
    layout: 'pile',
    slots: chessBoard,
    pucks: chessPieces,
  },
  {
    id: 'snakes-ladders',
    name: 'Snakes and Ladders',
    players: '2-6',
    hint: 'A hundred squares, one die, no decisions at all',
    group: 'family',
    cards: () => [],
    deal: 0,
    layout: 'pile',
    slots: snakesBoard,
    pucks: snakesTokens,
    dice: oneDie,
    lines: snakesLines,
  },
  {
    id: 'scrabble',
    name: 'Scrabble',
    players: '2-4',
    hint: 'A hundred letters, seven on your rack',
    group: 'family',
    cards: scrabbleTiles,
    deal: 7,
    layout: 'pile',
    slots: scrabbleBoard,
    hand: { each: 7 },
  },
  {
    id: 'bananagrams',
    name: 'Bananagrams',
    players: '2-8',
    hint: 'A hundred and forty four letters, no board, no turns',
    group: 'family',
    cards: bananaTiles,
    // The real rule, and the reason there is one: twenty one each at eight
    // players would be a hundred and sixty eight tiles out of a bag of a
    // hundred and forty four.
    deal: dealBanana,
    layout: 'pile',
    hand: { each: dealBanana },
  },
  {
    id: 'dominoes',
    name: 'Dominoes',
    players: '2-4',
    hint: 'Double six, seven bones each',
    group: 'family',
    cards: dominoTiles,
    // Seven each head to head, five each with three or four, which is what
    // leaves a boneyard to draw from rather than dealing the whole set out.
    deal: dealDominoes,
    layout: 'pile',
    slots: boneyard,
    hand: { each: dealDominoes },
  },
  {
    id: 'boggle',
    name: 'Boggle',
    players: '2-8',
    hint: 'Sixteen letter dice, three minutes, your own list',
    group: 'family',
    cards: () => [],
    deal: 0,
    layout: 'pile',
    slots: boggleTray,
    dice: boggleDice,
    clock: 180,
    pad: 'Words you found',
  },
  {
    id: 'yahtzee',
    name: 'Yahtzee',
    players: '1-8',
    hint: 'Five dice, three rolls, thirteen boxes',
    group: 'family',
    cards: () => [],
    deal: 0,
    layout: 'pile',
    dice: fiveDice,
    pad: 'Your scorecard',
  },
  {
    id: 'chinese-checkers',
    name: 'Chinese Checkers',
    players: '2-6',
    hint: 'A star, sixty marbles, no cards at all',
    group: 'family',
    // No deck. The board is a hundred and twenty one places on the felt and
    // the marbles are markers, both of which the table already understands.
    cards: () => [],
    deal: 0,
    layout: 'pile',
    slots: starSlots,
    pucks: marbles,
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
export function place(preset: Preset, undealt: CardId[], slots: Slot[] = []): Placed[] {
  // If the game drew a place for the deck, put the deck there rather than in
  // the middle on top of whatever else is marked out.
  const home = slots.find((s) => s.id === 'draw' || s.id === 'deck')
  const mid = home ? { x: home.x, y: home.y } : { x: TABLE_W / 2, y: TABLE_H / 2 }

  if (preset.layout === 'grid') {
    // Eleven across rather than thirteen: the cards are wider now, and a grid
    // that runs off the edge of the table is worse than one more row.
    const cols = 11
    const gapX = CARD_W + 4
    const gapY = CARD_H
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

  // Klondike: seven piles of one, two, three and so on, each with its top card
  // turned up, and everything left over on the stock.
  if (preset.layout === 'klondike') {
    const out: Placed[] = []
    let i = 0
    for (let col = 0; col < 7; col++) {
      const at = slots.find((sl) => sl.id === `t${col}`)
      for (let row = 0; row <= col; row++) {
        const id = undealt[i++]
        if (!id) break
        out.push({
          id,
          faceUp: row === col,
          x: at?.x ?? mid.x,
          // Fanned down the column, so you can read every card in the pile.
          y: (at?.y ?? mid.y) + row * 34,
        })
      }
    }
    const stock = slots.find((sl) => sl.id === 'draw')
    for (; i < undealt.length; i++) {
      out.push({ id: undealt[i]!, faceUp: false, x: stock?.x ?? mid.x, y: stock?.y ?? mid.y })
    }
    return out
  }

  if (preset.layout === 'starter' && undealt.length > 1) {
    const discard = slots.find((s) => s.id === 'discard')
    const [starter, ...rest] = undealt
    return [
      { id: starter!, faceUp: true, x: discard?.x ?? mid.x + CARD_GAP, y: discard?.y ?? mid.y },
      ...rest.map((id) => ({ id, faceUp: false, x: mid.x, y: mid.y })),
    ]
  }

  return undealt.map((id) => ({ id, faceUp: false, x: mid.x, y: mid.y }))
}

/** Unbiased shuffle - rejection sampling, never `% n`. */
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
