import type {
  CardId,
  CoreEvent,
  Event,
  RoomSettings,
  Seat,
  SeatId,
  TableState,
  Zone,
  ZoneId,
} from './types.ts'
import type { PokerState } from '../games/poker/state.ts'
import { applyPoker, initialPokerState, isPokerEvent } from '../games/poker/state.ts'

export interface RoomState {
  settings: RoomSettings
  table: TableState
  poker: PokerState
  /** The table has been dealt at least once this session. */
  open: boolean
}

export const DEFAULT_SETTINGS: RoomSettings = {
  mode: 'poker',
  layout: 'deal-7',
  counters: true,
  smallBlind: 10,
  bigBlind: 20,
  startingStack: 2000,
  muckedReveal: true,
  autoApprove: false,
  jokers: false,
}

export function initialState(): RoomState {
  return {
    settings: { ...DEFAULT_SETTINGS },
    table: { seats: [], zones: {}, cards: {}, faceUp: {}, revealed: {}, turn: null, button: null },
    poker: initialPokerState(),
    open: false,
  }
}

export const seatOf = (s: RoomState, id: SeatId): Seat | undefined =>
  s.table.seats.find((x) => x.id === id)

export const activeSeats = (s: RoomState): Seat[] => s.table.seats.filter((x) => !x.away)

export function zoneCards(s: TableState, id: ZoneId): CardId[] {
  return s.cards[id] ?? []
}

export function handZoneId(seatId: SeatId): ZoneId {
  return `hand:${seatId}`
}

/**
 * The ONLY way state ever changes. Live play appends events to the log and then
 * folds them through here; restart replays the log through the same function.
 * Divergence between those two paths is the bug this shape exists to prevent.
 */
export function apply(state: RoomState, e: Event): RoomState {
  if (isPokerEvent(e)) {
    const [table, poker] = applyPoker(state.table, state.poker, e, state.settings)
    return { ...state, table, poker }
  }
  return applyCore(state, e)
}

function applyCore(state: RoomState, e: CoreEvent): RoomState {
  const t = state.table
  switch (e.t) {
    case 'room_opened':
      return { ...state, settings: { ...e.settings } }

    case 'settings_changed':
      return { ...state, settings: { ...state.settings, ...e.settings } }

    case 'seat_added': {
      if (t.seats.some((s) => s.id === e.seatId)) return state
      const seat: Seat = {
        id: e.seatId,
        name: e.name,
        connected: false,
        away: false,
        stack: e.stack,
      }
      return {
        ...state,
        table: { ...t, seats: [...t.seats, seat], button: t.button ?? e.seatId },
      }
    }

    case 'seat_renamed':
      return { ...state, table: { ...t, seats: mapSeat(t.seats, e.seatId, (s) => ({ ...s, name: e.name })) } }

    case 'seat_connected':
      return {
        ...state,
        table: { ...t, seats: mapSeat(t.seats, e.seatId, (s) => ({ ...s, connected: e.connected })) },
      }

    case 'seat_away':
      return { ...state, table: { ...t, seats: mapSeat(t.seats, e.seatId, (s) => ({ ...s, away: e.away })) } }

    case 'zones_set': {
      // Arranging the furniture clears the table. Every zone starts empty and
      // the face-up map resets, so a new hand cannot deal a fresh deck while
      // the previous hand's cards are still lying in the board and hand zones —
      // which would put the same card id in two places at once and leak faces
      // through the projection.
      const zones: Record<ZoneId, Zone> = {}
      const cards: Record<ZoneId, CardId[]> = {}
      for (const z of e.zones) {
        zones[z.id] = z
        cards[z.id] = []
      }
      return { ...state, table: { ...t, zones, cards, faceUp: {}, revealed: {} } }
    }

    case 'cards_dealt_into': {
      const faceUp = { ...t.faceUp }
      for (const c of e.cardIds) faceUp[c] = e.faceUp
      return {
        ...state,
        table: {
          ...t,
          cards: { ...t.cards, [e.zoneId]: [...(t.cards[e.zoneId] ?? []), ...e.cardIds] },
          faceUp,
        },
      }
    }

    case 'cards_moved': {
      const moving = new Set(e.cardIds)
      const from = (t.cards[e.from] ?? []).filter((c) => !moving.has(c))
      const target = (t.cards[e.to] ?? []).slice()
      const at = e.index ?? target.length
      target.splice(at, 0, ...e.cardIds)
      const faceUp = { ...t.faceUp }
      if (e.faceUp !== undefined) for (const c of e.cardIds) faceUp[c] = e.faceUp
      return { ...state, table: { ...t, cards: { ...t.cards, [e.from]: from, [e.to]: target }, faceUp } }
    }

    case 'zone_shuffled':
      return { ...state, table: { ...t, cards: { ...t.cards, [e.zoneId]: e.order.slice() } } }

    case 'cards_flipped': {
      const faceUp = { ...t.faceUp }
      for (const c of e.cardIds) faceUp[c] = e.faceUp
      return { ...state, table: { ...t, faceUp } }
    }

    case 'zones_revealed': {
      const revealed = { ...t.revealed }
      for (const z of e.zoneIds) revealed[z] = true
      return { ...state, table: { ...t, revealed } }
    }

    case 'reveals_cleared':
      return { ...state, table: { ...t, revealed: {} } }

    case 'counter_adjusted':
      return {
        ...state,
        table: { ...t, seats: mapSeat(t.seats, e.seatId, (s) => ({ ...s, stack: s.stack + e.delta })) },
      }

    case 'restack':
      return {
        ...state,
        table: { ...t, seats: mapSeat(t.seats, e.seatId, (s) => ({ ...s, stack: s.stack + e.amount })) },
      }

    case 'turn_changed':
      return { ...state, table: { ...t, turn: e.seatId } }

    case 'button_moved':
      return { ...state, table: { ...t, button: e.seatId } }

    case 'table_opened':
      return {
        ...state,
        open: true,
        table: { ...t, seats: t.seats.map((s) => ({ ...s, stack: e.startingStack })) },
      }
  }
}

function mapSeat(seats: Seat[], id: SeatId, f: (s: Seat) => Seat): Seat[] {
  return seats.map((s) => (s.id === id ? f(s) : s))
}
