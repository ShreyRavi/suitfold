/**
 * The table.
 *
 * A card is not "in a zone" — it is at a position, like a real card on a real
 * table. That is the whole model, and it is what makes the table feel alive:
 * you pick a card up, you put it somewhere, and everyone sees it move.
 *
 * Stacks are not a separate thing either. Cards dropped close together snap to
 * exactly the same position, so a stack is simply "the cards sharing a spot".
 * That means there is no stack to create, split, or corrupt.
 */

export type CardId = string
export type SeatId = string

/** The table is a fixed coordinate space, scaled to whatever screen shows it. */
export const TABLE_W = 1000
export const TABLE_H = 640
/** Drop within this distance of another card and the two snap together. */
export const SNAP = 26

export interface Card {
  id: CardId
  x: number
  y: number
  /** Stacking order. Higher is nearer the top. */
  z: number
  faceUp: boolean
  /** null = lying on the table. Otherwise it is in this seat's hand. */
  hand: SeatId | null
}

export interface Seat {
  id: SeatId
  name: string
  connected: boolean
  colour: string
}

export interface TableState {
  cards: Record<CardId, Card>
  seats: Seat[]
  topZ: number
  /** What the table was last set up with, for the toolbar label. */
  deckName: string
}

export const emptyTable = (): TableState => ({ cards: {}, seats: [], topZ: 0, deckName: '' })

// ---------------------------------------------------------------------------
// Actions. Every change to the table is one of these.
// ---------------------------------------------------------------------------

export type Action =
  | { t: 'reset'; deckName: string; cards: { id: CardId; faceUp: boolean }[]; x: number; y: number }
  | { t: 'move'; ids: CardId[]; x: number; y: number }
  | { t: 'flip'; ids: CardId[]; faceUp?: boolean }
  | { t: 'take'; ids: CardId[]; seat: SeatId }
  | { t: 'play'; ids: CardId[]; x: number; y: number; faceUp: boolean }
  | { t: 'reorder'; ids: CardId[] }
  | { t: 'seat_add'; id: SeatId; name: string; colour: string }
  | { t: 'seat_name'; id: SeatId; name: string }
  | { t: 'seat_here'; id: SeatId; connected: boolean }
  | { t: 'seat_remove'; id: SeatId }

/** The only way the table ever changes. Pure, so it can be tested and replayed. */
export function apply(s: TableState, a: Action): TableState {
  switch (a.t) {
    case 'reset': {
      const cards: Record<CardId, Card> = {}
      a.cards.forEach((c, i) => {
        cards[c.id] = { id: c.id, x: a.x, y: a.y, z: i + 1, faceUp: c.faceUp, hand: null }
      })
      return { ...s, cards, topZ: a.cards.length, deckName: a.deckName }
    }

    case 'move': {
      const cards = { ...s.cards }
      let z = s.topZ
      // Moving several at once keeps their relative order.
      for (const id of a.ids) {
        const c = cards[id]
        if (!c) continue
        cards[id] = { ...c, x: a.x, y: a.y, z: ++z, hand: null }
      }
      return { ...s, cards, topZ: z }
    }

    case 'flip': {
      const cards = { ...s.cards }
      for (const id of a.ids) {
        const c = cards[id]
        if (!c) continue
        cards[id] = { ...c, faceUp: a.faceUp ?? !c.faceUp }
      }
      return { ...s, cards }
    }

    case 'take': {
      const cards = { ...s.cards }
      let z = s.topZ
      for (const id of a.ids) {
        const c = cards[id]
        if (!c) continue
        // Into a hand: the face is now private, so it is turned up for its
        // owner and stays hidden from everyone else by the projection.
        cards[id] = { ...c, hand: a.seat, faceUp: true, z: ++z }
      }
      return { ...s, cards, topZ: z }
    }

    case 'play': {
      const cards = { ...s.cards }
      let z = s.topZ
      for (const id of a.ids) {
        const c = cards[id]
        if (!c) continue
        cards[id] = { ...c, hand: null, x: a.x, y: a.y, faceUp: a.faceUp, z: ++z }
      }
      return { ...s, cards, topZ: z }
    }

    case 'reorder': {
      // Used by shuffle and by sorting a hand: reassign z in the order given.
      const cards = { ...s.cards }
      let z = s.topZ
      for (const id of a.ids) {
        const c = cards[id]
        if (!c) continue
        cards[id] = { ...c, z: ++z }
      }
      return { ...s, cards, topZ: z }
    }

    case 'seat_add':
      if (s.seats.some((x) => x.id === a.id)) return s
      return { ...s, seats: [...s.seats, { id: a.id, name: a.name, colour: a.colour, connected: true }] }

    case 'seat_name':
      return { ...s, seats: s.seats.map((x) => (x.id === a.id ? { ...x, name: a.name } : x)) }

    case 'seat_here':
      return { ...s, seats: s.seats.map((x) => (x.id === a.id ? { ...x, connected: a.connected } : x)) }

    case 'seat_remove': {
      // Their cards come back to the middle of the table, face down, rather
      // than vanishing with them.
      const cards = { ...s.cards }
      let z = s.topZ
      for (const c of Object.values(cards)) {
        if (c.hand === a.id) {
          cards[c.id] = { ...c, hand: null, faceUp: false, x: TABLE_W / 2, y: TABLE_H / 2, z: ++z }
        }
      }
      return { ...s, cards, topZ: z, seats: s.seats.filter((x) => x.id !== a.id) }
    }
  }
}

