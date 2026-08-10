import type { SeatId } from '../src/core/types.ts'
import { apply, initialState, type RoomState } from '../src/core/state.ts'
import { decide } from '../src/core/decide.ts'
import { startHand, buildPots } from '../src/games/poker/engine.ts'
import { legalActions } from '../src/games/poker/state.ts'
import { seededRandom, type RandomSource } from '../src/core/cards.ts'
import { project, facesIn, canSee } from '../src/core/project.ts'

export interface Violation {
  invariant: string
  detail: string
  seed: number
  hand: number
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
const stacks = (s: RoomState) => sum(s.table.seats.map((x) => x.stack))
const middle = (s: RoomState) => sum(Object.values(s.poker.total))

/**
 * Total chips in the room. While a hand is live, committed chips have been
 * debited from stacks and sit in the middle; once it completes they are back.
 */
export function chips(s: RoomState): number {
  const ph = s.poker.phase
  const live = ph !== 'idle' && ph !== 'complete'
  return stacks(s) + (live ? middle(s) : 0)
}

/** Fold the whole log from genesis. Used by F7. */
export const replay = (log: Parameters<typeof apply>[1][]) => log.reduce(apply, initialState())

export interface FuzzOptions {
  seed: number
  hands: number
  /** 0..1 — how often a bot shoves when it can. High values stress side pots. */
  aggression?: number
}

export interface FuzzResult {
  hands: number
  violations: Violation[]
  showdowns: number
  sidePots: number
  splitPots: number
  allIns: number
}

/**
 * Plays whole hands with random bots and checks every invariant continuously.
 *
 * Bots are biased hard toward all-in because that is where the engine's real
 * complexity lives: side pots, uncalled returns, short all-ins that must not
 * reopen action.
 */
export function fuzz(opts: FuzzOptions): FuzzResult {
  const rng = seededRandom(opts.seed)
  const aggression = opts.aggression ?? 0.35
  const violations: Violation[] = []
  const result: FuzzResult = { hands: 0, violations, showdowns: 0, sidePots: 0, splitPots: 0, allIns: 0 }

  const seatCount = 2 + rng(7) // 2..8
  const bb = [10, 20, 25, 50][rng(4)]!
  const sb = Math.max(1, Math.floor(bb / 2))

  let s = initialState()
  const log: Parameters<typeof apply>[1][] = []
  const emit = (events: Parameters<typeof apply>[1][]) => {
    for (const e of events) {
      log.push(e)
      s = apply(s, e)
    }
  }

  emit([
    {
      t: 'room_opened',
      settings: { ...s.settings, mode: 'poker', smallBlind: sb, bigBlind: bb, startingStack: 2000 },
    },
  ])
  for (let i = 0; i < seatCount; i++) {
    emit([{ t: 'seat_added', seatId: `s${i}`, name: `P${i}`, stack: 2000 }])
  }
  emit([{ t: 'table_opened', startingStack: 2000 }])

  // Uneven stacks are what make side pots happen at all. This goes through the
  // log like everything else — mutating state directly here would break F7 for
  // reasons that have nothing to do with the engine.
  for (const seat of s.table.seats) {
    const want = [40, 90, 150, 300, 700, 1500, 2000][rng(7)]!
    emit([{ t: 'counter_adjusted', seatId: seat.id, delta: want - seat.stack, reason: 'fuzz setup' }])
  }

  const fail = (invariant: string, detail: string) =>
    violations.push({ invariant, detail, seed: opts.seed, hand: result.hands })

  for (let hand = 0; hand < opts.hands; hand++) {
    // Top anyone up who cannot post, so the table keeps playing.
    for (const seat of s.table.seats) {
      if (seat.stack < bb) emit([{ t: 'restack', seatId: seat.id, amount: 2000 - seat.stack }])
    }

    const before = chips(s)
    const started = startHand(s, rng)
    if (!started.ok) break
    emit(started.events)
    result.hands++

    const checkStep = (where: string) => {
      if (chips(s) !== before) {
        fail('F1 chips conserved', `${where}: ${chips(s)} != ${before}`)
      }
      for (const seat of s.table.seats) {
        if (seat.stack < 0) fail('F2 no negative stacks', `${where}: ${seat.id} = ${seat.stack}`)
      }
    }
    checkStep('deal')

    let guard = 0
    while (s.poker.phase !== 'complete' && s.table.turn && guard++ < 400) {
      const id = s.table.turn
      const legal = legalActions(s, id)
      if (legal.length === 0) {
        fail('liveness', `no legal action for ${id} in ${s.poker.phase}`)
        break
      }

      const seat = s.table.seats.find((x) => x.id === id)!
      const committed = s.poker.street[id] ?? 0
      const maxTo = committed + seat.stack
      const canRaise = legal.includes('raise') || legal.includes('bet')
      const kind = legal.includes('raise') ? 'raise' : 'bet'

      let cmd: Parameters<typeof decide>[1]
      const roll = rng(100) / 100
      if (canRaise && roll < aggression) {
        // Shove, or a random legal size in between.
        const raiseStep = Math.max(s.poker.lastRaiseSize, bb)
        const minTo = s.poker.currentBet + raiseStep
        const to = roll < aggression / 2 ? maxTo : Math.min(maxTo, minTo + rng(200))
        cmd = { c: 'poker_action', seatId: id, action: kind, amount: Math.max(to, Math.min(minTo, maxTo)) }
      } else if (legal.includes('check')) {
        cmd = { c: 'poker_action', seatId: id, action: 'check' }
      } else if (legal.includes('call') && rng(10) > 2) {
        cmd = { c: 'poker_action', seatId: id, action: 'call' }
      } else {
        cmd = { c: 'poker_action', seatId: id, action: 'fold' }
      }

      const d = decide(s, cmd, rng)
      if (!d.ok) {
        // Only a size-related refusal is acceptable; anything else means
        // legalActions and decide disagree, which is a real bug.
        if (d.reason !== 'below-min-raise' && d.reason !== 'insufficient-chips') {
          fail('F5 legal/decide agree', `${JSON.stringify(cmd)} -> ${d.reason}`)
          break
        }
        emit([])
        const fallback = decide(
          s,
          { c: 'poker_action', seatId: id, action: legal.includes('check') ? 'check' : 'fold' },
          rng,
        )
        if (!fallback.ok) {
          fail('F5 legal/decide agree', `fallback -> ${fallback.reason}`)
          break
        }
        emit(fallback.events)
      } else {
        emit(d.events)
      }
      checkStep('action')
    }

    // --- end-of-hand invariants -------------------------------------------
    const p = s.poker
    const potSum = sum(p.pots.map((x) => x.amount))
    const awards = p.result?.awards ?? []
    const awardSum = sum(awards.map((a) => a.amount))

    if (p.pots.length > 1) result.sidePots++
    if (p.result?.showdown) result.showdowns++
    if (awards.some((a) => a.seatIds.length > 1)) result.splitPots++
    if (Object.values(p.allIn).some(Boolean)) result.allIns++

    // No pot awarded twice, and none left unawarded.
    if (awardSum !== potSum) {
      fail('no double award', `awarded ${awardSum} of ${potSum}`)
    }
    if (new Set(awards.map((a) => a.potIndex)).size !== awards.length) {
      fail('no double award', `duplicate potIndex in ${JSON.stringify(awards.map((a) => a.potIndex))}`)
    }

    // F3: nobody is eligible for a pot they did not contribute to.
    for (const pot of buildPots(s)) {
      for (const id of pot.eligible) {
        if ((p.total[id] ?? 0) <= 0) fail('F3 eligibility', `${id} eligible with no contribution`)
        if (p.folded[id]) fail('F3 eligibility', `${id} folded but eligible`)
      }
    }

    // F6: an odd chip goes to the first eligible winner left of the button.
    for (const a of awards) {
      if (a.seatIds.length < 2) continue
      if (a.amount % a.seatIds.length === 0) continue
      const order = ringOrder(s.table.seats.map((x) => x.id), p.button)
      const expected = order.find((x) => a.seatIds.includes(x))
      const evt = log
        .filter((e) => e.t === 'pot_awarded' && e.potIndex === a.potIndex)
        .at(-1) as { odd?: SeatId | null } | undefined
      if (evt && evt.odd !== expected) {
        fail('F6 odd chip', `odd chip to ${evt.odd}, expected ${expected}`)
      }
    }

    checkStep('hand end')

    // F7: replaying the log from genesis reproduces the live state exactly.
    // Compared with sorted keys, because two paths can build the same record in
    // different insertion orders and that is not a divergence.
    const replayed = replay(log)
    const a = canonical(replayed)
    const b = canonical(s)
    if (a !== b) {
      fail('F7 restart equivalence', firstDiff(a, b))
    }

    // Premise 4: no projection ever carries a face its viewer is not owed.
    for (const seat of s.table.seats) {
      const view = project(s, seat.id)
      for (const face of facesIn(view)) {
        const zoneId = Object.keys(s.table.cards).find((z) => (s.table.cards[z] ?? []).includes(face))
        if (!zoneId) continue
        const allowed = canSee(s, zoneId, seat.id) || (s.table.faceUp[face] ?? false)
        if (!allowed) fail('P4 card secrecy', `${seat.id} can see ${face} in ${zoneId}`)
      }
    }

    if (violations.length > 20) break
  }

  return result
}

/** JSON with object keys sorted, so key order never counts as a difference. */
export function canonical(v: unknown): string {
  return JSON.stringify(v, (_k, val) => {
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      const out: Record<string, unknown> = {}
      for (const k of Object.keys(val as object).sort()) out[k] = (val as Record<string, unknown>)[k]
      return out
    }
    return val
  })
}

function firstDiff(a: string, b: string): string {
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  return `diverges at ${i}: replay=${a.slice(Math.max(0, i - 60), i + 60)} | live=${b.slice(Math.max(0, i - 60), i + 60)}`
}

function ringOrder(ids: SeatId[], from: SeatId | null): SeatId[] {
  const start = from ? ids.indexOf(from) : -1
  const out: SeatId[] = []
  for (let i = 1; i <= ids.length; i++) out.push(ids[(start + i + ids.length * 2) % ids.length]!)
  return out
}

export { seededRandom }
export type { RandomSource }
