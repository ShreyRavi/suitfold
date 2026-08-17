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
  LOG_MAX,
  ALL_FACES,
  FACES,
  CARD_W,
  CARD_H,
  CARD_GAP,
  mentions,
  seatPlaces,
  type TableState,
} from '../src/table/model.ts'
import { PRESETS, standard, uno } from '../src/table/deck.ts'
import { holes, marbles, starSlots } from '../src/table/star.ts'
import { bananaTiles, dominoPips, dominoTiles, letterOf, letterScore, scrabbleTiles } from '../src/table/tiles.ts'
import { chessBoard, chessPieces, scrabbleBoard, snakesBoard, snakesLines } from '../src/table/boards.ts'
import { hasRules, rulesFor } from '../src/table/rules.ts'
import { Host, allowed } from '../src/net/host.ts'
import type { Wire } from '../src/net/peers.ts'

const run = (s: TableState, ...as: Action[]) => as.reduce(apply, s)

const dealt = () =>
  run(emptyTable(), {
    t: 'reset',
    deckName: 'test',
    cards: standard(1).map((id) => ({ id, faceUp: false, x: TABLE_W / 2, y: TABLE_H / 2 })),
    slots: [],
    pucks: [],
    dice: [],
    lines: [],
    game: 'deck',
  })

