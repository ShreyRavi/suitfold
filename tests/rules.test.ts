import { describe, expect, test } from 'bun:test'
import {
  act,
  chipsInRoom,
  deal,
  dealStacked,
  legal,
  phase,
  pots,
  stackOf,
  table,
  tryAct,
  tryRun,
  turn,
  maxTo,
  raiseTo,
  playOut,
} from './harness.ts'
import { buildPots } from '../src/games/poker/engine.ts'

// One deterministic, hand-authored test per case named in Premise 3 of the
// design doc. The fuzzer catches what we didn't think of; these catch what we did.

const BB = 20
const SB = 10
const cfg = { smallBlind: SB, bigBlind: BB }

describe('blinds and position', () => {
  test('three-handed: button, sb, bb rotate one seat each hand', () => {
    let t = table(['Mom', 'Dad', 'You'], cfg)
    t = deal(t)
    expect(t.state.poker.button).toBe('s0')
    expect(t.state.poker.sbSeat).toBe('s1')
    expect(t.state.poker.bbSeat).toBe('s2')
    // preflop action starts left of the big blind, which wraps to the button
    expect(turn(t)).toBe('s0')

    t = act(t, 's0', 'fold')
    t = act(t, 's1', 'fold')
    expect(phase(t)).toBe('complete')

    t = deal(t)
    expect(t.state.poker.bbSeat).toBe('s0')
    expect(t.state.poker.sbSeat).toBe('s2')
    expect(t.state.poker.button).toBe('s1')
  })

  test('heads-up: button posts the small blind, acts first preflop, last after', () => {
    let t = table(['Mom', 'Dad'], cfg)
    t = deal(t)
    expect(t.state.poker.button).toBe('s0')
    expect(t.state.poker.sbSeat).toBe('s0') // button IS the small blind
    expect(t.state.poker.bbSeat).toBe('s1')
    expect(turn(t)).toBe('s0') // button acts first preflop

    t = act(t, 's0', 'call')
    t = act(t, 's1', 'check')
    expect(phase(t)).toBe('flop')
    expect(turn(t)).toBe('s1') // and last postflop: BB is first to act
  })

  test('dead small blind: the seat before the BB is empty, nobody posts it', () => {
    let t = table(['A', 'B', 'C', 'D'], cfg)
    t = deal(t) // button s0, sb s1, bb s2
    while (phase(t) !== 'complete') {
      const id = turn(t)!
      t = act(t, id, legal(t, id).includes('check') ? 'check' : 'fold')
    }
    // C stands up. Next hand's BB advances to D; the seat before D is C (away),
    // so the small blind is dead.
    t = tryRun(t, { c: 'stand_up', seatId: 's2' }).table
    t = deal(t)
    expect(t.state.poker.bbSeat).toBe('s3')
    expect(t.state.poker.sbSeat).toBeNull()
    const posted = Object.values(t.state.poker.total).reduce((a, n) => a + n, 0)
    expect(posted).toBe(BB) // big blind only
  })
})

describe('minimum raise sizing', () => {
  test('BB 20, raise to 60 -> next minimum raise is 100, not 80', () => {
    let t = table(['A', 'B', 'C'], cfg)
    t = deal(t)
    t = act(t, 's0', 'raise', 60) // increment 40 over the BB
    expect(t.state.poker.currentBet).toBe(60)
    expect(t.state.poker.lastRaiseSize).toBe(40)

    const tooSmall = tryAct(t, 's1', 'raise', 80)
    expect(tooSmall.ok).toBe(false)
    if (!tooSmall.ok) expect(tooSmall.reason).toBe('below-min-raise')

    expect(tryAct(t, 's1', 'raise', 100).ok).toBe(true)
  })

  test('first raise preflop must be to at least twice the big blind', () => {
    let t = table(['A', 'B', 'C'], cfg)
    t = deal(t)
    expect(tryAct(t, 's0', 'raise', 30).ok).toBe(false)
    expect(tryAct(t, 's0', 'raise', 40).ok).toBe(true)
  })

  test('minimum raise when the big blind is short and all-in', () => {
    // s2 can only cover 12 of the 20 big blind.
    let t = table(['A', 'B', 'C'], cfg, [2000, 2000, 12])
    t = deal(t)
    expect(t.state.poker.allIn['s2']).toBe(true)
    // The bet to match is still the full big blind, so a minimum raise is 40.
    expect(t.state.poker.currentBet).toBe(BB)
    expect(tryAct(t, 's0', 'raise', 30).ok).toBe(false)
    expect(tryAct(t, 's0', 'raise', 40).ok).toBe(true)
  })
})

