import type { CardId, Event, RummyEvent, SeatId } from '../../core/types.ts'
import type { Group } from './melds.ts'

export type RummyPhase = 'idle' | 'draw' | 'discard' | 'complete'

export interface RummyState {
  phase: RummyPhase
  players: SeatId[]
  /** Set when someone declares a valid hand. */
  winner: SeatId | null
  groups: Group[]
  /** Where the last card came from, for the action log. */
  lastDraw: 'closed' | 'open' | null
}

export const RUMMY_EVENTS = new Set([
  'rummy_started',
  'rummy_drew',
  'rummy_discarded',
  'rummy_declared',
])

export const isRummyEvent = (e: Event): e is RummyEvent => RUMMY_EVENTS.has(e.t)

export function initialRummyState(): RummyState {
  return { phase: 'idle', players: [], winner: null, groups: [], lastDraw: null }
}

export function applyRummy(r: RummyState, e: RummyEvent): RummyState {
  switch (e.t) {
    case 'rummy_started':
      return { phase: 'draw', players: e.players.slice(), winner: null, groups: [], lastDraw: null }
    case 'rummy_drew':
      return { ...r, phase: 'discard', lastDraw: e.from }
    case 'rummy_discarded':
      return { ...r, phase: 'draw' }
    case 'rummy_declared':
      return { ...r, phase: 'complete', winner: e.seatId, groups: e.groups as Group[] }
  }
}

export interface RummyView {
  phase: RummyPhase
  winner: SeatId | null
  groups: Group[]
  /** The rank that is wild this hand, if one was turned. */
  wild: string | null
  /** Set when your hand can legally be declared, naming the card to finish on. */
  canDeclareWith: CardId | null
  canDraw: boolean
  canDiscard: boolean
}
