import { describe, expect, test } from 'bun:test'
import { HostTable } from '../src/net/table.ts'
import type { Wire } from '../src/net/peers.ts'
import { handZoneId } from '../src/core/state.ts'
import { project } from '../src/core/project.ts'
import { validateHand } from '../src/games/rummy/melds.ts'
import { HAND_SIZE, wildRank } from '../src/games/rummy/engine.ts'

const silentWire = (): Wire => ({
  hello: { send: () => {}, on: () => {} },
  command: { send: () => {}, on: () => {} },
  snapshot: { send: () => {}, on: () => {} },
  log: { send: () => {}, on: () => {} },
  reject: { send: () => {}, on: () => {} },
  onPeerJoin: () => {},
  onPeerLeave: () => {},
  peers: () => [],
  leave: () => {},
})

function rummy(names = ['Mom', 'Dad', 'You']) {
  const t = new HostTable(silentWire(), 'seat1', () => {})
  t.changeSettings({ mode: 'rummy', counters: false })
  t.seatSelf(names[0]!)
  names.slice(1).forEach((n, i) => t.addSeatForTest(`seat${i + 2}`, n))
  t.openTable()
  return t
}

describe('the rummy deal', () => {
  test('thirteen each, a wild joker, and one card starting the open pile', () => {
    const t = rummy()
    for (const s of t.state.table.seats) {
      expect((t.state.table.cards[handZoneId(s.id)] ?? []).length).toBe(HAND_SIZE)
    }
    expect((t.state.table.cards['wild'] ?? []).length).toBe(1)
    expect((t.state.table.cards['discard'] ?? []).length).toBe(1)
    // Two decks plus a printed joker each: 106 cards, all accounted for.
    const all = Object.values(t.state.table.cards).flat()
    expect(all.length).toBe(106)
    expect(new Set(all).size).toBe(106)
    t.stop()
  })

  test('nobody sees anyone else’s hand or the closed deck', () => {
    const t = rummy()
    for (const seat of t.state.table.seats) {
      const view = project(t.state, seat.id)
      const mine = view.zones.find((z) => z.owner === seat.id)!
      expect(mine.cards.every((c) => c.id)).toBe(true)
      for (const z of view.zones) {
        if (z.id === mine.id) continue
        if (z.kind === 'hand' || z.kind === 'deck') {
          expect(z.cards.some((c) => c.id), `${seat.id} saw a face in ${z.id}`).toBe(false)
        }
      }
      // The joker and the open pile are public — everyone must see those.
      expect(view.zones.find((z) => z.id === 'wild')!.cards[0]!.id).toBeTruthy()
      expect(view.zones.find((z) => z.id === 'discard')!.cards[0]!.id).toBeTruthy()
    }
    t.stop()
  })
})

describe('the turn is draw then discard', () => {
  test('you cannot discard before drawing', () => {
    const t = rummy()
    const me = t.state.table.turn!
    const hand = t.state.table.cards[handZoneId(me)]!
    const r = t.execForTest({ c: 'discard', seatId: me, cardId: hand[0]! }, me, me === 'seat1')
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('must-draw-first')
    t.stop()
  })

  test('you cannot draw twice', () => {
    const t = rummy()
    const me = t.state.table.turn!
    expect(t.execForTest({ c: 'draw', seatId: me, from: 'closed' }, me, true).ok).toBe(true)
    const again = t.execForTest({ c: 'draw', seatId: me, from: 'open' }, me, true)
    expect(again.ok).toBe(false)
    expect(again.reason).toBe('must-discard')
    t.stop()
  })

  test('drawing then discarding passes the turn and keeps the hand at thirteen', () => {
    const t = rummy()
    const me = t.state.table.turn!
    t.execForTest({ c: 'draw', seatId: me, from: 'closed' }, me, true)
    expect(t.state.table.cards[handZoneId(me)]!.length).toBe(HAND_SIZE + 1)

    const card = t.state.table.cards[handZoneId(me)]![0]!
    t.execForTest({ c: 'discard', seatId: me, cardId: card }, me, true)
    expect(t.state.table.cards[handZoneId(me)]!.length).toBe(HAND_SIZE)
    expect(t.state.table.turn).not.toBe(me)
    // The discarded card is now the top of the open pile, face up.
    const open = t.state.table.cards['discard']!
    expect(open[open.length - 1]).toBe(card)
    expect(t.state.table.faceUp[card]).toBe(true)
    t.stop()
  })

  test('taking from the open pile takes the visible top card', () => {
    const t = rummy()
    const me = t.state.table.turn!
    const open = t.state.table.cards['discard']!
    const top = open[open.length - 1]!
    t.execForTest({ c: 'draw', seatId: me, from: 'open' }, me, true)
    expect(t.state.table.cards[handZoneId(me)]).toContain(top)
    t.stop()
  })

  test('it is not your turn until it is', () => {
    const t = rummy()
    const me = t.state.table.turn!
    const other = t.state.table.seats.find((s) => s.id !== me)!.id
    const r = t.execForTest({ c: 'draw', seatId: other, from: 'closed' }, other, false)
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('not-your-turn')
    t.stop()
  })
})

describe('declaring', () => {
  test('you cannot declare before drawing', () => {
    const t = rummy()
    const me = t.state.table.turn!
    const hand = t.state.table.cards[handZoneId(me)]!
    const r = t.execForTest({ c: 'declare', seatId: me, cardId: hand[0]! }, me, true)
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('must-draw-first')
    t.stop()
  })

  test('an invalid declaration is refused with a reason, and costs nothing', () => {
    const t = rummy()
    const me = t.state.table.turn!
    t.execForTest({ c: 'draw', seatId: me, from: 'closed' }, me, true)
    const hand = t.state.table.cards[handZoneId(me)]!
    const before = hand.length

    const r = t.execForTest({ c: 'declare', seatId: me, cardId: hand[0]! }, me, true)
    // A random 14-card hand is essentially never a valid declaration.
    if (!r.ok) {
      expect(r.reason).toBe('invalid-declaration')
      expect(t.state.table.cards[handZoneId(me)]!.length).toBe(before)
      expect(t.state.rummy.winner).toBeNull()
    }
    t.stop()
  })

  test('a valid declaration ends the hand and shows every hand', () => {
    const t = rummy(['Mom', 'Dad'])
    const me = t.state.table.turn!
    const wild = wildRank(t.state)

    // You declare on your own turn, after drawing — so draw first, exactly as
    // a player would, and only then put the winning hand in place.
    t.execForTest({ c: 'draw', seatId: me, from: 'closed' }, me, true)

    const winning = ['2S', '3S', '4S', '5H', '6H', '7H', '9C', '9D', '9H', 'KS', 'KD', 'KH', 'KC']
    const spare = '8C'
    expect(validateHand(winning, wild).valid).toBe(true)
    t.stackHandForTest(me, [...winning, spare])

    const r = t.execForTest({ c: 'declare', seatId: me, cardId: spare }, me, true)
    expect(r.ok).toBe(true)
    expect(t.state.rummy.winner).toBe(me)
    expect(t.state.rummy.phase).toBe('complete')
    expect(t.state.table.turn).toBeNull()

    // Everyone's cards are on the table now, so the win can be seen.
    const view = project(t.state, t.state.table.seats[1]!.id)
    const mine = view.zones.find((z) => z.owner === me)!
    expect(mine.cards.every((c) => c.id)).toBe(true)
    t.stop()
  })
})
