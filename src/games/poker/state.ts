import type {
  CardId,
  Event,
  PokerActionKind,
  PokerEvent,
  Pot,
  RoomSettings,
  SeatId,
  Street,
  TableState,
} from '../../core/types.ts'
import type { RoomState } from '../../core/state.ts'

export type Phase = 'idle' | 'preflop' | 'flop' | 'turn' | 'river' | 'showdown' | 'complete'

export interface PokerState {
  phase: Phase
  handNumber: number
  /** Seats dealt into the current hand, in seating order. */
  players: SeatId[]
  button: SeatId | null
  sbSeat: SeatId | null
  bbSeat: SeatId | null
  /** Last hand's big blind, so the next hand advances correctly (dead button). */
  lastBB: SeatId | null
  folded: Record<SeatId, boolean>
  allIn: Record<SeatId, boolean>
  /** Chips put in on the current street. */
  street: Record<SeatId, number>
  /** Chips put in across the whole hand — side pots are built from this. */
  total: Record<SeatId, number>
  /** Highest `street` amount. */
  currentBet: number
  /** Size of the last FULL raise increment. Floors at the big blind. */
  lastRaiseSize: number
  /**
   * Has this seat acted since the last full raise? A short all-in does not clear
   * these, which is exactly what stops it reopening action.
   */
  acted: Record<SeatId, boolean>
  pots: Pot[]
  /** Set at showdown so the client can render the reveal. */
  result: HandResult | null
}

export interface HandResult {
  showdown: boolean
  awards: { potIndex: number; seatIds: SeatId[]; amount: number; description: string }[]
  /** Every player's hole cards, including folders. Populated only on showdown. */
  reveal: Record<SeatId, CardId[]>
}

export function initialPokerState(): PokerState {
  return {
    phase: 'idle',
    handNumber: 0,
    players: [],
    button: null,
    sbSeat: null,
    bbSeat: null,
    lastBB: null,
    folded: {},
    allIn: {},
    street: {},
    total: {},
    currentBet: 0,
    lastRaiseSize: 0,
    acted: {},
    pots: [],
    result: null,
  }
}

const POKER_EVENTS = new Set([
  'hand_started',
  'blind_posted',
  'acted',
  'street_advanced',
  'uncalled_returned',
  'pots_built',
  'pot_awarded',
  'hand_completed',
])

export function isPokerEvent(e: Event): e is PokerEvent {
  return POKER_EVENTS.has(e.t)
}

/**
 * Poker's applier. Card movement is NOT handled here — dealing emits core
 * `cards_moved` events, so the table layer stays the only thing that touches
 * card positions. This function only owns betting state and chip counters.
 */
export function applyPoker(
  table: TableState,
  p: PokerState,
  e: PokerEvent,
  settings: RoomSettings,
): [TableState, PokerState] {
  switch (e.t) {
    case 'hand_started': {
      const zero: Record<SeatId, number> = {}
      const no: Record<SeatId, boolean> = {}
      for (const id of e.players) {
        zero[id] = 0
        no[id] = false
      }
      return [
        { ...table, button: e.button, turn: null },
        {
          ...p,
          phase: 'preflop',
          handNumber: p.handNumber + 1,
          players: e.players.slice(),
          button: e.button,
          folded: { ...no },
          allIn: { ...no },
          street: { ...zero },
          total: { ...zero },
          currentBet: 0,
          lastRaiseSize: e.bb,
          acted: { ...no },
          // Cleared every hand: a dead small blind must not inherit last hand's
          // seat, or the table reports a blind nobody posted.
          sbSeat: null,
          bbSeat: null,
          pots: [],
          result: null,
        },
      ]
    }

    case 'blind_posted': {
      const street = { ...p.street, [e.seatId]: (p.street[e.seatId] ?? 0) + e.amount }
      const total = { ...p.total, [e.seatId]: (p.total[e.seatId] ?? 0) + e.amount }
      return [
        debit(table, e.seatId, e.amount),
        {
          ...p,
          street,
          total,
          // A big blind that is all-in for less than the full blind still opens
          // the betting for the full amount — everyone else calls the nominal.
          currentBet: Math.max(p.currentBet, e.kind === 'bb' ? e.nominal : street[e.seatId]!),
          allIn: { ...p.allIn, [e.seatId]: e.allIn },
          sbSeat: e.kind === 'sb' ? e.seatId : p.sbSeat,
          bbSeat: e.kind === 'bb' ? e.seatId : p.bbSeat,
          lastBB: e.kind === 'bb' ? e.seatId : p.lastBB,
        },
      ]
    }

    case 'acted': {
      const street = { ...p.street, [e.seatId]: (p.street[e.seatId] ?? 0) + e.amount }
      const total = { ...p.total, [e.seatId]: (p.total[e.seatId] ?? 0) + e.amount }
      const to = street[e.seatId]!
      let { currentBet, lastRaiseSize, acted } = p

      if (e.action === 'fold') {
        acted = { ...acted, [e.seatId]: true }
        return [
          table,
          { ...p, street, total, acted, folded: { ...p.folded, [e.seatId]: true } },
        ]
      }

      if (to > currentBet) {
        const increment = to - currentBet
        if (increment >= lastRaiseSize) {
          // A full raise reopens action for everyone who had already acted.
          acted = {}
          for (const id of p.players) acted[id] = false
          lastRaiseSize = increment
        } else {
          // Short all-in: raises the bet but does NOT reopen action. Players who
          // have already acted keep acted=true and may only call or fold.
          acted = { ...acted }
        }
        currentBet = to
      } else {
        acted = { ...acted }
      }
      acted[e.seatId] = true

      return [
        debit(table, e.seatId, e.amount),
        {
          ...p,
          street,
          total,
          currentBet,
          lastRaiseSize,
          acted,
          allIn: { ...p.allIn, [e.seatId]: e.allIn || (p.allIn[e.seatId] ?? false) },
        },
      ]
    }

    case 'street_advanced': {
      const street: Record<SeatId, number> = {}
      const acted: Record<SeatId, boolean> = {}
      for (const id of p.players) {
        street[id] = 0
        acted[id] = false
      }
      return [
        { ...table, turn: null },
        { ...p, phase: e.street as Phase, street, acted, currentBet: 0, lastRaiseSize: 0 },
      ]
    }

    case 'uncalled_returned':
      return [
        credit(table, e.seatId, e.amount),
        {
          ...p,
          total: { ...p.total, [e.seatId]: (p.total[e.seatId] ?? 0) - e.amount },
          street: { ...p.street, [e.seatId]: Math.max(0, (p.street[e.seatId] ?? 0) - e.amount) },
        },
      ]

    case 'pots_built':
      return [table, { ...p, pots: e.pots.map((x) => ({ ...x, eligible: x.eligible.slice() })) }]

    case 'pot_awarded': {
      let t = table
      const each = Math.floor(e.amount / e.seatIds.length)
      const remainder = e.amount - each * e.seatIds.length
      for (const id of e.seatIds) t = credit(t, id, each)
      if (remainder > 0 && e.odd) t = credit(t, e.odd, remainder)
      const result: HandResult = p.result ?? { showdown: false, awards: [], reveal: {} }
      return [
        t,
        {
          ...p,
          result: {
            ...result,
            awards: [
              ...result.awards,
              { potIndex: e.potIndex, seatIds: e.seatIds.slice(), amount: e.amount, description: e.description },
            ],
          },
        },
      ]
    }

    case 'hand_completed': {
      const reveal: Record<SeatId, CardId[]> = {}
      if (e.showdown && settings.muckedReveal) {
        for (const id of p.players) reveal[id] = (table.cards[`hand:${id}`] ?? []).slice()
      }
      return [
        { ...table, turn: null },
        {
          ...p,
          phase: 'complete',
          result: { showdown: e.showdown, awards: p.result?.awards ?? [], reveal },
        },
      ]
    }
  }
}

