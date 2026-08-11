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
/**
 * How big a card is, in table units. The felt is one fixed coordinate space
 * scaled to whatever screen shows it, so this is both the CSS size of a card
 * and the spacing everything else has to respect.
 */
export const CARD_W = 80
export const CARD_H = 112
/** A row of board cards, and a laid-out grid, need a card's width plus air. */
export const CARD_GAP = CARD_W + 8

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

/**
 * A place on the table with a name on it: "Discard", "Player 1", "Trick".
 * Slots hold nothing and enforce nothing — they are markings on the felt that
 * tell everyone where things go, and cards snap to them when dropped nearby.
 * This is what makes a freeform table read as a particular game.
 */
export interface Slot {
  id: string
  x: number
  y: number
  label: string
  /** Wider than a card, for a row of community cards. */
  wide?: number
}

/**
 * A marker you shove around: the dealer button, the blinds. It holds no cards
 * and enforces no turn order — it is the little plastic disc that reminds
 * everyone whose deal it is, and it moves because somebody drags it.
 */
export interface Puck {
  id: string
  x: number
  y: number
  /** Short, because it is drawn inside a disc. */
  label: string
  /** What it means, for the tooltip. */
  hint: string
}

/**
 * One line of the table's history. Everyone gets the same list in the same
 * order, because the host writes it as it applies each change.
 *
 * It never names a card. That is not squeamishness — the log is projected to
 * every player, so "Dad picked up the ace" would be a hole straight through
 * the secrecy boundary. Counts only.
 */
export interface LogEntry {
  n: number
  /** Wall clock from the host's tab, so everyone's log reads the same times. */
  at: number
  seat: SeatId | null
  kind: 'chip' | 'card' | 'seat' | 'game' | 'chat'
  text: string
  /** Chip lines carry their amount so the log can draw it as money. */
  amount?: number
  /** Seats named with an @ in a chat line. */
  to?: SeatId[]
}

export interface TableState {
  cards: Record<CardId, Card>
  seats: Seat[]
  slots: Slot[]
  pucks: Puck[]
  /** Newest last. Capped, because this is a game, not an audit trail. */
  log: LogEntry[]
  logN: number
  /** Whatever anyone is keeping track of: tricks, points, lives. */
  scores: Record<SeatId, number>
  /**
   * Chips are an amount, not two hundred draggable discs — but they are drawn
   * as real stacks. Nothing here is enforced: the table never decides whether
   * a bet is legal, the same way it never decides whether a run is valid.
   */
  chips: Record<SeatId, number>
  pot: number
  /** Whether this table is playing for chips at all. */
  chipsOn: boolean
  /** What everyone started with, so somebody arriving late can be bought in. */
  buyIn: number
  topZ: number
  /** What the table was last set up with, for the toolbar label. */
  deckName: string
  /** Which preset, so the toolbar can offer that game's full deal. */
  game: string
}

export const emptyTable = (): TableState => ({
  cards: {},
  seats: [],
  slots: [],
  pucks: [],
  log: [],
  logN: 0,
  scores: {},
  chips: {},
  pot: 0,
  chipsOn: false,
  buyIn: 0,
  topZ: 0,
  deckName: '',
  game: '',
})

// ---------------------------------------------------------------------------
// Actions. Every change to the table is one of these.
// ---------------------------------------------------------------------------

export type Action =
  | {
      t: 'reset'
      deckName: string
      cards: { id: CardId; faceUp: boolean; x: number; y: number }[]
      slots: Slot[]
      pucks: Puck[]
      game: string
    }
  | { t: 'score'; seat: SeatId; by: number }
  | { t: 'scores_clear' }
  | { t: 'chips_start'; each: number; on: boolean }
  | { t: 'bet'; seat: SeatId; amount: number }
  | { t: 'take_pot'; seat: SeatId }
  | { t: 'chips_adjust'; seat: SeatId; by: number }
  | { t: 'move'; ids: CardId[]; x: number; y: number }
  | { t: 'flip'; ids: CardId[]; faceUp?: boolean }
  | { t: 'take'; ids: CardId[]; seat: SeatId }
  | { t: 'play'; ids: CardId[]; x: number; y: number; faceUp: boolean }
  | { t: 'reorder'; ids: CardId[] }
  | { t: 'seat_add'; id: SeatId; name: string; colour: string }
  | { t: 'seat_name'; id: SeatId; name: string }
  | { t: 'seat_here'; id: SeatId; connected: boolean }
  | { t: 'seat_remove'; id: SeatId }
  | { t: 'puck'; id: string; x: number; y: number }
  /** Chat. It changes nothing on the table; the host turns it into a log line. */
  | { t: 'say'; seat: SeatId; text: string }
  /** Wipe the history. Whoever is holding the deck only. */
  | { t: 'log_clear' }