describe('short all-in does not reopen action', () => {
  test('a player who already acted may only call or fold', () => {
    // A opens to 100. B calls. C shoves 140 — a 40 increment against a 80 raise
    // size, so it is short and must not reopen A's action.
    let t = table(['A', 'B', 'C'], cfg, [2000, 2000, 140])
    t = deal(t)
    t = act(t, 's0', 'raise', 100)
    t = act(t, 's1', 'call')
    t = act(t, 's2', 'raise', 140)
    expect(t.state.poker.allIn['s2']).toBe(true)
    expect(t.state.poker.currentBet).toBe(140)
    expect(t.state.poker.lastRaiseSize).toBe(80) // unchanged by the short shove

    expect(turn(t)).toBe('s0')
    const opts = legal(t, 's0')
    expect(opts).toContain('call')
    expect(opts).toContain('fold')
    expect(opts).not.toContain('raise')

    const attempt = tryAct(t, 's0', 'raise', 300)
    expect(attempt.ok).toBe(false)
    if (!attempt.ok) expect(attempt.reason).toBe('action-not-reopened')
  })

  test('a player who has NOT yet acted may still raise over a short all-in', () => {
    let t = table(['A', 'B', 'C', 'D'], cfg, [2000, 140, 2000, 2000])
    t = deal(t) // button s0, sb s1, bb s2, first to act s3
    t = act(t, 's3', 'raise', 100)
    t = act(t, 's0', 'call')
    t = act(t, 's1', 'raise', 140) // short all-in
    expect(t.state.poker.allIn['s1']).toBe(true)
    // s2 (the big blind) has not acted this street yet, so it may still raise.
    expect(turn(t)).toBe('s2')
    expect(legal(t, 's2')).toContain('raise')
  })

  test('a FULL raise does reopen action for everyone', () => {
    let t = table(['A', 'B', 'C'], cfg)
    t = deal(t)
    t = act(t, 's0', 'raise', 60)
    t = act(t, 's1', 'call')
    t = act(t, 's2', 'raise', 200) // full raise
    expect(turn(t)).toBe('s0')
    expect(legal(t, 's0')).toContain('raise')
  })
})

describe('big blind option', () => {
  test('everyone limps: the big blind may check or raise', () => {
    let t = table(['A', 'B', 'C'], cfg)
    t = deal(t)
    t = act(t, 's0', 'call') // button limps
    t = act(t, 's1', 'call') // sb completes
    expect(phase(t)).toBe('preflop') // NOT advanced — the BB still has an option
    expect(turn(t)).toBe('s2')
    const opts = legal(t, 's2')
    expect(opts).toContain('check')
    expect(opts).toContain('raise')

    t = act(t, 's2', 'check')
    expect(phase(t)).toBe('flop')
  })
})