describe('the table model', () => {
  test('a new deck arrives as one pile in the middle', () => {
    const s = dealt()
    expect(onTable(s).length).toBe(52)
    expect(stacks(s).length).toBe(1)
    expect(onTable(s).every((c) => c.x === TABLE_W / 2 && c.y === TABLE_H / 2)).toBe(true)
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
    const s = run(dealt(), { t: 'seat_add', id: 'a', name: 'A', colour: '#000', emoji: '🐺' }, { t: 'take', ids: ['AS'], seat: 'a' })
    expect(onTable(s).length).toBe(51)
    expect(inHand(s, 'a').map((c) => c.id)).toEqual(['AS'])
  })

  test('playing a card puts it back on the table where you say', () => {
    const s = run(
      dealt(),
      { t: 'seat_add', id: 'a', name: 'A', colour: '#000', emoji: '🐺' },
      { t: 'take', ids: ['AS'], seat: 'a' },
      { t: 'play', ids: ['AS'], x: 120, y: 90, faceUp: true },
    )
    expect(inHand(s, 'a').length).toBe(0)
    expect(s.cards['AS']).toMatchObject({ x: 120, y: 90, faceUp: true, hand: null })
  })

  test('a player leaving puts their cards back on the table, face down', () => {
    const s = run(
      dealt(),
      { t: 'seat_add', id: 'a', name: 'A', colour: '#000', emoji: '🐺' },
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
      { t: 'seat_add', id: 'a', name: 'A', colour: '#000', emoji: '🐺' },
      { t: 'seat_add', id: 'b', name: 'B', colour: '#111', emoji: '🐺' },
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
  cursor: { send: () => {}, on: () => {} },
  ping: { send: () => {}, on: () => {} },
  resync: { send: () => {}, on: () => {} },
  chat: { send: () => {}, on: () => {} },
  onPeerJoin: () => {},
  onPeerLeave: () => {},
  peers: () => [],
  leave: () => {},
})

function hosted(names = ['Mom', 'Dad', 'You']) {
  const h = new Host(silent(), 'host', () => {})
  h.seatSelf(names[0]!)
  names.slice(1).forEach((n, i) => h.state = apply(h.state, { t: 'seat_add', id: `s${i + 2}`, name: n, colour: '#000', emoji: '🐺' }))
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
    // The whole deck goes out, round by round. It used to divide and round
    // down, which left the remainder sitting in the middle.
    expect(dealtOut).toBe(52)
    expect(h.tableCards().length).toBe(0)
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
    expect(after.every((c) => c.x === before[0]!.x && c.y === before[0]!.y)).toBe(true)
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
    h.deal({ count: 5, seats: h.state.seats.map((s) => s.id), from: { x: TABLE_W / 2, y: TABLE_H / 2 } })
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
    h.turnUp({ x: TABLE_W / 2, y: TABLE_H / 2 })
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
    // No slot per player any more: every seat has its own marked space in
    // front of it, and the two used to sit on top of each other.
    expect(labels.filter((l) => l.startsWith('Player')).length).toBe(0)
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
    const boardSlot = h.state.slots.find((sl) => sl.id === 'board')!
    const board = h.tableCards().filter((c) => Math.abs(c.y - boardSlot.y) < 40 && !c.faceUp)
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
    expect(piles[0]![0]!.x).toBe(TABLE_W / 2)
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

// ---------------------------------------------------------------------------

describe('the log', () => {
  test('a bet says who, and how much', () => {
    const h = hosted()
    h.buyIn(500)
    h.bet('s2', 75)
    const last = h.state.log[h.state.log.length - 1]!
    expect(last.kind).toBe('chip')
    expect(last.seat).toBe('s2')
    expect(last.text).toBe('bet')
    expect(last.amount).toBe(75)
  })

  test('taking the pot reports what was actually in it', () => {
    const h = hosted()
    h.buyIn(500)
    h.bet('s2', 60)
    h.bet('s3', 40)
    h.takePot('s2')
    const last = h.state.log[h.state.log.length - 1]!
    expect(last.text).toBe('took the pot')
    expect(last.amount).toBe(100)
    expect(last.seat).toBe('s2')
  })

  test('a bet capped by the stack logs what was really put in', () => {
    const h = hosted()
    h.buyIn(50)
    h.bet('s2', 500)
    const last = h.state.log[h.state.log.length - 1]!
    expect(last.amount).toBe(50)
    expect(h.state.pot).toBe(50)
  })

  test('a deal is one line, not one line per card', () => {
    const h = hosted()
    const before = h.state.log.length
    h.setup('poker')
    expect(h.state.log.length).toBe(before + 1)
    expect(h.state.log[h.state.log.length - 1]!.text).toContain('Poker')
  })

  test('sitting down is credited to whoever sat, not to the host', () => {
    const h = new Host(silent(), 'host', () => {})
    h.seatSelf('Mom')
    const last = h.state.log[h.state.log.length - 1]!
    expect(last.text).toBe('sat down')
    expect(last.seat).toBe('host')
  })

  test('chat is a log line and moves nothing', () => {
    const h = hosted()
    h.setup('poker')
    const cards = JSON.stringify(h.state.cards)
    h.say('s2', '  is it my go?  ')
    const last = h.state.log[h.state.log.length - 1]!
    expect(last.kind).toBe('chat')
    expect(last.text).toBe('is it my go?')
    expect(last.seat).toBe('s2')
    expect(JSON.stringify(h.state.cards)).toBe(cards)
  })

  test('empty chat is not a line', () => {
    const h = hosted()
    const before = h.state.log.length
    h.say('s2', '   ')
    expect(h.state.log.length).toBe(before)
  })

  test('undo is itself recorded, and the log never rewinds', () => {
    const h = hosted()
    h.setup('poker')
    const n = h.state.logN
    h.undo()
    expect(h.state.logN).toBe(n + 1)
    expect(h.state.log[h.state.log.length - 1]!.text).toBe('took that back')
  })

  test('the log never names a card', () => {
    const h = hosted()
    h.setup('poker')
    h.dealHand()
    h.gather()
    const ids = Object.keys(h.state.cards)
    for (const line of h.state.log) {
      for (const id of ids) expect(line.text.includes(id)).toBe(false)
    }
  })

  test('it does not grow without limit', () => {
    const h = hosted()
    for (let i = 0; i < LOG_MAX + 40; i++) h.say('s2', `line ${i}`)
    expect(h.state.log.length).toBe(LOG_MAX)
    // The oldest are the ones dropped.
    expect(h.state.log[h.state.log.length - 1]!.text).toBe(`line ${LOG_MAX + 39}`)
  })

  test('every player is sent the log', () => {
    const h = hosted()
    h.buyIn(100)
    h.bet('s2', 10)
    const seen = project(h.state, 's3')
    expect(seen.log[seen.log.length - 1]!.text).toBe('bet')
  })
})

describe('the dealer button and the blinds', () => {
  test('poker puts three markers on the felt', () => {
    const h = hosted()
    h.setup('poker')
    // A turn marker as well, which is dumb on purpose: whoever is next drags
    // it to themselves.
    expect(h.state.pucks.map((p) => p.label)).toEqual(['D', 'SB', 'BB', 'TRN'])
  })

  test('a game without blinds has none', () => {
    const h = hosted()
    h.setup('indian-rummy')
    expect(h.state.pucks).toEqual([])
  })

  test('anyone may move one - it is a reminder, not a rule', () => {
    expect(allowed({ t: 'puck', id: 'pk-d', x: 10, y: 10 }, 's2')).toBe(true)
  })

  test('moving one moves only that one, and says which', () => {
    const h = hosted()
    h.setup('poker')
    const sb = h.state.pucks.find((p) => p.id === 'pk-sb')!
    h.local({ t: 'puck', id: 'pk-d', x: 400, y: 120 })
    const moved = h.state.pucks.find((p) => p.id === 'pk-d')!
    expect([moved.x, moved.y]).toEqual([400, 120])
    expect(h.state.pucks.find((p) => p.id === 'pk-sb')).toEqual(sb)
    expect(h.state.log[h.state.log.length - 1]!.text).toBe('moved the dealer button')
  })
})

describe('turning up late', () => {
  test('somebody who joins after the game started is bought in', () => {
    const h = hosted(['Mom'])
    h.setup('poker')
    expect(h.state.chips['host']).toBe(2000)
    h.addSeatForTest('s9', 'Latecomer')
    expect(h.state.chips['s9']).toBe(2000)
    expect(h.state.chipsOn).toBe(true)
  })

  test('and can then actually put something in the pot', () => {
    const h = hosted(['Mom'])
    h.setup('poker')
    h.addSeatForTest('s9', 'Latecomer')
    h.bet('s9', 300)
    expect(h.state.pot).toBe(300)
    expect(h.state.chips['s9']).toBe(1700)
  })

  test('a game without chips does not hand out any', () => {
    const h = hosted(['Mom'])
    h.setup('indian-rummy')
    h.addSeatForTest('s9', 'Latecomer')
    expect(h.state.chipsOn).toBe(false)
    expect(h.state.chips['s9']).toBeUndefined()
  })

  test('coming back to your own seat does not top you up', () => {
    const h = hosted(['Mom'])
    h.setup('poker')
    h.bet('host', 500)
    expect(h.state.chips['host']).toBe(1500)
    h.addSeatForTest('host', 'Mom')
    expect(h.state.chips['host']).toBe(1500)
  })
})

describe('reading the log back', () => {
  test('every line is stamped with a time', () => {
    // Before the host exists: seating itself writes a line, and on a slow
    // machine the clock ticks between the two.
    const before = Date.now()
    const h = hosted()
    h.buyIn(100)
    h.bet('s2', 10)
    const after = Date.now()
    for (const line of h.state.log) {
      expect(line.at).toBeGreaterThanOrEqual(before)
      expect(line.at).toBeLessThanOrEqual(after)
    }
  })

  test('times never run backwards', () => {
    const h = hosted()
    h.setup('poker')
    h.say('s2', 'hello')
    h.gather()
    const times = h.state.log.map((l) => l.at)
    expect(times).toEqual([...times].sort((a, b) => a - b))
  })

  test('shoving cards around is not worth a line', () => {
    const h = hosted()
    h.setup('poker')
    const before = h.state.log.length
    const card = h.tableCards()[0]!
    h.local({ t: 'move', ids: [card.id], x: 120, y: 120 })
    expect(h.state.log.length).toBe(before)
  })

  test('but turning one over still is', () => {
    const h = hosted()
    h.setup('poker')
    const card = h.tableCards()[0]!
    h.local({ t: 'flip', ids: [card.id] })
    expect(h.state.log[h.state.log.length - 1]!.text).toBe('turned a card over')
  })
})

describe('clearing the log', () => {
  test('the dealer can wipe it, and the wipe is the first new line', () => {
    const h = hosted()
    h.setup('poker')
    h.say('s2', 'hello')
    expect(h.state.log.length).toBeGreaterThan(1)
    h.clearLog()
    expect(h.state.log.map((l) => l.text)).toEqual(['cleared the log'])
  })

  test('nobody else can', () => {
    expect(allowed({ t: 'log_clear' }, 's2')).toBe(false)
  })

  test('the count keeps climbing, so cleared lines cannot come back as toasts', () => {
    const h = hosted()
    h.buyIn(100)
    h.bet('s2', 10)
    const n = h.state.logN
    h.clearLog()
    expect(h.state.logN).toBeGreaterThan(n)
    expect(h.state.log[0]!.n).toBeGreaterThan(n)
  })
})

describe('saying somebody’s name', () => {
  const seats = [
    { id: 'a', name: 'Dad', connected: true, colour: '#000', emoji: '🐺' },
    { id: 'b', name: 'Mum', connected: true, colour: '#111', emoji: '🐺' },
    { id: 'c', name: 'Dad 2', connected: true, colour: '#222', emoji: '🐺' },
  ]

  test('an @name finds that seat', () => {
    expect(mentions('@Mum are you in?', seats)).toEqual(['b'])
  })

  test('case does not matter', () => {
    expect(mentions('oi @mum', seats)).toEqual(['b'])
  })

  test('a name with a space in it still matches', () => {
    expect(mentions('@Dad 2 your go', seats)).toEqual(['a', 'c'])
  })

  test('a word that merely starts with a name does not match', () => {
    expect(mentions('@Mummy', seats)).toEqual([])
    expect(mentions('@Dadaist', seats)).toEqual([])
  })

  test('@all means everyone', () => {
    expect(mentions('@all last hand', seats)).toEqual(['a', 'b', 'c'])
  })

  test('a stray @ names nobody', () => {
    expect(mentions('email me @ home', seats)).toEqual([])
    expect(mentions('no names here', seats)).toEqual([])
  })

  test('the log carries who was named, and never yourself', () => {
    const h = hosted(['Mom', 'Dad', 'You'])
    h.say('s2', 'your go @Mom, not @Dad')
    const last = h.state.log[h.state.log.length - 1]!
    expect(last.to).toEqual(['host'])
  })

  test('a line naming nobody carries no list at all', () => {
    const h = hosted()
    h.say('s2', 'just talking')
    expect(h.state.log[h.state.log.length - 1]!.to).toBeUndefined()
  })
})

describe('splitting a pot', () => {
  const potted = () => {
    const h = hosted()
    h.buyIn(1000)
    h.bet('s2', 300)
    h.bet('s3', 300)
    return h
  }

  test('no amount still takes the lot', () => {
    const h = potted()
    h.takePot('s2')
    expect(h.state.pot).toBe(0)
    // 1000, less the 300 they put in, plus the whole 600 pot.
    expect(h.state.chips['s2']).toBe(1300)
  })

  test('an amount leaves the rest in the middle', () => {
    const h = potted()
    h.takePot('s2', 250)
    expect(h.state.pot).toBe(350)
    expect(h.state.chips['s2']).toBe(950)
    expect(h.state.log[h.state.log.length - 1]!.text).toBe('took part of the pot')
  })

  test('you cannot take more than is there', () => {
    const h = potted()
    h.takePot('s2', 5000)
    expect(h.state.pot).toBe(0)
    expect(h.state.chips['s2']).toBe(1300)
  })

  test('taking nothing does nothing', () => {
    const h = potted()
    const before = h.state.log.length
    h.takePot('s2', 0)
    expect(h.state.pot).toBe(600)
    expect(h.state.log.length).toBe(before)
  })

  test('two people can share one pot', () => {
    const h = potted()
    h.takePot('s2', 300)
    h.takePot('s3', 300)
    expect(h.state.pot).toBe(0)
    expect(h.state.chips['s2']).toBe(1000)
    expect(h.state.chips['s3']).toBe(1000)
  })
})

describe('markers for any game', () => {
  test('the dealer can put one on a game that has none', () => {
    const h = hosted()
    h.setup('indian-rummy')
    expect(h.state.pucks).toEqual([])
    h.addPuck('trn', 'Whose turn it is')
    expect(h.state.pucks.length).toBe(1)
    expect(h.state.pucks[0]!.label).toBe('TRN')
    expect(h.state.log[h.state.log.length - 1]!.text).toContain('TRN')
  })

  test('a blank one is not a marker', () => {
    const h = hosted()
    h.addPuck('   ', 'nothing')
    expect(h.state.pucks).toEqual([])
  })

  test('markers do not collide, even with the same label', () => {
    const h = hosted()
    h.addPuck('D', 'Dealer')
    h.addPuck('D', 'Dealer')
    expect(h.state.pucks.length).toBe(2)
    expect(new Set(h.state.pucks.map((p) => p.id)).size).toBe(2)
  })

  test('and can be taken away again', () => {
    const h = hosted()
    h.addPuck('D', 'Dealer button')
    h.removePuck(h.state.pucks[0]!.id)
    expect(h.state.pucks).toEqual([])
    expect(h.state.log[h.state.log.length - 1]!.text).toBe('took the dealer button away')
  })

  test('only the dealer may add or remove them', () => {
    expect(allowed({ t: 'puck_add', id: 'x', label: 'D', hint: 'D', x: 0, y: 0 }, 's2')).toBe(false)
    expect(allowed({ t: 'puck_remove', id: 'x' }, 's2')).toBe(false)
    // but anyone can shove one around
    expect(allowed({ t: 'puck', id: 'x', x: 1, y: 1 }, 's2')).toBe(true)
  })
})

describe('faces', () => {
  test('everybody gets a different one', () => {
    const h = hosted(['Mom'])
    for (let i = 0; i < 6; i++) h.addSeatForTest(`p${i}`, `Player ${i}`)
    const faces = h.state.seats.map((s) => s.emoji)
    expect(new Set(faces).size).toBe(faces.length)
  })

  test('you get the one you asked for if nobody has it', () => {
    const h = new Host(silent(), 'host', () => {})
    h.seatSelf('Mom', '🦊')
    expect(h.state.seats[0]!.emoji).toBe('🦊')
  })

  test('two people called Dad are two seats with two faces', () => {
    const h = new Host(silent(), 'host', () => {})
    h.seatSelf('Dad')
    h.addSeatForTest('s2', 'Dad')
    expect(h.state.seats.length).toBe(2)
    expect(h.state.seats[0]!.emoji).not.toBe(h.state.seats[1]!.emoji)
  })
})

describe('two people with the same name', () => {
  /** The hello repeats until acknowledged, so seating runs more than once. */
  const twice = () => {
    const h = new Host(silent(), 'host', () => {})
    h.seatSelf('Dad', '🐺')
    h.helloForTest('peer-1', 'Dad', '🐺')
    h.helloForTest('peer-1', 'Dad', '🐺')
    h.helloForTest('peer-1', 'Dad', '🐺')
    return h
  }

  test('the second one is renamed, and stays renamed', () => {
    const h = twice()
    expect(h.state.seats.map((s) => s.name)).toEqual(['Dad', 'Dad 2'])
  })

  test('and gets a different face, and keeps it', () => {
    const h = twice()
    expect(h.state.seats[0]!.emoji).toBe('🐺')
    expect(h.state.seats[1]!.emoji).not.toBe('🐺')
  })

  test('a repeated hello that changes nothing is not a new log line', () => {
    const h = twice()
    const before = h.state.log.length
    h.helloForTest('peer-1', 'Dad', '🐺')
    expect(h.state.log.length).toBe(before)
  })

  test('changing your name for real still works', () => {
    const h = twice()
    h.helloForTest('peer-1', 'Mum', '🦊')
    expect(h.state.seats[1]!.name).toBe('Mum')
    expect(h.state.seats[1]!.emoji).toBe('🦊')
  })

  test('one seat each, not one seat shared', () => {
    const h = twice()
    expect(h.state.seats.length).toBe(2)
  })
})

describe('where people sit', () => {
  const seatsOf = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      id: `s${i}`,
      name: `P${i}`,
      connected: true,
      colour: '#000',
      emoji: '🐺',
    }))

  test('whoever brought the deck sits at the bottom', () => {
    for (const n of [1, 2, 3, 4, 6]) {
      const first = seatPlaces(seatsOf(n))[0]!
      expect(Math.round(first.x)).toBe(TABLE_W / 2)
      expect(first.y).toBeGreaterThan(TABLE_H / 2)
    }
  })

  test('everybody gets their own place', () => {
    for (const n of [2, 3, 4, 5, 6, 8]) {
      const spots = seatPlaces(seatsOf(n)).map((p) => `${Math.round(p.x)},${Math.round(p.y)}`)
      expect(new Set(spots).size).toBe(n)
    }
  })

  test('the same seat is in the same place for everyone', () => {
    // No viewer is passed in, so there is nothing to rotate by. That is the
    // point: one frame of reference, the dealer's.
    const a = seatPlaces(seatsOf(4))
    const b = seatPlaces(seatsOf(4))
    expect(a.map((p) => p.drop)).toEqual(b.map((p) => p.drop))
  })

  test('the space in front of you is between you and the middle', () => {
    for (const p of seatPlaces(seatsOf(6))) {
      const toSeat = Math.hypot(p.x - TABLE_W / 2, p.y - TABLE_H / 2)
      const toDrop = Math.hypot(p.drop.x - TABLE_W / 2, p.drop.y - TABLE_H / 2)
      expect(toDrop).toBeLessThan(toSeat)
      expect(toDrop).toBeGreaterThan(0)
    }
  })

  test('and every one of them is on the table', () => {
    for (const n of [1, 2, 3, 4, 5, 6, 8]) {
      for (const p of seatPlaces(seatsOf(n))) {
        expect(p.drop.x).toBeGreaterThan(CARD_W / 2)
        expect(p.drop.x).toBeLessThan(TABLE_W - CARD_W / 2)
        expect(p.drop.y).toBeGreaterThan(CARD_H / 2)
        expect(p.drop.y).toBeLessThan(TABLE_H - CARD_H / 2)
      }
    }
  })

  test('nobody is asked to play their cards on top of the board', () => {
    const h = hosted(['Mom', 'Dad'])
    h.setup('poker')
    const board = h.state.slots.find((s) => s.id === 'board')!
    for (const p of seatPlaces(h.state.seats)) {
      const clear = Math.abs(p.drop.y - board.y) > CARD_H || Math.abs(p.drop.x - board.x) > CARD_GAP * 3
      expect(clear).toBe(true)
    }
  })
})

describe('the star board', () => {
  test('it is a six pointed star of a hundred and twenty one holes', () => {
    const board = holes()
    expect(board.length).toBe(121)
    expect(new Set(board.map((h) => `${h.row},${h.at}`)).size).toBe(121)
  })

  test('six points of ten, and sixty one holes in the middle', () => {
    const board = holes()
    for (let home = 0; home < 6; home++) {
      expect(board.filter((h) => h.home === home).length).toBe(10)
    }
    expect(board.filter((h) => h.home === null).length).toBe(61)
  })

  test('sixty marbles, one per point hole, six colours', () => {
    const ms = marbles()
    expect(ms.length).toBe(60)
    expect(new Set(ms.map((m) => m.colour)).size).toBe(6)
    expect(new Set(ms.map((m) => m.id)).size).toBe(60)
  })

  test('every marble starts in a hole', () => {
    const spots = new Set(starSlots().map((s) => `${s.x},${s.y}`))
    for (const m of marbles()) expect(spots.has(`${m.x},${m.y}`)).toBe(true)
  })

  test('the whole board fits on the table', () => {
    for (const h of holes()) {
      expect(h.x).toBeGreaterThan(20)
      expect(h.x).toBeLessThan(TABLE_W - 20)
      expect(h.y).toBeGreaterThan(20)
      expect(h.y).toBeLessThan(TABLE_H - 20)
    }
  })

  test('the rows interlock, as a triangular lattice does', () => {
    const board = holes()
    const rows = new Map<number, number[]>()
    for (const h of board) rows.set(h.row, [...(rows.get(h.row) ?? []), h.at])
    for (const [row, ats] of rows) {
      const next = rows.get(row + 1)
      if (!next) continue
      // Neighbouring rows sit half a step apart, so their parities differ.
      expect(Math.abs(ats[0]! % 2)).not.toBe(Math.abs(next[0]! % 2))
    }
  })

  test('setting it up puts no cards on the table', () => {
    const h = hosted()
    h.setup('chinese-checkers')
    expect(Object.keys(h.state.cards).length).toBe(0)
    // Three playing, so three points of the star are filled and three are not.
    expect(h.state.pucks.length).toBe(30)
    expect(h.state.slots.length).toBe(121)
    expect(h.state.slots.every((s) => s.dot)).toBe(true)
  })

  test('a marble is a marker like any other, so anyone can move one', () => {
    const h = hosted()
    h.setup('chinese-checkers')
    const marble = h.state.pucks[0]!
    expect(allowed({ t: 'puck', id: marble.id, x: 1, y: 1 }, 's2')).toBe(true)
  })
})

describe('nothing sits on top of anything else', () => {
  /** The toolbar floats over the bottom of the felt, roughly this deep. */
  const TOOLBAR_TOP = TABLE_H - 66

  test('nobody is seated underneath the toolbar', () => {
    const seatsOf = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ id: `s${i}`, name: `P${i}`, connected: true, colour: '#000', emoji: '🐺' }))
    for (const n of [1, 2, 3, 4, 5, 6]) {
      for (const p of seatPlaces(seatsOf(n))) expect(p.y).toBeLessThan(TOOLBAR_TOP)
    }
  })

  test('the star clears the seats at both ends', () => {
    const ys = holes().map((h) => h.y)
    const top = Math.min(...ys)
    const bottom = Math.max(...ys)
    const seat = TABLE_H / 2 + 275
    expect(bottom + 13).toBeLessThan(seat - 15)
    expect(top - 13).toBeGreaterThan(TABLE_H / 2 - 275 + 15)
  })
})

