import { describe, expect, test } from 'bun:test'
import {
  TABLE_H,
  TABLE_W,
  apply,
  emptyTable,
  inHand,
  onTable,
  project,
  stacks,
  type Action,
  type TableState,
} from '../src/table/model.ts'
import { standard } from '../src/table/deck.ts'
import { Host } from '../src/net/host.ts'
import type { Wire } from '../src/net/peers.ts'

const run = (s: TableState, ...as: Action[]) => as.reduce(apply, s)

const dealt = () =>
  run(emptyTable(), {
    t: 'reset',
    deckName: 'test',
    cards: standard(1).map((id) => ({ id, faceUp: false })),
    x: 500,
    y: 320,
  })

describe('the table model', () => {
  test('a new deck arrives as one pile in the middle', () => {
    const s = dealt()
    expect(onTable(s).length).toBe(52)
    expect(stacks(s).length).toBe(1)
    expect(onTable(s).every((c) => c.x === 500 && c.y === 320)).toBe(true)
  })

  test('moving a card off the pile makes two piles', () => {
    const s = run(dealt(), { t: 'move', ids: ['AS'], x: 200, y: 200 })
    expect(stacks(s).length).toBe(2)
    expect(s.cards['AS']!.x).toBe(200)
  })

  test('a moved card comes to the top', () => {
    const s = run(dealt(), { t: 'move', ids: ['2C'], x: 200, y: 200 })
    const top = Math.max(...onTable(s).map((c) => c.z))
    expect(s.cards['2C']!.z).toBe(top)
  })

  test('cards dropped on the same spot are one pile again', () => {
    const s = run(
      dealt(),
      { t: 'move', ids: ['AS'], x: 200, y: 200 },
      { t: 'move', ids: ['KS'], x: 200, y: 200 },
    )
    const pile = stacks(s).find((p) => p[0]!.x === 200)!
    expect(pile.length).toBe(2)
  })

  test('flipping toggles, and can be forced', () => {
    let s = run(dealt(), { t: 'flip', ids: ['AS'] })
    expect(s.cards['AS']!.faceUp).toBe(true)
    s = run(s, { t: 'flip', ids: ['AS'] })
    expect(s.cards['AS']!.faceUp).toBe(false)
    s = run(s, { t: 'flip', ids: ['AS'], faceUp: true })
    expect(s.cards['AS']!.faceUp).toBe(true)
  })

  test('taking a card removes it from the table and puts it in a hand', () => {
    const s = run(dealt(), { t: 'seat_add', id: 'a', name: 'A', colour: '#000' }, { t: 'take', ids: ['AS'], seat: 'a' })
    expect(onTable(s).length).toBe(51)
    expect(inHand(s, 'a').map((c) => c.id)).toEqual(['AS'])
  })

  test('playing a card puts it back on the table where you say', () => {
    const s = run(
      dealt(),
      { t: 'seat_add', id: 'a', name: 'A', colour: '#000' },
      { t: 'take', ids: ['AS'], seat: 'a' },
      { t: 'play', ids: ['AS'], x: 120, y: 90, faceUp: true },
    )
    expect(inHand(s, 'a').length).toBe(0)
    expect(s.cards['AS']).toMatchObject({ x: 120, y: 90, faceUp: true, hand: null })
  })

  test('a player leaving puts their cards back on the table, face down', () => {
    const s = run(
      dealt(),
      { t: 'seat_add', id: 'a', name: 'A', colour: '#000' },
      { t: 'take', ids: ['AS', 'KS'], seat: 'a' },
      { t: 'seat_remove', id: 'a' },
    )
    expect(s.seats.length).toBe(0)
    expect(s.cards['AS']).toMatchObject({ hand: null, faceUp: false, x: TABLE_W / 2, y: TABLE_H / 2 })
  })
})

describe('what each player can see', () => {
  const seated = () =>
    run(
      dealt(),
      { t: 'seat_add', id: 'a', name: 'A', colour: '#000' },
      { t: 'seat_add', id: 'b', name: 'B', colour: '#111' },
      { t: 'take', ids: ['AS', 'KS'], seat: 'a' },
      { t: 'take', ids: ['AD'], seat: 'b' },
      { t: 'flip', ids: ['2C'], faceUp: true },
    )

  test('you see your own hand', () => {
    const v = project(seated(), 'a')
    const mine = v.cards.filter((c) => c.hand === 'a')
    expect(mine.length).toBe(2)
    expect(mine.every((c) => c.face)).toBe(true)
  })

  test('you never see anyone else’s hand', () => {
    const v = project(seated(), 'a')
    for (const c of v.cards.filter((x) => x.hand === 'b')) expect(c.face).toBeNull()
  })

  test('a face-down card on the table is a back to everyone', () => {
    const v = project(seated(), 'a')
    const down = v.cards.find((c) => c.id === '3C')!
    expect(down.face).toBeNull()
  })

  test('a face-up card on the table is visible to everyone', () => {
    for (const who of ['a', 'b', null]) {
      const v = project(seated(), who)
      expect(v.cards.find((c) => c.id === '2C')!.face).toBe('2C')
    }
  })

  test('a spectator sees no hand at all', () => {
    const v = project(seated(), null)
    expect(v.cards.filter((c) => c.hand !== null).every((c) => c.face === null)).toBe(true)
    // but they can still count them
    expect(v.handCounts['a']).toBe(2)
    expect(v.handCounts['b']).toBe(1)
  })
})