describe('uncalled bet return', () => {
  test('bet 500 against a 200 all-in returns 300 before any pot is built', () => {
    let t = table(['A', 'B'], cfg, [2000, 200])
    const before = stackOf(t, 's0')
    t = deal(t)
    // s0 is the button/SB heads-up and acts first.
    t = act(t, 's0', 'raise', 500)
    t = act(t, 's1', 'call') // all-in for 200
    // s1 is all-in, s0 has 500 out. 300 must come back.
    const total = pots(t).reduce((a, p) => a + p.amount, 0)
    expect(total).toBe(400) // 200 each, not 700
    // Whatever the showdown decides, s0 can be down at most its 200 matched.
    expect(stackOf(t, 's0')).toBeGreaterThanOrEqual(before - 200)
  })

  test('folding to a bet returns the uncalled portion and awards the rest', () => {
    let t = table(['A', 'B'], cfg)
    const start = stackOf(t, 's0')
    t = deal(t)
    t = act(t, 's0', 'raise', 200)
    t = act(t, 's1', 'fold')
    // s0 wins its own 200 back plus the big blind: net +20.
    expect(stackOf(t, 's0')).toBe(start + BB)
  })
})

describe('side pots', () => {
  test('three all-ins of different sizes build three pots with shrinking eligibility', () => {
    let t = table(['A', 'B', 'C'], cfg, [100, 300, 900])
    t = deal(t)
    // Everyone gets it in. Totals end at 100 / 300 / 300 (C's excess returns).
    t = playOut(t, () => 'shove')
    const built = pots(t)
    expect(built.length).toBe(2)
    expect(built[0]!.amount).toBe(300) // 100 x 3, everyone eligible
    expect(built[0]!.eligible.sort()).toEqual(['s0', 's1', 's2'])
    expect(built[1]!.amount).toBe(400) // 200 x 2, only B and C
    expect(built[1]!.eligible.sort()).toEqual(['s1', 's2'])
  })

  test('a folded player contributes to a pot they cannot win (F3 stated correctly)', () => {
    const state = table(['A', 'B', 'C'], cfg).state
    const p = {
      ...state.poker,
      players: ['s0', 's1', 's2'],
      total: { s0: 50, s1: 200, s2: 200 },
      folded: { s0: true, s1: false, s2: false },
    }
    const built = buildPots({ ...state, poker: p })
    // Both layers have the same eligible set, so they are genuinely one pot.
    expect(built.length).toBe(1)
    expect(built[0]!.amount).toBe(450) // 50 (dead, from the folder) + 400
    // F3: nobody is eligible for a pot they did not contribute to. The folder's
    // 50 is IN the pot, and the folder is not eligible for it — which is correct
    // and is why F3 is stated in this direction.
    expect(built[0]!.eligible.sort()).toEqual(['s1', 's2'])
    for (const pot of built) {
      for (const id of pot.eligible) {
        expect((p.total as Record<string, number>)[id]!).toBeGreaterThan(0)
      }
    }
  })
})

describe('all-in before the river', () => {
  test('remaining streets are dealt with no betting round', () => {
    let t = table(['A', 'B'], cfg, [400, 400])
    t = deal(t)
    t = raiseTo(t, 's0', maxTo(t, 's0'))
    t = act(t, 's1', 'call')
    expect(phase(t)).toBe('complete')
    expect((t.state.table.cards['board'] ?? []).length).toBe(5)
    expect(turn(t)).toBeNull()
  })
})

describe('leaving mid-hand', () => {
  test("only that player's hand dies; the hand continues and their chips stay in", () => {
    let t = table(['A', 'B', 'C'], cfg)
    t = deal(t)
    t = act(t, turn(t)!, 'call')
    t = act(t, turn(t)!, 'call')
    t = act(t, turn(t)!, 'check')
    expect(phase(t)).toBe('flop')
    // flop: whoever is first to act bets, then stands up mid-hand
    const bettor = turn(t)!
    t = act(t, bettor, 'bet', 100)
    const potBefore = Object.values(t.state.poker.total).reduce((a, n) => a + n, 0)
    t = tryRun(t, { c: 'stand_up', seatId: bettor }).table

    expect(t.state.poker.folded[bettor]).toBe(true)
    // Their committed chips are still in the hand.
    expect(Object.values(t.state.poker.total).reduce((a, n) => a + n, 0)).toBe(potBefore)
    // And the hand is still live for the others.
    expect(t.state.poker.players.filter((id) => !t.state.poker.folded[id]).length).toBe(2)
  })
})