describe('every game in the picker', () => {
  test('sets a table without falling over', () => {
    for (const preset of PRESETS) {
      const h = hosted(['Mom', 'Dad', 'You'])
      h.setup(preset.id)
      expect(h.state.game).toBe(preset.id)
      expect(h.state.deckName).toBe(preset.name)
      // Something has to be on the felt, or the game is nothing at all.
      const stuff =
        Object.keys(h.state.cards).length + h.state.pucks.length + h.state.dice.length + h.state.slots.length
      expect(stuff).toBeGreaterThan(0)
    }
  })

  test('has rules written for it', () => {
    for (const preset of PRESETS) {
      if (preset.group === 'just cards') continue
      expect(hasRules(preset.id)).toBe(true)
      const r = rulesFor(preset.id)
      expect(r.goal.length).toBeGreaterThan(10)
      expect(r.play.length).toBeGreaterThan(1)
    }
  })

  test('deals only what it has', () => {
    for (const preset of PRESETS) {
      const h = hosted(['Mom', 'Dad', 'You'])
      h.setup(preset.id)
      const dealt = h.state.seats.reduce((n, s) => n + h.handOf(s.id).length, 0)
      expect(dealt).toBeLessThanOrEqual(Object.keys(h.state.cards).length)
    }
  })
})

