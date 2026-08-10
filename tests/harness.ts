import type { CardId, Event, PokerActionKind, RoomSettings, SeatId } from '../src/core/types.ts'
import { apply, initialState, type RoomState } from '../src/core/state.ts'
import { decide } from '../src/core/decide.ts'
import { buildPots, startHand } from '../src/games/poker/engine.ts'
import { seededRandom, type RandomSource } from '../src/core/cards.ts'
import { project, facesIn, canSee } from '../src/core/project.ts'
import { legalActions } from '../src/games/poker/state.ts'

export interface Table {
  state: RoomState
  log: Event[]
}

export function table(
  names: string[],
  settings: Partial<RoomSettings> = {},
  stacks?: number[],
): Table {
  let s = initialState()
  const events: Event[] = [
    { t: 'room_opened', settings: { ...s.settings, mode: 'poker', ...settings } },
  ]
  names.forEach((name, i) => {
    events.push({
      t: 'seat_added',
      seatId: `s${i}`,
      name,
      stack: stacks?.[i] ?? (settings.startingStack ?? s.settings.startingStack),
    })
  })
  events.push({ t: 'table_opened', startingStack: settings.startingStack ?? 2000 })
  // table_opened levels everyone; explicit stacks are applied on top, through
  // the log so replay stays honest.
  if (stacks) {
    stacks.forEach((v, i) => {
      const want = v - (settings.startingStack ?? 2000)
      if (want !== 0) events.push({ t: 'counter_adjusted', seatId: `s${i}`, delta: want, reason: 'setup' })
    })
  }
  s = events.reduce(apply, s)
  return { state: s, log: events }
}

export function run(t: Table, cmd: Parameters<typeof decide>[1], rng?: RandomSource): Table {
  const d = decide(t.state, cmd, rng)
  if (!d.ok) throw new Error(`rejected: ${d.reason} (${JSON.stringify(cmd)})`)
  return { state: d.events.reduce(apply, t.state), log: [...t.log, ...d.events] }
}

export function tryRun(t: Table, cmd: Parameters<typeof decide>[1], rng?: RandomSource) {
  const d = decide(t.state, cmd, rng)
  if (!d.ok) return { ok: false as const, reason: d.reason, table: t }
  return { ok: true as const, table: { state: d.events.reduce(apply, t.state), log: [...t.log, ...d.events] } }
}

export function deal(t: Table, seed = 1): Table {
  const d = startHand(t.state, seededRandom(seed))
  if (!d.ok) throw new Error(`deal rejected: ${d.reason}`)
  return { state: d.events.reduce(apply, t.state), log: [...t.log, ...d.events] }
}

/** Deal a hand from an exact, hand-authored deck order. */
export function dealStacked(t: Table, deck: CardId[]): Table {
  const d = startHand(t.state, seededRandom(1), deck)
  if (!d.ok) throw new Error(`deal rejected: ${d.reason}`)
  return { state: d.events.reduce(apply, t.state), log: [...t.log, ...d.events] }
}

/** The largest total this seat can have in on the current street (its all-in). */
export function maxTo(t: Table, id: SeatId): number {
  const seat = t.state.table.seats.find((s) => s.id === id)!
  return (t.state.poker.street[id] ?? 0) + seat.stack
}

/** Raise to `want`, or all-in if the seat cannot reach it. */
export const raiseTo = (t: Table, id: SeatId, want: number) =>
  act(t, id, t.state.poker.currentBet === 0 ? 'bet' : 'raise', Math.min(want, maxTo(t, id)))

/** Drive the hand to completion with a simple policy. */
export function playOut(t: Table, policy: (t: Table, id: SeatId) => void | 'shove' | 'call' | 'check-fold' = () => 'call'): Table {
  let guard = 0
  while (phase(t) !== 'complete' && turn(t) && guard++ < 200) {
    const id = turn(t)!
    const opts = legal(t, id)
    const want = policy(t, id) ?? 'call'
    if (want === 'shove' && (opts.includes('raise') || opts.includes('bet'))) {
      t = raiseTo(t, id, maxTo(t, id))
    } else if (opts.includes('check')) {
      t = act(t, id, 'check')
    } else if (want === 'check-fold') {
      t = act(t, id, 'fold')
    } else {
      t = act(t, id, 'call')
    }
  }
  return t
}

export const act = (t: Table, seatId: SeatId, action: PokerActionKind, amount?: number) =>
  run(t, { c: 'poker_action', seatId, action, amount })

export const tryAct = (t: Table, seatId: SeatId, action: PokerActionKind, amount?: number) =>
  tryRun(t, { c: 'poker_action', seatId, action, amount })

export const stackOf = (t: Table, id: SeatId) => t.state.table.seats.find((s) => s.id === id)!.stack
export const turn = (t: Table) => t.state.table.turn
export const phase = (t: Table) => t.state.poker.phase
export const legal = (t: Table, id: SeatId) => legalActions(t.state, id)
export const pots = (t: Table) => t.state.poker.pots

/**
 * Total chips anywhere in the room. While a hand is live, committed chips have
 * been debited from stacks and sit in the middle. Once the hand completes they
 * have been credited back, so counting `total` again would double them.
 */
export function chipsInRoom(t: Table): number {
  const stacks = t.state.table.seats.reduce((a, s) => a + s.stack, 0)
  const ph = t.state.poker.phase
  const live = ph !== 'idle' && ph !== 'complete'
  const middle = live ? Object.values(t.state.poker.total).reduce((a: number, n) => a + n, 0) : 0
  return stacks + middle
}

export { apply, project, facesIn, canSee, buildPots, seededRandom }
export type { RoomState }