describe('odd chip on a split pot', () => {
  // A two-player pot is always even, because both players match. An odd pot
  // needs a dead contribution - here, a small blind that folds.
  const SPLIT_DECK = [
    '2C', '2H', '2D', '3C', '3H', '3D', // hole cards: s0, s1, s2, s0, s1, s2
    '7H', 'AS', 'KS', 'QS',             // burn + flop
    '8H', 'JS',                         // burn + turn
    '9H', 'TS',                         // burn + river
  ]

  test('splits evenly when the pot divides', () => {
    let t = table(['A', 'B', 'C'], { smallBlind: 5, bigBlind: 10 })
    t = dealStacked(t, SPLIT_DECK)
    t = act(t, 's0', 'call')  // button limps 10
    t = act(t, 's1', 'call')  // sb completes to 10
    t = act(t, 's2', 'check') // bb option
    t = playOut(t)
    // Board is a royal flush; all three play it, so all three split 30.
    const award = t.state.poker.result!.awards[0]!
    expect(award.seatIds.length).toBe(3)
    expect(award.amount).toBe(30)
  })

  test('an odd chip lands on the first eligible winner left of the button', () => {
    let t = table(['A', 'B', 'C'], { smallBlind: 5, bigBlind: 10 })
    t = dealStacked(t, SPLIT_DECK)
    t = act(t, 's0', 'call') // button limps 10
    t = act(t, 's1', 'fold') // small blind folds, leaving 5 dead in the pot
    t = act(t, 's2', 'check')
    t = playOut(t)

    const award = t.state.poker.result!.awards[0]!
    expect(award.seatIds.sort()).toEqual(['s0', 's2']) // both play the board
    expect(award.amount).toBe(25) // 10 + 10 + 5 dead
    expect(award.amount % award.seatIds.length).toBe(1)

    // Button is s0. Walking left: s1 folded, so s2 is the first eligible winner
    // and takes the odd chip. s0 gets 12, s2 gets 13.
    expect(stackOf(t, 's2') - stackOf(t, 's0')).toBe(1)
  })
})

describe('re-stack', () => {
  test('is refused mid-hand and accepted between hands', () => {
    let t = table(['A', 'B', 'C'], cfg)
    t = deal(t)
    const mid = tryRun(t, { c: 'restack', seatId: 's0', target: 's0', amount: 1000 })
    expect(mid.ok).toBe(false)
    if (!mid.ok) expect(mid.reason).toBe('restack-mid-hand')

    while (phase(t) !== 'complete') {
      const id = turn(t)!
      t = act(t, id, legal(t, id).includes('check') ? 'check' : 'fold')
    }
    const after = tryRun(t, { c: 'restack', seatId: 's0', target: 's0', amount: 1000 })
    expect(after.ok).toBe(true)
    if (after.ok) expect(after.table.state.table.seats[0]!.stack).toBeGreaterThan(1000)
  })
})

describe('chip conservation across a whole hand', () => {
  test('nothing is created or destroyed from deal to showdown', () => {
    let t = table(['A', 'B', 'C', 'D'], cfg, [500, 1200, 800, 2000])
    const before = chipsInRoom(t)
    t = deal(t)
    let guard = 0
    while (phase(t) !== 'complete' && turn(t) && guard++ < 100) {
      const id = turn(t)!
      const opts = legal(t, id)
      if (opts.includes('raise')) t = raiseTo(t, id, t.state.poker.currentBet + 100)
      else if (opts.includes('call')) t = act(t, id, 'call')
      else t = act(t, id, 'check')
      expect(chipsInRoom(t)).toBe(before)
    }
    expect(chipsInRoom(t)).toBe(before)
  })
})