describe('dice', () => {
  test('rolling lands inside the faces', () => {
    const h = hosted()
    h.setup('yahtzee')
    expect(h.state.dice.length).toBe(5)
    for (let i = 0; i < 40; i++) {
      h.roll()
      for (const d of h.state.dice) {
        expect(d.value).toBeGreaterThanOrEqual(1)
        expect(d.value).toBeLessThanOrEqual(6)
      }
    }
  })

  test('a die kept back does not change', () => {
    const h = hosted()
    h.setup('yahtzee')
    h.roll()
    const kept = h.state.dice[0]!
    h.local({ t: 'die_hold', id: kept.id, held: true })
    const was = h.state.dice[0]!.value
    for (let i = 0; i < 20; i++) h.roll()
    expect(h.state.dice[0]!.value).toBe(was)
  })

  test('lettered dice index their own letters', () => {
    const h = hosted()
    h.setup('boggle')
    expect(h.state.dice.length).toBe(16)
    for (let i = 0; i < 20; i++) {
      h.roll()
      for (const d of h.state.dice) {
        expect(d.letters).toBeDefined()
        expect(d.value).toBeGreaterThanOrEqual(0)
        expect(d.value).toBeLessThan(d.letters!.length)
      }
    }
  })

  test('nobody but the dealer may say what a die shows', () => {
    expect(allowed({ t: 'dice_roll', values: { d1: 6 } }, 's2')).toBe(false)
    expect(allowed({ t: 'timer', endsAt: 1, seconds: 60 }, 's2')).toBe(false)
    // but anyone can shove one across the table or keep it back
    expect(allowed({ t: 'die_move', id: 'd1', x: 1, y: 1 }, 's2')).toBe(true)
    expect(allowed({ t: 'die_hold', id: 'd1', held: true }, 's2')).toBe(true)
  })
})

