import { describe, expect, test } from 'bun:test'
import {
  TABLE_H,
  TABLE_W,
  apply,
  emptyTable,
  inHand,
  onTable,
  project,
  chipDiscs,
  snapTarget,
  stacks,
  type Action,
  type TableState,
} from '../src/table/model.ts'
import { PRESETS, standard, uno } from '../src/table/deck.ts'
import { Host, allowed } from '../src/net/host.ts'
import type { Wire } from '../src/net/peers.ts'

const run = (s: TableState, ...as: Action[]) => as.reduce(apply, s)

const dealt = () =>
  run(emptyTable(), {
    t: 'reset',
    deckName: 'test',
    cards: standard(1).map((id) => ({ id, faceUp: false, x: 500, y: 320 })),
    slots: [],
    game: 'deck',
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

  test('indian rummy uses two decks and jokers, thirteen each', () => {
    const h = hosted()
    h.setup('indian-rummy')
    expect(Object.keys(h.state.cards).length).toBe(106)
    for (const seat of h.state.seats) expect(h.handOf(seat.id).length).toBe(13)
  })

  test('poker deals two each and leaves the rest in one pile', () => {
    const h = hosted()
    h.setup('holdem')
    for (const seat of h.state.seats) expect(h.handOf(seat.id).length).toBe(2)
    expect(h.tableCards().length).toBe(52 - 6)
    expect(stacks(h.state).length).toBe(1)
  })

  test('uno is 108 cards with seven each and one turned up', () => {
    const h = hosted()
    h.setup('uno')
    expect(Object.keys(h.state.cards).length).toBe(108)
    for (const seat of h.state.seats) expect(h.handOf(seat.id).length).toBe(7)
    // A starter game leaves a face-up card beside the draw pile.
    const faceUp = h.tableCards().filter((c) => c.faceUp)
    expect(faceUp.length).toBe(1)
    expect(stacks(h.state).length).toBe(2)
  })

  test('the uno deck has the right shape', () => {
    const deck = uno()
    expect(deck.length).toBe(108)
    expect(new Set(deck).size).toBe(108)
    const wilds = deck.filter((c) => c[1] === 'W')
    const fours = deck.filter((c) => c[1] === 'F')
    expect(wilds.length).toBe(4)
    expect(fours.length).toBe(4)
    for (const colour of ['R', 'G', 'B', 'Y']) {
      const mine = deck.filter((c) => c[1] === colour)
      expect(mine.length).toBe(25)
      expect(mine.filter((c) => c.slice(2).split(':')[0] === '0').length).toBe(1)
      expect(mine.filter((c) => c.slice(2).split(':')[0] === '7').length).toBe(2)
    }
  })

  test('memory lays the whole deck out in a grid, not a pile', () => {
    const h = hosted()
    h.setup('memory')
    expect(h.tableCards().length).toBe(52)
    expect(stacks(h.state).length).toBe(52) // every card its own spot
    expect(h.tableCards().every((c) => !c.faceUp)).toBe(true)
  })

  test('every preset produces a table nobody has to fix by hand', () => {
    for (const preset of PRESETS) {
      const h = hosted(['A', 'B', 'C', 'D'])
      h.setup(preset.id)
      const all = Object.values(h.state.cards)
      expect(all.length, preset.name).toBe(preset.cards().length)
      expect(new Set(all.map((c) => c.id)).size, preset.name).toBe(all.length)
      // Nobody is dealt more than the deck holds.
      const dealtOut = h.state.seats.reduce((a, s) => a + h.handOf(s.id).length, 0)
      expect(dealtOut, preset.name).toBeLessThanOrEqual(all.length)
      // Cards are on the table or in a hand, never nowhere.
      expect(h.tableCards().length + dealtOut, preset.name).toBe(all.length)
    }
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
    h.deal({ count: 5, seats: h.state.seats.map((s) => s.id) })
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

describe('dealing and undo', () => {
  test('a short pile spreads round by round instead of loading the first player', () => {
    const h = hosted(['A', 'B', 'C'])
    h.setup('deck')
    // Leave only 4 cards face down to deal from.
    const pile = h.tableCards()
    h['commit']([{ t: 'play', ids: pile.slice(4).map((c) => c.id), x: 100, y: 100, faceUp: true }])
    h.deal({ count: 5, seats: h.state.seats.map((s) => s.id), from: { x: 500, y: 320 } })
    const sizes = h.state.seats.map((s) => h.handOf(s.id).length).sort()
    expect(sizes).toEqual([1, 1, 2]) // nobody gets five while somebody gets none
  })

  test('you can deal to one person', () => {
    const h = hosted(['A', 'B'])
    h.setup('deck')
    h.deal({ count: 3, seats: ['s2'] })
    expect(h.handOf('s2').length).toBe(3)
    expect(h.handOf('host').length).toBe(0)
  })

  test('sources lists face-down piles, biggest first', () => {
    const h = hosted()
    h.setup('deck')
    const before = h.sources()
    expect(before.length).toBe(1)
    expect(before[0]!.count).toBe(52)
    h.turnUp({ x: 500, y: 320 })
    const after = h.sources()
    expect(after[0]!.count).toBe(51) // the turned card is face up, so not a source
  })

  test('undo puts the cards back', () => {
    const h = hosted()
    h.setup('poker')
    const before = h.tableCards().length
    h.deal({ count: 5, seats: h.state.seats.map((s) => s.id) })
    expect(h.tableCards().length).toBeLessThan(before)
    h.undo()
    expect(h.tableCards().length).toBe(before)
  })

  test('undo keeps whoever is currently at the table', () => {
    const h = hosted(['A', 'B'])
    h.setup('poker')
    h['seat']('peer9', 'Late')
    expect(h.state.seats.length).toBe(3)
    h.undo()
    expect(h.state.seats.length).toBe(3) // seats are live state, not card state
  })

  test('undo stops at the beginning rather than breaking', () => {
    const h = hosted()
    expect(h.canUndo).toBe(false)
    h.undo()
    expect(h.state.seats.length).toBeGreaterThan(0)
  })
})

describe('slots and scores', () => {
  test('a game brings its own markings', () => {
    const h = hosted(['A', 'B', 'C', 'D'])
    h.setup('hearts')
    const labels = h.state.slots.map((s) => s.label)
    expect(labels).toContain('Trick')
    expect(labels.filter((l) => l.startsWith('Player')).length).toBe(4)
  })

  test('uno gets a draw pile and a discard', () => {
    const h = hosted()
    h.setup('uno')
    expect(h.state.slots.map((s) => s.label).sort()).toEqual(['Discard', 'Draw'])
  })

  test('a game with no markings clears the previous ones', () => {
    const h = hosted()
    h.setup('uno')
    expect(h.state.slots.length).toBeGreaterThan(0)
    h.setup('memory')
    expect(h.state.slots.length).toBe(0)
  })

  test('a card dropped near a slot snaps into it', () => {
    const h = hosted()
    h.setup('uno')
    const slot = h.state.slots.find((s) => s.label === 'Discard')!
    const target = snapTarget(h.state, slot.x + 14, slot.y - 10, new Set())
    expect(target).toEqual({ x: slot.x, y: slot.y })
  })

  test('scores go up, down, and back to zero', () => {
    const h = hosted(['A', 'B'])
    h.score('host', 3)
    h.score('host', -1)
    h.score('s2', 5)
    expect(h.state.scores['host']).toBe(2)
    expect(h.state.scores['s2']).toBe(5)
    h.clearScores()
    expect(h.state.scores).toEqual({})
  })

  test('scores survive a new game, because a night is more than one hand', () => {
    const h = hosted()
    h.score('host', 4)
    h.setup('hearts')
    expect(h.state.scores['host']).toBe(4)
  })
})

describe('chips', () => {
  test('a poker table buys everyone in; a hearts table does not', () => {
    const h = hosted(['A', 'B', 'C'])
    h.setup('holdem')
    expect(h.state.chipsOn).toBe(true)
    for (const s of h.state.seats) expect(h.state.chips[s.id]).toBe(2000)
    expect(h.state.pot).toBe(0)

    h.setup('hearts')
    expect(h.state.chipsOn).toBe(false)
    expect(h.state.pot).toBe(0)
  })

  test('betting moves chips out of your stack and into the pot', () => {
    const h = hosted(['A', 'B'])
    h.setup('holdem')
    h.bet('host', 150)
    h.bet('s2', 150)
    expect(h.state.chips['host']).toBe(1850)
    expect(h.state.chips['s2']).toBe(1850)
    expect(h.state.pot).toBe(300)
  })

  test('you cannot bet chips you do not have', () => {
    const h = hosted(['A', 'B'])
    h.setup('holdem')
    h.bet('host', 999999)
    expect(h.state.chips['host']).toBe(0) // all in, not negative
    expect(h.state.pot).toBe(2000)
  })

  test('taking the pot empties it into one stack', () => {
    const h = hosted(['A', 'B'])
    h.setup('holdem')
    h.bet('host', 100)
    h.bet('s2', 100)
    h.takePot('s2')
    expect(h.state.pot).toBe(0)
    expect(h.state.chips['s2']).toBe(2100)
    expect(h.state.chips['host']).toBe(1900)
  })

  test('chips are conserved across a whole hand', () => {
    const h = hosted(['A', 'B', 'C'])
    h.setup('holdem')
    const bank = () => h.state.seats.reduce((a, s) => a + (h.state.chips[s.id] ?? 0), 0) + h.state.pot
    expect(bank()).toBe(6000)
    h.bet('host', 300)
    h.bet('s2', 300)
    h.bet('s3', 125)
    expect(bank()).toBe(6000)
    h.takePot('s3')
    expect(bank()).toBe(6000)
  })

  test('a player can only bet their own chips', () => {
    expect(allowed({ t: 'bet', seat: 's2', amount: 50 }, 's2')).toBe(true)
    expect(allowed({ t: 'bet', seat: 'host', amount: 50 }, 's2')).toBe(false)
    // Anyone may take the pot; that is a table argument, not a permission.
    expect(allowed({ t: 'take_pot', seat: 's2' }, 's2')).toBe(true)
    // Correcting a stack is the host's job.
    expect(allowed({ t: 'chips_adjust', seat: 's2', by: 100 }, 's2')).toBe(false)
  })

  test('the discs drawn add up to the amount they stand for', () => {
    expect(chipDiscs(0)).toEqual([])
    expect(chipDiscs(5).length).toBe(1)
    expect(chipDiscs(30).length).toBe(2) // 25 + 5
    // A big stack is capped rather than drawn as a column of forty.
    expect(chipDiscs(100000).length).toBeLessThanOrEqual(7)
  })

  test('undo takes a bet back', () => {
    const h = hosted(['A', 'B'])
    h.setup('holdem')
    h.bet('host', 500)
    expect(h.state.pot).toBe(500)
    h.undo()
    expect(h.state.pot).toBe(0)
    expect(h.state.chips['host']).toBe(2000)
  })
})

describe('dealing a whole hand in one press', () => {
  test('poker deals two each and lays five face down in the middle', () => {
    const h = hosted(['A', 'B', 'C'])
    h.setup('holdem')
    h.dealHand()

    for (const s of h.state.seats) expect(h.handOf(s.id).length).toBe(2)

    // Five separate spots in the middle, so each can be turned on its own.
    const board = h.tableCards().filter((c) => Math.abs(c.y - 280) < 40 && !c.faceUp)
    const spots = new Set(board.map((c) => `${c.x},${c.y}`))
    expect(spots.size).toBeGreaterThanOrEqual(5)
    expect(h.tableCards().every((c) => !c.faceUp)).toBe(true)
    // Nothing is lost or duplicated.
    expect(Object.keys(h.state.cards).length).toBe(52)
  })

  test('dealing again cleans up the half-played table first', () => {
    const h = hosted(['A', 'B'])
    h.setup('holdem')
    h.dealHand()
    // Muddle the table: flip things, move things.
    const some = h.tableCards().slice(0, 6).map((c) => c.id)
    h['commit']([{ t: 'flip', ids: some, faceUp: true }])

    h.dealHand()
    for (const s of h.state.seats) expect(h.handOf(s.id).length).toBe(2)
    expect(h.tableCards().every((c) => !c.faceUp)).toBe(true)
    expect(Object.keys(h.state.cards).length).toBe(52)
  })

  test('games without a hand recipe do not offer one', () => {
    const h = hosted()
    h.setup('memory')
    expect(h.canDealHand).toBe(false)
    h.setup('holdem')
    expect(h.canDealHand).toBe(true)
  })

  test('a full deal does not touch the chips', () => {
    const h = hosted(['A', 'B'])
    h.setup('holdem')
    h.bet('host', 300)
    h.dealHand()
    expect(h.state.pot).toBe(300)
    expect(h.state.chips['host']).toBe(1700)
  })

  test('uno deals seven each in one press', () => {
    const h = hosted(['A', 'B', 'C'])
    h.setup('uno')
    h.dealHand()
    for (const s of h.state.seats) expect(h.handOf(s.id).length).toBe(7)
    expect(Object.keys(h.state.cards).length).toBe(108)
  })
})

describe('gathering and moving whole piles', () => {
  test('gather puts the deck back on its own marked spot', () => {
    const h = hosted(['A', 'B'])
    h.setup('holdem')
    const deckSlot = h.state.slots.find((s) => s.id === 'deck')!
    // Scatter some cards away from home first.
    const some = h.tableCards().slice(0, 5).map((c) => c.id)
    h['commit']([{ t: 'move', ids: some, x: 120, y: 90 }])

    h.gather()
    const piles = stacks(h.state)
    expect(piles.length).toBe(1)
    expect(piles[0]![0]!.x).toBe(deckSlot.x)
    expect(piles[0]![0]!.y).toBe(deckSlot.y)
    expect(piles[0]!.length).toBe(52)
  })

  test('a game with no deck spot still gathers to the middle', () => {
    const h = hosted()
    h.setup('memory')
    h.gather()
    const piles = stacks(h.state)
    expect(piles.length).toBe(1)
    expect(piles[0]![0]!.x).toBe(500)
  })

  test('moving a whole pile keeps it together and in order', () => {
    const h = hosted()
    h.setup('deck')
    const pile = h.tableCards()
    const ids = pile.map((c) => c.id)
    h['commit']([{ t: 'move', ids, x: 200, y: 150 }])

    const moved = stacks(h.state)
    expect(moved.length).toBe(1)
    expect(moved[0]!.length).toBe(52)
    expect(moved[0]!.map((c) => c.id)).toEqual(ids) // order survives the move
  })
})