// ---------------------------------------------------------------------------
// Reading the table
// ---------------------------------------------------------------------------

export const onTable = (s: TableState): Card[] =>
  Object.values(s.cards)
    .filter((c) => c.hand === null)
    .sort((a, b) => a.z - b.z)

export const inHand = (s: TableState, seat: SeatId): Card[] =>
  Object.values(s.cards)
    .filter((c) => c.hand === seat)
    .sort((a, b) => a.z - b.z)

/** Cards sharing a spot, bottom to top. A "stack" is only ever this. */
export function stackAt(s: TableState, x: number, y: number): Card[] {
  return onTable(s).filter((c) => c.x === x && c.y === y)
}

/** Every distinct pile on the table, each sorted bottom to top. */
export function stacks(s: TableState): Card[][] {
  const by = new Map<string, Card[]>()
  for (const c of onTable(s)) {
    const key = `${c.x},${c.y}`
    const list = by.get(key) ?? []
    list.push(c)
    by.set(key, list)
  }
  return [...by.values()]
}

/** Where a card dropped here should land: snapped to a nearby pile, or free. */
export function snapTarget(s: TableState, x: number, y: number, ignore: Set<CardId>): { x: number; y: number } {
  let best: Card | null = null
  let bestDist = SNAP
  for (const c of onTable(s)) {
    if (ignore.has(c.id)) continue
    const d = Math.hypot(c.x - x, c.y - y)
    if (d < bestDist) {
      bestDist = d
      best = c
    }
  }
  return best ? { x: best.x, y: best.y } : { x, y }
}

// ---------------------------------------------------------------------------
// What each player is allowed to see
// ---------------------------------------------------------------------------

export interface CardView {
  id: CardId
  x: number
  y: number
  z: number
  faceUp: boolean
  hand: SeatId | null
  /** The rank/suit, present only when this viewer may see the face. */
  face: string | null
}

export interface TableView {
  cards: CardView[]
  seats: Seat[]
  deckName: string
  handCounts: Record<SeatId, number>
}

/**
 * THE SECRECY BOUNDARY. Everything sent to another player goes through here.
 *
 * A face is included when the card is face-up on the table, or when it is in
 * the viewer's own hand. Nothing else. A card in someone else's hand is a
 * position and a back, never a face.
 */
export function project(s: TableState, viewer: SeatId | null): TableView {
  const handCounts: Record<SeatId, number> = {}
  for (const seat of s.seats) handCounts[seat.id] = 0

  const cards: CardView[] = []
  for (const c of Object.values(s.cards)) {
    if (c.hand) handCounts[c.hand] = (handCounts[c.hand] ?? 0) + 1
    const mine = c.hand !== null && c.hand === viewer
    const openOnTable = c.hand === null && c.faceUp
    cards.push({
      id: c.id,
      x: c.x,
      y: c.y,
      z: c.z,
      faceUp: c.faceUp,
      hand: c.hand,
      face: mine || openOnTable ? c.id : null,
    })
  }

  return { cards: cards.sort((a, b) => a.z - b.z), seats: s.seats, deckName: s.deckName, handCounts }
}