/** The only way the table ever changes. Pure, so it can be tested and replayed. */
export function apply(s: TableState, a: Action): TableState {
  switch (a.t) {
    case 'reset': {
      // Every card carries its own spot, so a draw pile, a pile with one card
      // turned up beside it, and a grid of cards are all the same code path.
      const cards: Record<CardId, Card> = {}
      a.cards.forEach((c, i) => {
        cards[c.id] = { id: c.id, x: c.x, y: c.y, z: i + 1, faceUp: c.faceUp, hand: null }
      })
      return {
        ...s,
        cards,
        slots: a.slots,
        pucks: a.pucks,
        topZ: a.cards.length,
        deckName: a.deckName,
        game: a.game,
      }
    }

    case 'score':
      return { ...s, scores: { ...s.scores, [a.seat]: (s.scores[a.seat] ?? 0) + a.by } }

    case 'scores_clear':
      return { ...s, scores: {} }

    case 'chips_start': {
      const chips: Record<SeatId, number> = {}
      for (const seat of s.seats) chips[seat.id] = a.each
      return { ...s, chips, pot: 0, chipsOn: a.on, buyIn: a.each }
    }

    case 'bet': {
      // You cannot bet what you do not have, which is arithmetic rather than a
      // rule about poker.
      const have = s.chips[a.seat] ?? 0
      const amount = Math.max(0, Math.min(a.amount, have))
      if (amount === 0) return s
      return { ...s, chips: { ...s.chips, [a.seat]: have - amount }, pot: s.pot + amount }
    }

    case 'take_pot': {
      if (s.pot === 0) return s
      return { ...s, chips: { ...s.chips, [a.seat]: (s.chips[a.seat] ?? 0) + s.pot }, pot: 0 }
    }

    case 'chips_adjust':
      return {
        ...s,
        chips: { ...s.chips, [a.seat]: Math.max(0, (s.chips[a.seat] ?? 0) + a.by) },
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

    case 'seat_add': {
      if (s.seats.some((x) => x.id === a.id)) return s
      // Arriving after the game was set up is normal — people turn up late.
      // Buy them in for the same as everyone else, or they can sit at a poker
      // table with no chips and no way to put anything in the pot.
      const chips = s.chipsOn && s.chips[a.id] === undefined ? { ...s.chips, [a.id]: s.buyIn } : s.chips
      return {
        ...s,
        chips,
        seats: [...s.seats, { id: a.id, name: a.name, colour: a.colour, connected: true }],
      }
    }

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

    case 'puck':
      return { ...s, pucks: s.pucks.map((p) => (p.id === a.id ? { ...p, x: a.x, y: a.y } : p)) }

    // Saying something does not move anything. It becomes a log line where the
    // log is written, which is the one place that knows who is speaking.
    case 'say':
      return s

    // The count keeps going up. Watermarks elsewhere rely on it never going
    // backwards, or clearing the log would replay old lines as fresh toasts.
    case 'log_clear':
      return { ...s, log: [] }
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

/**
 * Break an amount into the discs you would actually see in front of someone.
 * Capped, because a stack of forty is a column, not information.
 */
export const CHIP_TIERS = [
  { value: 1000, colour: '#2f2a24' },
  { value: 500, colour: '#6b4a7a' },
  { value: 100, colour: '#1f4b7a' },
  { value: 25, colour: '#2e8b57' },
  { value: 5, colour: '#b9482f' },
  { value: 1, colour: '#e9e2d3' },
] as const

export function chipDiscs(amount: number, max = 7): string[] {
  const out: string[] = []
  let left = Math.max(0, Math.floor(amount))
  for (const tier of CHIP_TIERS) {
    while (left >= tier.value && out.length < max) {
      out.push(tier.colour)
      left -= tier.value
    }
  }
  return out
}

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

/** Where a card dropped here should land: onto a pile, into a slot, or free. */
export function snapTarget(s: TableState, x: number, y: number, ignore: Set<CardId>): { x: number; y: number } {
  let best: { x: number; y: number } | null = null
  let bestDist = SNAP
  for (const c of onTable(s)) {
    if (ignore.has(c.id)) continue
    const d = Math.hypot(c.x - x, c.y - y)
    if (d < bestDist) {
      bestDist = d
      best = { x: c.x, y: c.y }
    }
  }
  // Slots pull a little harder than cards, because they are aimed at.
  for (const slot of s.slots) {
    const d = Math.hypot(slot.x - x, slot.y - y)
    if (d < Math.max(bestDist, SNAP * 1.6)) {
      bestDist = d
      best = { x: slot.x, y: slot.y }
    }
  }
  return best ?? { x, y }
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
  slots: Slot[]
  pucks: Puck[]
  log: LogEntry[]
  scores: Record<SeatId, number>
  chips: Record<SeatId, number>
  pot: number
  chipsOn: boolean
  deckName: string
  game: string
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

  return {
    cards: cards.sort((a, b) => a.z - b.z),
    seats: s.seats,
    slots: s.slots,
    pucks: s.pucks,
    log: s.log,
    scores: s.scores,
    chips: s.chips,
    pot: s.pot,
    chipsOn: s.chipsOn,
    deckName: s.deckName,
    game: s.game,
    handCounts,
  }
}

// ---------------------------------------------------------------------------
// Turning an action into a line of history
// ---------------------------------------------------------------------------

/** What a log line says, before it is stamped with a number. */
export interface Note {
  kind: LogEntry['kind']
  text: string
  amount?: number
  to?: SeatId[]
  /** When the action names its own subject — "Mum sat down", not "you seated Mum". */
  seat?: SeatId
}

const many = (n: number, one: string, more: string) => (n === 1 ? one : `${more.replace('%', String(n))}`)

/**
 * One action, in words. Pure and given the table as it was, so it can say
 * "took the pot" with the amount that was actually in it.
 *
 * Returns null for the plumbing — a reorder on its own means nothing, and the
 * compound moves (deal, gather, shuffle) are described by whoever ran them.
 */
export function describe(a: Action, before: TableState): Note | null {
  switch (a.t) {
    case 'bet':
      return { kind: 'chip', text: 'bet', amount: Math.min(a.amount, before.chips[a.seat] ?? 0), seat: a.seat }
    case 'take_pot':
      return before.pot > 0 ? { kind: 'chip', text: 'took the pot', amount: before.pot, seat: a.seat } : null
    case 'chips_adjust':
      return a.by === 0
        ? null
        : { kind: 'chip', text: a.by > 0 ? 'was given' : 'put back', amount: Math.abs(a.by), seat: a.seat }
    case 'chips_start':
      return a.on ? { kind: 'chip', text: 'chips out, each', amount: a.each } : { kind: 'chip', text: 'put the chips away' }

    case 'score':
      return { kind: 'game', text: a.by > 0 ? `scored ${a.by}` : `lost ${-a.by}`, seat: a.seat }
    case 'scores_clear':
      return { kind: 'game', text: 'reset the scores' }

    // Moving a card is most of what anybody does. Logging it buries the lines
    // that matter — who bet, who dealt — under a wall of "moved a card".
    case 'move':
      return null
    case 'flip':
      return { kind: 'card', text: many(a.ids.length, 'turned a card over', 'turned % cards over') }
    case 'take':
      return { kind: 'card', text: many(a.ids.length, 'picked up a card', 'picked up % cards'), seat: a.seat }
    case 'play': {
      const how = a.faceUp ? 'face up' : 'face down'
      return { kind: 'card', text: `${many(a.ids.length, 'put a card down', 'put % cards down')} ${how}` }
    }

    case 'puck': {
      const puck = before.pucks.find((p) => p.id === a.id)
      // The hint, not the label: "moved the dealer button", not "moved the D".
      return puck ? { kind: 'game', text: `moved the ${puck.hint.toLowerCase()}` } : null
    }

    case 'seat_add':
      return { kind: 'seat', text: 'sat down', seat: a.id }
    case 'seat_here':
      return { kind: 'seat', text: a.connected ? 'came back' : 'went quiet', seat: a.id }
    case 'seat_remove':
      return { kind: 'seat', text: 'left the table', seat: a.id }
    case 'seat_name':
      return null

    // Described by whoever ran them, which knows what the whole batch was for.
    case 'log_clear':
      return { kind: 'game', text: 'cleared the log' }

    case 'reset':
    case 'reorder':
    case 'say':
      return null
  }
}

/** Stamp a note onto the table's history. Newest last, and it is not forever. */
export const LOG_MAX = 150

export function record(s: TableState, note: Note, by: SeatId | null, at: number): TableState {
  const n = s.logN + 1
  const entry: LogEntry = {
    n,
    at,
    seat: note.seat ?? by,
    kind: note.kind,
    text: note.text,
    ...(note.amount === undefined ? {} : { amount: note.amount }),
    ...(note.to?.length ? { to: note.to } : {}),
  }
  return { ...s, log: [...s.log, entry].slice(-LOG_MAX), logN: n }
}

/**
 * Who was named with an @. Matched against the seats actually at the table, so
 * "@Dad" finds Dad and "@dinner" finds nobody — and names with a space in them
 * ("Dad 2") still match, which a plain word-grab would miss.
 *
 * "@all" and "@table" mean everyone, because somebody will type it.
 */
export function mentions(text: string, seats: Seat[]): SeatId[] {
  const lower = text.toLowerCase()
  if (/@(all|table|everyone)\b/.test(lower)) return seats.map((s) => s.id)
  const hit: SeatId[] = []
  for (const seat of seats) {
    const name = seat.name.toLowerCase()
    if (!name) continue
    let from = 0
    for (;;) {
      const i = lower.indexOf(`@${name}`, from)
      if (i === -1) break
      // Not a match if the name is only the start of a longer word.
      const after = lower[i + name.length + 1]
      if (after === undefined || !/[a-z0-9]/.test(after)) {
        hit.push(seat.id)
        break
      }
      from = i + 1
    }
  }
  return hit
}