describe('tiles and boards', () => {
  test('the scrabble bag is a hundred tiles', () => {
    expect(scrabbleTiles().length).toBe(100)
    expect(new Set(scrabbleTiles()).size).toBe(100)
    expect(scrabbleTiles().filter((t) => letterOf(t) === '_').length).toBe(2)
    expect(scrabbleTiles().filter((t) => letterOf(t) === 'E').length).toBe(12)
  })

  test('bananagrams is a hundred and forty four', () => {
    expect(bananaTiles().length).toBe(144)
    expect(new Set(bananaTiles()).size).toBe(144)
  })

  test('a double six set is twenty eight bones, each one once', () => {
    const set = dominoTiles()
    expect(set.length).toBe(28)
    expect(new Set(set).size).toBe(28)
    for (const d of set) {
      const [a, b] = dominoPips(d)
      expect(a).toBeLessThanOrEqual(b)
    }
  })

  test('the chess board is chequered, with a light square bottom right', () => {
    const board = chessBoard()
    expect(board.length).toBe(64)
    const h1 = board.find((s) => s.id === 'sq-h1')!
    expect(h1.shade).toBeUndefined()
    expect(chessPieces().length).toBe(32)
  })

  test('the queen starts on her own colour', () => {
    const board = chessBoard()
    const d1 = board.find((s) => s.id === 'sq-d1')!
    const whiteQueen = chessPieces().find((p) => p.label === 'wQ')!
    expect(whiteQueen.x).toBe(d1.x)
    expect(whiteQueen.y).toBe(d1.y)
    // The white queen starts on d1, which is a light square. That is what
    // "queen on her own colour" means, and it is the usual way to get the
    // board the wrong way round.
    expect(d1.shade).toBeUndefined()
    const blackQueen = chessPieces().find((p) => p.label === 'bQ')!
    const d8 = board.find((s) => s.id === 'sq-d8')!
    expect(blackQueen.x).toBe(d8.x)
    expect(d8.shade).toBeDefined()
  })

  test('the snakes go down and the ladders go up', () => {
    for (const l of snakesLines()) {
      // One snake on the classic board runs along a single row, so down here
      // means never upward rather than always downward.
      if (l.wavy) expect(l.y2).toBeGreaterThanOrEqual(l.y1)
      else expect(l.y2).toBeLessThan(l.y1)
    }
    expect(snakesLines().filter((l) => l.wavy).length).toBe(10)
    expect(snakesLines().filter((l) => !l.wavy).length).toBe(9)
  })

  test('square one is bottom left and a hundred is top left', () => {
    const board = snakesBoard()
    const one = board.find((s) => s.id === 'sl-1')!
    const hundred = board.find((s) => s.id === 'sl-100')!
    expect(one.y).toBeGreaterThan(hundred.y)
    expect(Math.round(one.x)).toBe(Math.round(hundred.x))
  })

  test('scrabble has a star in the middle and eight triple words', () => {
    const board = scrabbleBoard().filter((s) => s.cell)
    expect(board.length).toBe(225)
    expect(board.filter((s) => s.note === 'TW').length).toBe(8)
    expect(board.find((s) => s.id === 'sc-7-7')!.note).toBe('★')
  })
})