function debit(t: TableState, id: SeatId, amount: number): TableState {
  return { ...t, seats: t.seats.map((s) => (s.id === id ? { ...s, stack: s.stack - amount } : s)) }
}
function credit(t: TableState, id: SeatId, amount: number): TableState {
  return { ...t, seats: t.seats.map((s) => (s.id === id ? { ...s, stack: s.stack + amount } : s)) }
}

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------

export interface PokerView {
  phase: Phase
  handNumber: number
  pots: Pot[]
  potTotal: number
  currentBet: number
  street: Record<SeatId, number>
  folded: SeatId[]
  allIn: SeatId[]
  toAct: SeatId | null
  toCall: number
  minRaiseTo: number
  maxRaiseTo: number
  canAct: boolean
  legal: PokerActionKind[]
  result: HandResult | null
  sbSeat: SeatId | null
  bbSeat: SeatId | null
}

export function pokerView(state: RoomState, viewer: SeatId | null): PokerView {
  const p = state.poker
  const seat = state.table.seats.find((s) => s.id === viewer)
  const committed = viewer ? (p.street[viewer] ?? 0) : 0
  const toCall = viewer ? Math.max(0, p.currentBet - committed) : 0
  const stack = seat?.stack ?? 0
  const canAct = viewer !== null && state.table.turn === viewer

  const bb = state.settings.bigBlind
  const raiseStep = Math.max(p.lastRaiseSize, bb)
  const minRaiseTo = p.currentBet + raiseStep
  const maxRaiseTo = committed + stack

  return {
    phase: p.phase,
    handNumber: p.handNumber,
    pots: p.pots,
    potTotal: potTotal(p),
    currentBet: p.currentBet,
    street: p.street,
    folded: Object.keys(p.folded).filter((k) => p.folded[k]),
    allIn: Object.keys(p.allIn).filter((k) => p.allIn[k]),
    toAct: state.table.turn,
    toCall,
    minRaiseTo,
    maxRaiseTo,
    canAct,
    legal: canAct && viewer ? legalActions(state, viewer) : [],
    result: p.result,
    sbSeat: p.sbSeat,
    bbSeat: p.bbSeat,
  }
}

/** Chips in the middle right now: built pots, or live commitments mid-street. */
export function potTotal(p: PokerState): number {
  if (p.pots.length) return p.pots.reduce((a, x) => a + x.amount, 0)
  return Object.values(p.total).reduce((a, x) => a + x, 0)
}

export function legalActions(state: RoomState, id: SeatId): PokerActionKind[] {
  const p = state.poker
  if (state.table.turn !== id) return []
  const seat = state.table.seats.find((s) => s.id === id)
  if (!seat) return []
  const committed = p.street[id] ?? 0
  const toCall = p.currentBet - committed
  const out: PokerActionKind[] = []

  if (toCall > 0) {
    out.push('fold')
    // Calling all-in for less than the full amount is always allowed.
    out.push('call')
  } else {
    out.push('check')
  }

  // Can this seat put in more? Only if it has chips left AND its action is open.
  // `acted[id]` is true when a short all-in has raised the bet since this seat
  // last acted — in that case the seat may only call or fold.
  const actionOpen = !(p.acted[id] ?? false)
  const canOutbid = committed + seat.stack > p.currentBet
  if (seat.stack > 0 && actionOpen && canOutbid) {
    out.push(p.currentBet === 0 ? 'bet' : 'raise')
  }
  return out
}