// ---------------------------------------------------------------------------

const silent = (): Wire => ({
  hello: { send: () => {}, on: () => {} },
  action: { send: () => {}, on: () => {} },
  snapshot: { send: () => {}, on: () => {} },
  drag: { send: () => {}, on: () => {} },
  chat: { send: () => {}, on: () => {} },
  onPeerJoin: () => {},
  onPeerLeave: () => {},
  peers: () => [],
  leave: () => {},
})

function hosted(names = ['Mom', 'Dad', 'You']) {
  const h = new Host(silent(), 'host', () => {})
  h.seatSelf(names[0]!)
  names.slice(1).forEach((n, i) => h.state = apply(h.state, { t: 'seat_add', id: `s${i + 2}`, name: n, colour: '#000' }))
  return h
}

describe('the host', () => {
  test('setting the table deals the preset to everyone', () => {
    const h = hosted()
    h.setup('poker')
    for (const seat of h.state.seats) expect(h.handOf(seat.id).length).toBe(2)
    expect(Object.keys(h.state.cards).length).toBe(52)
  })

  test('rummy uses two decks and jokers, thirteen each', () => {
    const h = hosted()
    h.setup('rummy')
    expect(Object.keys(h.state.cards).length).toBe(106)
    for (const seat of h.state.seats) expect(h.handOf(seat.id).length).toBe(13)
  })

  test('bluff deals the whole deck out evenly', () => {
    const h = hosted()
    h.setup('bluff')
    const dealtOut = h.state.seats.reduce((a, s) => a + h.handOf(s.id).length, 0)
    expect(dealtOut).toBe(51) // 17 each, one left over on the table
  })

  test('gather brings every card back into one pile', () => {
    const h = hosted()
    h.setup('poker')
    h.gather()
    expect(h.tableCards().length).toBe(52)
    expect(stacks(h.state).length).toBe(1)
    for (const seat of h.state.seats) expect(h.handOf(seat.id).length).toBe(0)
  })

  test('dealing takes from the biggest face-down pile', () => {
    const h = hosted()
    h.setup('deck')
    h.deal(5)
    for (const seat of h.state.seats) expect(h.handOf(seat.id).length).toBe(5)
    expect(h.tableCards().length).toBe(52 - 15)
  })

  test('shuffling a pile keeps the same cards in the same place', () => {
    const h = hosted()
    h.setup('deck')
    const before = h.tableCards()
    h.shuffleStack(before.map((c) => c.id))
    const after = h.tableCards()
    expect(after.length).toBe(before.length)
    expect(new Set(after.map((c) => c.id))).toEqual(new Set(before.map((c) => c.id)))
    expect(after.every((c) => c.x === 500 && c.y === 320)).toBe(true)
  })

  test('nobody can move a card out of somebody else’s hand', () => {
    const h = hosted()
    h.setup('poker')
    const theirs = h.handOf('s2')[0]!.id
    const before = h.state.cards[theirs]!.hand
    // s3 tries to take a card that is in s2's hand.
    h['fromPeer']({ t: 'take', ids: [theirs], seat: 's3' } as Action, 'nobody')
    expect(h.state.cards[theirs]!.hand).toBe(before)
  })
})

describe('seating is not a way to take somebody else’s cards', () => {
  test('a peer with the host’s name does not get the host’s seat', () => {
    const h = new Host(silent(), 'host', () => {})
    h.seatSelf('Mom')
    h.setup('poker')
    const hostHand = h.handOf('host').map((c) => c.id)

    // Someone joins claiming to be Mom as well.
    h['seat']('peer1', 'Mom')

    expect(h.state.seats.length).toBe(2)
    expect(h.state.seats[1]!.name).not.toBe('Mom') // disambiguated
    expect(h.handOf('host').map((c) => c.id)).toEqual(hostHand)
  })

  test('a connected seat is never reclaimed by a namesake', () => {
    const h = new Host(silent(), 'host', () => {})
    h.seatSelf('Host')
    h['seat']('peer1', 'Dad')
    h['seat']('peer2', 'Dad')
    expect(h.state.seats.length).toBe(3)
    expect(new Set(h.state.seats.map((s) => s.name)).size).toBe(3)
  })

  test('someone who really did drop gets their own seat back', () => {
    const h = new Host(silent(), 'host', () => {})
    h.seatSelf('Host')
    h['seat']('peer1', 'Dad')
    h.setup('poker')
    const before = h.handOf('s2').map((c) => c.id)

    h['dropped']('peer1')
    expect(h.state.seats.find((s) => s.id === 's2')!.connected).toBe(false)

    h['seat']('peer9', 'Dad')
    expect(h.state.seats.length).toBe(2)
    expect(h.state.seats.find((s) => s.id === 's2')!.connected).toBe(true)
    expect(h.handOf('s2').map((c) => c.id)).toEqual(before) // cards waited for them
  })
})