describe('tiles carry what they are worth', () => {
  test('every scrabble tile parses to a letter and a score', () => {
    for (const id of scrabbleTiles()) {
      const letter = letterOf(id)
      const score = letterScore(id)
      expect(letter.length).toBe(1)
      expect(Number.isFinite(score)).toBe(true)
      expect(score).toBeGreaterThanOrEqual(0)
    }
  })

  test('the values are the real ones', () => {
    const of = (l: string) => letterScore(scrabbleTiles().find((t) => letterOf(t) === l)!)
    expect(of('A')).toBe(1)
    expect(of('Q')).toBe(10)
    expect(of('Z')).toBe(10)
    expect(of('J')).toBe(8)
    expect(of('K')).toBe(5)
    expect(of('_')).toBe(0)
  })

  test('bananagrams tiles have no score but still parse', () => {
    for (const id of bananaTiles()) {
      expect(letterScore(id)).toBe(0)
      expect(letterOf(id).length).toBe(1)
    }
  })
})

describe('solitaire', () => {
  test('seven columns of one to seven, and the rest on the stock', () => {
    const h = hosted(['Just me'])
    h.setup('solitaire')
    const cards = h.tableCards()
    expect(cards.length).toBe(52)

    const cols = h.state.slots.filter((s) => s.id.startsWith('t'))
    expect(cols.length).toBe(7)
    cols.forEach((col, i) => {
      const inCol = cards.filter((c) => c.x === col.x && c.y >= col.y && c.y <= col.y + 7 * 34)
      expect(inCol.length).toBe(i + 1)
    })
  })

  test('one card face up per column and nothing else', () => {
    const h = hosted(['Just me'])
    h.setup('solitaire')
    const up = h.tableCards().filter((c) => c.faceUp)
    expect(up.length).toBe(7)
    // The bottom of each column, which is the one you can actually play.
    for (const col of h.state.slots.filter((s) => s.id.startsWith('t'))) {
      const mine = h.tableCards().filter((c) => c.x === col.x)
      const lowest = Math.max(...mine.map((c) => c.y))
      expect(mine.find((c) => c.y === lowest)!.faceUp).toBe(true)
    }
  })

  test('the stock holds the twenty four that were not laid out', () => {
    const h = hosted(['Just me'])
    h.setup('solitaire')
    const stock = h.state.slots.find((s) => s.id === 'draw')!
    const onStock = h.tableCards().filter((c) => c.x === stock.x && c.y === stock.y)
    expect(onStock.length).toBe(52 - 28)
    expect(onStock.every((c) => !c.faceUp)).toBe(true)
  })

  test('it deals nothing into a hand, because there is nobody to deal to', () => {
    const h = hosted(['Just me'])
    h.setup('solitaire')
    expect(h.handOf('host').length).toBe(0)
  })

  test('four foundations, one per suit', () => {
    const h = hosted(['Just me'])
    h.setup('solitaire')
    const labels = h.state.slots.map((s) => s.label)
    for (const suit of ['Spades', 'Hearts', 'Diamonds', 'Clubs']) expect(labels).toContain(suit)
  })
})

describe('faces you can pick', () => {
  test('there are no duplicates', () => {
    expect(new Set(ALL_FACES).size).toBe(ALL_FACES.length)
  })

  test('none of them are joined together, which is what breaks on old devices', () => {
    for (const f of ALL_FACES) {
      expect(f.includes('‍')).toBe(false)
      // No skin tone modifiers either.
      expect(/[\u{1F3FB}-\u{1F3FF}]/u.test(f)).toBe(false)
    }
  })

  test('the short list is the front of the long one', () => {
    expect(ALL_FACES.slice(0, FACES.length)).toEqual([...FACES])
  })
})
