import { describe, expect, test } from 'bun:test'
import {
  TABLE_H,
  TABLE_W,
  inHand,
  onTable,
  project,
  type SeatId,
  type TableState,
} from '../src/table/model.ts'
import { PRESETS, presetById } from '../src/table/deck.ts'
import { Host, allowed } from '../src/net/host.ts'
import type { Wire } from '../src/net/peers.ts'

/**
 * Every game, played through.
 *
 * Not "does it set up" - that was already covered. This sits a table of two to
 * four people down at each game in turn and puts it through the whole arc:
 * deal, pick cards up, play them, turn them over, shuffle, bet, take the pot,
 * score, gather, deal again, undo. After every single step it checks the things
 * that must never stop being true.
 *
 * A card game that loses a card, shows somebody else's hand, or invents chips
 * is broken in a way no amount of clicking around would reliably catch.
 */

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

function sitDown(n: number) {
  const h = new Host(silent(), 'host', () => {})
  h.seatSelf('Mom')
  for (let i = 1; i < n; i++) h.addSeatForTest(`s${i + 1}`, `Player ${i + 1}`)
  return h
}

/** Which table sizes are worth trying, from what the picker promises. */
function sizes(players: string): number[] {
  if (players === 'any') return [2, 4]
  if (players.endsWith('+')) return [2, 4]
  const range = players.match(/^(\d+)-(\d+)$/)
  if (range) {
    const lo = Number(range[1])
    const hi = Number(range[2])
    // The largest table too: that is where a deal runs out of cards.
    return [...new Set([lo, Math.min(hi, lo + 2), hi])]
  }
  return [Number(players)]
}

// ---------------------------------------------------------------------------
// The things that must never stop being true
// ---------------------------------------------------------------------------

function noCardIsLost(s: TableState, expected: number, where: string) {
  const ids = Object.keys(s.cards)
  expect(ids.length, `${where}: card count`).toBe(expected)
  expect(new Set(ids).size, `${where}: duplicate card`).toBe(ids.length)

  const seats = new Set(s.seats.map((x) => x.id))
  for (const c of Object.values(s.cards)) {
    // Every card is on the table or in the hand of somebody who exists.
    if (c.hand !== null) expect(seats.has(c.hand), `${where}: card in a hand nobody owns`).toBe(true)
    expect(Number.isFinite(c.x) && Number.isFinite(c.y), `${where}: card at a nonsense spot`).toBe(true)
  }
  // Nothing is in two places: the table and every hand together are the deck.
  const loose = onTable(s).length
  const held = s.seats.reduce((n, seat) => n + inHand(s, seat.id).length, 0)
  expect(loose + held, `${where}: table plus hands is not the deck`).toBe(expected)
}

function nobodySeesAnybodyElsesHand(s: TableState, where: string) {
  for (const viewer of s.seats) {
    const view = project(s, viewer.id)
    for (const c of view.cards) {
      if (c.hand !== null && c.hand !== viewer.id) {
        expect(c.face, `${where}: ${viewer.id} can see ${c.hand}'s card`).toBeNull()
      }
      // A card face down on the table is a back to everybody, host included.
      if (c.hand === null && !c.faceUp) {
        expect(c.face, `${where}: a face-down card leaked its face`).toBeNull()
      }
    }
  }
}

function chipsAddUp(s: TableState, total: number, where: string) {
  if (!s.chipsOn) return
  const held = s.seats.reduce((n, seat) => n + (s.chips[seat.id] ?? 0), 0)
  expect(held + s.pot, `${where}: chips were invented or lost`).toBe(total)
}

function everythingIsOnTheTable(s: TableState, where: string) {
  for (const p of s.pucks) {
    expect(Number.isFinite(p.x) && Number.isFinite(p.y), `${where}: marker at a nonsense spot`).toBe(true)
  }
  for (const d of s.dice) {
    expect(d.value, `${where}: die below its range`).toBeGreaterThanOrEqual(d.letters ? 0 : 1)
    expect(d.value, `${where}: die above its range`).toBeLessThan(d.letters ? d.letters.length : 7)
  }
}

/** Everything, after every step. */
function check(h: Host, deck: number, chips: number, where: string) {
  noCardIsLost(h.state, deck, where)
  nobodySeesAnybodyElsesHand(h.state, where)
  chipsAddUp(h.state, chips, where)
  everythingIsOnTheTable(h.state, where)
}

// ---------------------------------------------------------------------------

describe('every game, played through', () => {
  for (const preset of PRESETS) {
    for (const n of sizes(preset.players)) {
      test(`${preset.name}, ${n} at the table`, () => {
        const h = sitDown(n)
        const seats: SeatId[] = h.state.seats.map((s) => s.id)
        expect(seats.length).toBe(n)

        h.setup(preset.id)
        const deck = Object.keys(h.state.cards).length
        const chips = preset.chips === undefined ? 0 : preset.chips * n
        const at = `${preset.id}/${n}`
        check(h, deck, chips, `${at} after setup`)

        // -- what the game promised to deal ---------------------------------
        const dealt = typeof preset.deal === 'function' ? preset.deal(n) : preset.deal
        if (dealt > 0 && deck > 0) {
          // What the game asks for, or an even share when there is not enough
          // to go round, which happens when a big table picks a small game.
          const room = Math.floor(deck / n)
          for (const seat of seats) {
            expect(inHand(h.state, seat).length, `${at}: deal size`).toBe(Math.min(dealt, room))
          }
        }
        if (dealt === -1 && deck > 0) {
          const each = seats.map((s) => inHand(h.state, s).length)
          // Dealt out evenly means nobody is more than one card better off.
          expect(Math.max(...each) - Math.min(...each), `${at}: uneven deal`).toBeLessThanOrEqual(1)
          expect(each.reduce((a, b) => a + b, 0), `${at}: not the whole deck`).toBe(deck)
        }

        // -- everybody plays a card, face down then face up -----------------
        for (const seat of seats) {
          const hand = inHand(h.state, seat)
          if (hand.length >= 2) {
            h.execAs({ t: 'play', ids: [hand[0]!.id], x: 200, y: 200, faceUp: false }, seat)
            h.execAs({ t: 'play', ids: [hand[1]!.id], x: 300, y: 300, faceUp: true }, seat)
          }
        }
        check(h, deck, chips, `${at} after playing`)

        // -- and picks one back up ------------------------------------------
        for (const seat of seats) {
          const top = onTable(h.state).filter((c) => c.faceUp)[0]
          if (top) h.execAs({ t: 'take', ids: [top.id], seat }, seat)
        }
        check(h, deck, chips, `${at} after picking back up`)

        // -- turning cards over ---------------------------------------------
        const some = onTable(h.state).slice(0, 3).map((c) => c.id)
        if (some.length) h.local({ t: 'flip', ids: some })
        check(h, deck, chips, `${at} after flipping`)

        // -- shuffling a pile -----------------------------------------------
        const biggest = h.sources()[0]
        if (biggest) {
          const pile = onTable(h.state).filter((c) => c.x === biggest.x && c.y === biggest.y)
          h.shuffleStack(pile.map((c) => c.id))
        }
        check(h, deck, chips, `${at} after shuffling`)

        // -- money ------------------------------------------------------------
        if (h.state.chipsOn) {
          for (const seat of seats) h.bet(seat, 50)
          expect(h.state.pot, `${at}: pot`).toBe(50 * n)
          check(h, deck, chips, `${at} after betting`)
          h.takePot(seats[0]!, 25)
          check(h, deck, chips, `${at} after taking part of the pot`)
          h.takePot(seats[0]!)
          expect(h.state.pot, `${at}: pot not cleared`).toBe(0)
          check(h, deck, chips, `${at} after taking the pot`)
        }

        // -- keeping score ----------------------------------------------------
        for (const seat of seats) h.score(seat, 1)
        expect(seats.every((s) => h.state.scores[s] === 1)).toBe(true)

        // -- dice and the clock ----------------------------------------------
        if (h.state.dice.length) {
          for (let i = 0; i < 5; i++) h.roll()
          everythingIsOnTheTable(h.state, `${at} after rolling`)
        }
        if (preset.clock) {
          h.startClock(preset.clock)
          expect(h.state.timer.endsAt).not.toBeNull()
          h.stopClock()
          expect(h.state.timer.endsAt).toBeNull()
        }

        // -- markers ----------------------------------------------------------
        const marks = h.state.pucks.length
        h.addPuck('T', 'Turn')
        expect(h.state.pucks.length).toBe(marks + 1)
        h.removePuck(h.state.pucks[h.state.pucks.length - 1]!.id)
        expect(h.state.pucks.length).toBe(marks)

        // -- one press deals a whole new hand ---------------------------------
        if (h.canDealHand) {
          h.dealHand()
          check(h, deck, chips, `${at} after a fresh hand`)
          const spec = preset.hand!
          const asked = typeof spec.each === 'function' ? spec.each(n) : spec.each
          const per = Math.min(asked, Math.floor(deck / n))
          for (const seat of seats) {
            expect(inHand(h.state, seat).length, `${at}: fresh hand size`).toBe(per)
          }
        }

        // -- gathering everything back up -------------------------------------
        if (deck > 0) {
          h.gather()
          check(h, deck, chips, `${at} after gathering`)
          expect(onTable(h.state).length, `${at}: gather left cards out`).toBe(deck)
          expect(onTable(h.state).every((c) => !c.faceUp), `${at}: gather left cards face up`).toBe(true)
          const spots = new Set(onTable(h.state).map((c) => `${c.x},${c.y}`))
          expect(spots.size, `${at}: gather made more than one pile`).toBe(1)
        }

        // -- dealing from the panel -------------------------------------------
        if (deck >= n * 2) {
          h.deal({ count: 2, seats, from: h.sources()[0], faceUp: false })
          check(h, deck, chips, `${at} after dealing two each`)
          for (const seat of seats) {
            expect(inHand(h.state, seat).length, `${at}: two each`).toBe(2)
          }
        }

        // -- and taking it all back -------------------------------------------
        h.undo()
        check(h, deck, chips, `${at} after undo`)

        // -- the table is still where it should be ----------------------------
        for (const c of Object.values(h.state.cards)) {
          if (c.hand !== null) continue
          expect(c.x, `${at}: card off the left`).toBeGreaterThan(-1)
          expect(c.x, `${at}: card off the right`).toBeLessThan(TABLE_W + 1)
          expect(c.y, `${at}: card off the top`).toBeGreaterThan(-1)
          expect(c.y, `${at}: card off the bottom`).toBeLessThan(TABLE_H + 1)
        }
      })
    }
  }
})

describe('a night of poker, hand after hand', () => {
  test('nothing leaks over ten hands', () => {
    const h = sitDown(4)
    h.setup('holdem')
    const deck = 52
    const seats = h.state.seats.map((s) => s.id)
    const chips = 2000 * 4

    for (let hand = 0; hand < 10; hand++) {
      h.dealHand()
      check(h, deck, chips, `hand ${hand} dealt`)
      for (const seat of seats) expect(inHand(h.state, seat).length).toBe(2)

      // Turn the board over one card at a time, as a hand actually goes.
      const board = onTable(h.state).filter((c) => !c.faceUp).slice(0, 5)
      for (const c of board) {
        h.local({ t: 'flip', ids: [c.id], faceUp: true })
        check(h, deck, chips, `hand ${hand} board`)
      }

      for (const seat of seats) h.bet(seat, 100)
      check(h, deck, chips, `hand ${hand} bet`)
      h.takePot(seats[hand % seats.length]!)
      check(h, deck, chips, `hand ${hand} pot taken`)
    }

    // Everybody still has chips somewhere, and the deck is still a deck.
    expect(Object.keys(h.state.cards).length).toBe(52)
    chipsAddUp(h.state, chips, 'end of the night')
  })
})

describe('a hand of a trick game, played to the end', () => {
  test('hearts: thirteen tricks and every card accounted for', () => {
    const h = sitDown(4)
    h.setup('hearts')
    const seats = h.state.seats.map((s) => s.id)
    for (const seat of seats) expect(inHand(h.state, seat).length).toBe(13)

    for (let trick = 0; trick < 13; trick++) {
      for (const seat of seats) {
        const card = inHand(h.state, seat)[0]!
        h.execAs({ t: 'play', ids: [card.id], x: TABLE_W / 2, y: TABLE_H / 2, faceUp: true }, seat)
      }
      check(h, 52, 0, `trick ${trick}`)
      // Whoever won it takes the four cards away.
      const middle = onTable(h.state).filter((c) => c.x === TABLE_W / 2 && c.y === TABLE_H / 2)
      expect(middle.length, `trick ${trick}: four to a trick`).toBe(4)
      h.execAs({ t: 'take', ids: middle.map((c) => c.id), seat: seats[trick % 4]! }, seats[trick % 4]!)
      h.score(seats[trick % 4]!, 1)
    }

    // Every hand is empty of the deal and every card has been won by somebody.
    const won = seats.reduce((n, s) => n + inHand(h.state, s).length, 0)
    expect(won).toBe(52)
    expect(onTable(h.state).length).toBe(0)
    expect(seats.reduce((n, s) => n + (h.state.scores[s] ?? 0), 0)).toBe(13)
  })
})

describe('a game with no cards in it', () => {
  test('chess: thirty two pieces, moved around, none lost', () => {
    const h = sitDown(2)
    h.setup('chess')
    expect(h.state.pucks.length).toBe(32)
    const board = h.state.slots.filter((s) => s.cell)
    for (const piece of h.state.pucks.slice(0, 16)) {
      const to = board[Math.floor(Math.random() * board.length)]!
      h.local({ t: 'puck', id: piece.id, x: to.x, y: to.y })
    }
    expect(h.state.pucks.length).toBe(32)
    everythingIsOnTheTable(h.state, 'chess')
  })

  test('chinese checkers: the marbles you put out stay put out', () => {
    const h = sitDown(3)
    h.setup('chinese-checkers')
    // Three playing means three points of the star, not all six.
    expect(h.state.pucks.length).toBe(30)
    const holes = h.state.slots
    for (const m of h.state.pucks.slice(0, 20)) {
      const to = holes[Math.floor(Math.random() * holes.length)]!
      h.local({ t: 'puck', id: m.id, x: to.x, y: to.y })
    }
    expect(h.state.pucks.length).toBe(30)
    expect(new Set(h.state.pucks.map((p) => p.id)).size).toBe(30)
  })

  test('yahtzee: a full turn of three rolls with dice kept back', () => {
    const h = sitDown(2)
    h.setup('yahtzee')
    h.roll()
    const keep = h.state.dice.slice(0, 2)
    for (const d of keep) h.local({ t: 'die_hold', id: d.id, held: true })
    const kept = keep.map((d) => h.state.dice.find((x) => x.id === d.id)!.value)
    h.roll()
    h.roll()
    keep.forEach((d, i) => {
      expect(h.state.dice.find((x) => x.id === d.id)!.value).toBe(kept[i]!)
    })
    expect(h.state.dice.length).toBe(5)
  })
})

describe('games that end when somebody runs out', () => {
  const emptyOut = (id: string, n: number) => {
    const h = sitDown(n)
    h.setup(id)
    const seats = h.state.seats.map((s) => s.id)
    const deck = Object.keys(h.state.cards).length

    // The first player puts their whole hand down, one card at a time.
    const winner = seats[0]!
    let put = 0
    while (inHand(h.state, winner).length) {
      const card = inHand(h.state, winner)[0]!
      h.execAs({ t: 'play', ids: [card.id], x: TABLE_W / 2, y: TABLE_H / 2, faceUp: false }, winner)
      put++
      check(h, deck, 0, `${id}: card ${put}`)
    }
    return { h, seats, deck, winner, put }
  }

  test('bluff: the whole deck is dealt, and a hand can be emptied', () => {
    const { h, seats, deck, winner } = emptyOut('bluff', 3)
    expect(inHand(h.state, winner).length).toBe(0)
    // Nothing was left in the middle at the deal, so what is out there now is
    // exactly what the winner put there.
    const held = seats.reduce((n, s) => n + inHand(h.state, s).length, 0)
    expect(held + onTable(h.state).length).toBe(deck)
  })

  test('old maid keeps the odd card, which is the whole game', () => {
    const h = sitDown(3)
    h.setup('old-maid')
    const deck = Object.keys(h.state.cards).length
    // Fifty one: a full deck less one queen, so somebody is stuck with her.
    expect(deck).toBe(51)
    expect(onTable(h.state).length, 'nothing may be left in the middle').toBe(0)
    const each = h.state.seats.map((s) => inHand(h.state, s.id).length)
    expect(each.reduce((a, b) => a + b, 0)).toBe(51)
    expect(Math.max(...each) - Math.min(...each)).toBeLessThanOrEqual(1)
  })

  test('every deal-the-lot game leaves nothing in the middle', () => {
    for (const preset of PRESETS.filter((p) => p.deal === -1)) {
      for (const n of [2, 3, 4, 5]) {
        const h = sitDown(n)
        h.setup(preset.id)
        const deck = Object.keys(h.state.cards).length
        if (!deck) continue
        expect(onTable(h.state).length, `${preset.id} at ${n}`).toBe(0)
        const each = h.state.seats.map((s) => inHand(h.state, s.id).length)
        expect(each.reduce((a, b) => a + b, 0), `${preset.id} at ${n}`).toBe(deck)
      }
    }
  })

  test('war: two players, half the deck each, played out card for card', () => {
    const h = sitDown(2)
    h.setup('war')
    const [a, b] = h.state.seats.map((s) => s.id) as [string, string]
    expect(inHand(h.state, a).length).toBe(26)
    expect(inHand(h.state, b).length).toBe(26)

    for (let round = 0; round < 26; round++) {
      const ca = inHand(h.state, a)[0]!
      const cb = inHand(h.state, b)[0]!
      h.execAs({ t: 'play', ids: [ca.id], x: 400, y: 360, faceUp: true }, a)
      h.execAs({ t: 'play', ids: [cb.id], x: 800, y: 360, faceUp: true }, b)
      // Winner of the round takes both.
      const both = [ca.id, cb.id]
      h.execAs({ t: 'take', ids: both, seat: round % 2 === 0 ? a : b }, round % 2 === 0 ? a : b)
      check(h, 52, 0, `war round ${round}`)
    }
    expect(onTable(h.state).length).toBe(0)
    expect(inHand(h.state, a).length + inHand(h.state, b).length).toBe(52)
  })
})

describe('what one player may not do to another', () => {
  test('you cannot reach into somebody else s hand', () => {
    const h = sitDown(3)
    h.setup('hearts')
    const [me, them] = h.state.seats.map((s) => s.id) as [string, string]
    const theirs = inHand(h.state, them)[0]!

    h.execAs({ t: 'take', ids: [theirs.id], seat: me }, me)
    expect(h.state.cards[theirs.id]!.hand, 'a card was taken out of a hand').toBe(them)

    h.execAs({ t: 'play', ids: [theirs.id], x: 100, y: 100, faceUp: true }, me)
    expect(h.state.cards[theirs.id]!.hand, 'a card was played out of a hand').toBe(them)

    h.execAs({ t: 'flip', ids: [theirs.id] }, me)
    expect(h.state.cards[theirs.id]!.hand).toBe(them)
    check(h, 52, 0, 'after trying to reach in')
  })

  test('you cannot spend somebody else s chips', () => {
    const h = sitDown(3)
    h.setup('holdem')
    const [me, them] = h.state.seats.map((s) => s.id) as [string, string]
    h.execAs({ t: 'bet', seat: them, amount: 500 }, me)
    expect(h.state.chips[them]).toBe(2000)
    expect(h.state.pot).toBe(0)
  })

  test('only the dealer sets the table, clears the log, or rolls', () => {
    const h = sitDown(3)
    h.setup('yahtzee')
    const guest = h.state.seats[1]!.id
    const before = h.state.dice.map((d) => d.value)
    h.execAs({ t: 'dice_roll', values: { y0: 6, y1: 6, y2: 6, y3: 6, y4: 6 } }, guest)
    expect(h.state.dice.map((d) => d.value)).toEqual(before)

    h.execAs({ t: 'log_clear' }, guest)
    expect(h.state.log.length).toBeGreaterThan(0)

    h.execAs({ t: 'chips_start', each: 999999, on: true }, guest)
    expect(h.state.chipsOn).toBe(false)
  })

  test('a card in your own hand is yours to play', () => {
    const h = sitDown(3)
    h.setup('hearts')
    const me = h.state.seats[1]!.id
    const mine = inHand(h.state, me)[0]!
    h.execAs({ t: 'play', ids: [mine.id], x: 100, y: 100, faceUp: true }, me)
    expect(h.state.cards[mine.id]!.hand).toBeNull()
    check(h, 52, 0, 'playing your own card')
  })
})

describe('a supply that has to last', () => {
  test('dominoes always leaves a boneyard to draw from', () => {
    for (const n of [2, 3, 4]) {
      const h = sitDown(n)
      h.setup('dominoes')
      const held = h.state.seats.reduce((t, s) => t + inHand(h.state, s.id).length, 0)
      expect(onTable(h.state).length, `dominoes at ${n}: no boneyard`).toBeGreaterThan(0)
      expect(held + onTable(h.state).length).toBe(28)
    }
  })

  test('bananagrams fits in the bag at every table size', () => {
    for (const n of [2, 4, 5, 6, 7, 8]) {
      const h = sitDown(n)
      h.setup('bananagrams')
      const each = h.state.seats.map((s) => inHand(h.state, s.id).length)
      expect(new Set(each).size, `bananagrams at ${n}: somebody shorted`).toBe(1)
      expect(each[0]!, `bananagrams at ${n}`).toBeGreaterThan(0)
      const held = each.reduce((a, b) => a + b, 0)
      expect(held, `bananagrams at ${n}: more tiles than the bag holds`).toBeLessThanOrEqual(144)
      expect(onTable(h.state).length).toBe(144 - held)
    }
  })

  test('no game ever deals more than it has', () => {
    for (const preset of PRESETS) {
      for (let n = 2; n <= 8; n++) {
        const h = sitDown(n)
        h.setup(preset.id)
        const deck = Object.keys(h.state.cards).length
        if (!deck) continue
        const each = h.state.seats.map((s) => inHand(h.state, s.id).length)
        // Nobody is dealt nothing while somebody else has a full hand.
        if (Math.max(...each) > 0) {
          expect(Math.min(...each), `${preset.id} at ${n}: somebody got none`).toBeGreaterThan(0)
        }
        expect(each.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(deck)
      }
    }
  })
})

describe('holding the table together over a bad connection', () => {
  /** A wire that records what was sent and lets a test drop messages. */
  function loopback() {
    const sent: { channel: string; data: unknown }[] = []
    let dropping = false
    const chan = (name: string) => ({
      send: (data: unknown) => {
        if (!dropping) sent.push({ channel: name, data })
      },
      on: () => {},
    })
    return {
      sent,
      drop: (on: boolean) => {
        dropping = on
      },
      wire: {
        hello: chan('hello'),
        action: chan('action'),
        snapshot: chan('snapshot'),
        drag: chan('drag'),
        cursor: chan('cursor'),
        ping: chan('ping'),
        resync: chan('resync'),
        chat: chan('chat'),
        onPeerJoin: () => {},
        onPeerLeave: () => {},
        peers: () => [],
        leave: () => {},
      } as unknown as Wire,
    }
  }

  test('every change moves the revision on', () => {
    const net = loopback()
    const h = new Host(net.wire, 'host', () => {})
    h.seatSelf('Mom')
    h.setup('holdem')
    h.local({ t: 'flip', ids: [Object.keys(h.state.cards)[0]!] })
    const pings = net.sent.filter((m) => m.channel === 'ping').map((m) => m.data as number)
    expect(pings.length).toBeGreaterThan(1)
    // Never the same number twice in a row, and never going backwards.
    for (let i = 1; i < pings.length; i++) expect(pings[i]!).toBeGreaterThan(pings[i - 1]!)
    h.close()
  })

  test('a snapshot carries the revision it belongs to', () => {
    const net = loopback()
    const h = new Host(net.wire, 'host', () => {})
    h.seatSelf('Mom')
    h.helloForTest('peer-1', 'Dad')
    h.setup('holdem')
    const snaps = net.sent.filter((m) => m.channel === 'snapshot').map((m) => m.data as { rev: number })
    expect(snaps.length).toBeGreaterThan(0)
    for (const s of snaps) expect(typeof s.rev).toBe('number')
    h.close()
  })

  test('asking for a resync sends the whole table back', () => {
    const net = loopback()
    const h = new Host(net.wire, 'host', () => {})
    h.seatSelf('Mom')
    h.helloForTest('peer-1', 'Dad')
    h.setup('holdem')
    net.sent.length = 0
    h.catchUp('peer-1')
    const snaps = net.sent.filter((m) => m.channel === 'snapshot')
    expect(snaps.length).toBe(1)
    const snap = snaps[0]!.data as { view: { cards: unknown[] }; rev: number }
    // The whole table, so it heals anything that went missing.
    expect(snap.view.cards.length).toBe(52)
    h.close()
  })

  test('a deal that never arrives is recoverable, because catching up is whole', () => {
    const net = loopback()
    const h = new Host(net.wire, 'host', () => {})
    h.seatSelf('Mom')
    h.helloForTest('peer-1', 'Dad')
    h.setup('holdem')

    // The connection drops exactly across the one-press deal, which is the
    // single biggest message the app ever sends and the one that went missing.
    net.drop(true)
    h.dealHand()
    net.drop(false)

    net.sent.length = 0
    h.catchUp('peer-1')
    const snap = net.sent[0]!.data as { view: { cards: { hand: string | null }[] } }
    const dealt = snap.view.cards.filter((c) => c.hand !== null).length
    expect(dealt).toBe(4)
    h.close()
  })

  test('a browser that comes back gets its own seat and its own cards', () => {
    const net = loopback()
    const h = new Host(net.wire, 'host', () => {})
    h.seatSelf('Dad')
    h.helloForTest('peer-1', 'Dad', '🦊', 'token-abc')
    h.setup('hearts')
    const seat = h.state.seats[1]!.id
    const hand = inHand(h.state, seat).map((c) => c.id)
    expect(hand.length).toBe(13)

    // They drop off and come back on a new connection, with the same browser.
    h.droppedForTest('peer-1')
    h.helloForTest('peer-2', 'Dad', '🦊', 'token-abc')

    expect(h.state.seats.length, 'a returning browser must not take a new seat').toBe(2)
    expect(inHand(h.state, seat).map((c) => c.id)).toEqual(hand)
    h.close()
  })

  test('a different browser calling itself Dad does not get Dad s seat', () => {
    const net = loopback()
    const h = new Host(net.wire, 'host', () => {})
    h.seatSelf('Mom')
    h.helloForTest('peer-1', 'Dad', '🦊', 'token-abc')
    h.setup('hearts')
    const dadSeat = h.state.seats[1]!.id
    h.droppedForTest('peer-1')

    h.helloForTest('peer-9', 'Dad', '🐻', 'token-someone-else')
    const theirs = h.state.seats.find((s) => s.id !== dadSeat && s.id !== 'host')
    expect(theirs, 'a stranger should get their own seat').toBeDefined()
    expect(theirs!.id).not.toBe(dadSeat)
    h.close()
  })
})

describe('who gets which seat back', () => {
  const table = () => {
    const h = new Host(
      {
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
      } as unknown as Wire,
      'host',
      () => {},
    )
    h.seatSelf('Mom')
    return h
  }

  test('a browser with no memory of itself may still claim its name', () => {
    const h = table()
    h.helloForTest('p1', 'Dad')
    h.setup('hearts')
    const seat = h.state.seats[1]!.id
    h.droppedForTest('p1')
    // No token: an older client, or one whose storage was wiped.
    h.helloForTest('p2', 'Dad')
    expect(h.state.seats.length).toBe(2)
    expect(h.state.seats[1]!.id).toBe(seat)
    h.close()
  })

  test('a browser that knows it is somebody else gets its own seat', () => {
    const h = table()
    h.helloForTest('p1', 'Dad', '🦊', 'dads-browser')
    h.setup('hearts')
    const dad = h.state.seats[1]!.id
    const hand = inHand(h.state, dad).map((c) => c.id)
    h.droppedForTest('p1')

    h.helloForTest('p9', 'Dad', '🐻', 'someone-elses-browser')
    expect(h.state.seats.length, 'the stranger needs a seat of their own').toBe(3)
    expect(inHand(h.state, dad).map((c) => c.id), 'Dad keeps his cards').toEqual(hand)
    expect(h.state.seats[2]!.name, 'and they are told apart').toBe('Dad 2')
    h.close()
  })

  test('and the real Dad still gets his seat when he comes back', () => {
    const h = table()
    h.helloForTest('p1', 'Dad', '🦊', 'dads-browser')
    h.setup('hearts')
    const dad = h.state.seats[1]!.id
    const hand = inHand(h.state, dad).map((c) => c.id)
    h.droppedForTest('p1')
    h.helloForTest('p9', 'Dad', '🐻', 'someone-elses-browser')

    h.helloForTest('p3', 'Dad', '🦊', 'dads-browser')
    expect(h.state.seats.length).toBe(3)
    expect(inHand(h.state, dad).map((c) => c.id)).toEqual(hand)
    h.close()
  })
})

describe('games played into the middle', () => {
  test('the games with a shared heap say so', () => {
    const shared = ['bluff', 'snap', 'big-two', 'old-maid', 'uno', 'crazy-eights']
    for (const id of shared) {
      const h = sitDown(3)
      h.setup(id)
      const target = h.state.slots.find((s) => s.play)
      expect(target, `${id} has nowhere shared to play`).toBeDefined()
    }
  })

  test('games played in front of you do not', () => {
    // A trick game wants to see whose card is whose, and dominoes and solitaire
    // are placed by hand.
    for (const id of ['hearts', 'holdem', 'dominoes', 'solitaire', 'spade-seven']) {
      const h = sitDown(3)
      h.setup(id)
      expect(h.state.slots.some((s) => s.play), `${id} should not have one`).toBe(false)
    }
  })

  test('there is never more than one place to play', () => {
    for (const preset of PRESETS) {
      const h = sitDown(3)
      h.setup(preset.id)
      const targets = h.state.slots.filter((s) => s.play)
      expect(targets.length, `${preset.id} has ${targets.length} places to play`).toBeLessThanOrEqual(1)
    }
  })
})

describe('chinese checkers puts out what is needed', () => {
  test('a point of the star per player, ten marbles each', () => {
    for (const [seats, points] of [[2, 2], [3, 3], [4, 4], [5, 5], [6, 6]] as const) {
      const h = sitDown(seats)
      h.setup('chinese-checkers')
      expect(h.state.pucks.length, `${seats} playing`).toBe(points * 10)
      const colours = new Set(h.state.pucks.map((p) => p.colour))
      expect(colours.size, `${seats} playing`).toBe(points)
      h.close()
    }
  })

  test('two players sit across the board from each other', () => {
    const h = sitDown(2)
    h.setup('chinese-checkers')
    const ys = h.state.pucks.map((p) => p.y)
    const top = ys.filter((y) => y < TABLE_H / 2).length
    const bottom = ys.filter((y) => y > TABLE_H / 2).length
    expect(top).toBe(10)
    expect(bottom).toBe(10)
    h.close()
  })

  test('every marble still starts in a hole', () => {
    for (const seats of [2, 3, 4, 6]) {
      const h = sitDown(seats)
      h.setup('chinese-checkers')
      const holes = new Set(h.state.slots.map((s) => `${s.x},${s.y}`))
      for (const m of h.state.pucks) expect(holes.has(`${m.x},${m.y}`)).toBe(true)
      h.close()
    }
  })
})

describe('the moves you make over and over', () => {
  test('trick games say they are trick games', () => {
    for (const id of ['hearts', 'spades', 'euchre', 'judgement', 'kot-pees']) {
      expect(presetById(id).trick, `${id}`).toBe(true)
    }
    for (const id of ['holdem', 'bluff', 'uno', 'solitaire']) {
      expect(presetById(id).trick, `${id} is not a trick game`).toBeUndefined()
    }
  })

  test('every game you draw from has somewhere marked to draw from', () => {
    for (const id of ['uno', 'crazy-eights', 'indian-rummy', 'gin', 'go-fish', 'dominoes', 'solitaire']) {
      const h = sitDown(3)
      h.setup(id)
      const marked = h.state.slots.find((s) => ['draw', 'deck', 'stock'].includes(s.id))
      expect(marked, `${id} has nowhere to draw from`).toBeDefined()
      // And there is actually something face down sitting on it.
      const there = onTable(h.state).filter((c) => c.x === marked!.x && c.y === marked!.y && !c.faceUp)
      expect(there.length, `${id}: nothing on the draw pile`).toBeGreaterThan(0)
      h.close()
    }
  })

  test('sevens lays out four rows, one per suit', () => {
    const h = sitDown(4)
    h.setup('spade-seven')
    expect(presetById('spade-seven').bySuit).toBe(true)
    for (const id of ['sp', 'he', 'di', 'cl']) {
      expect(h.state.slots.find((s) => s.id === id), `no ${id} row`).toBeDefined()
    }
    h.close()
  })

  test('poker has a turn marker anybody can shove about', () => {
    const h = sitDown(4)
    h.setup('holdem')
    const turn = h.state.pucks.find((p) => p.label === 'TRN')
    expect(turn).toBeDefined()
    expect(allowed({ t: 'puck', id: turn!.id, x: 10, y: 10 }, 's2')).toBe(true)
    h.close()
  })

  test('the deck no longer lists the same game twice', () => {
    const names = PRESETS.map((p) => p.name)
    expect(new Set(names).size, 'two entries share a name').toBe(names.length)
    // Spade Queen was Hearts with a different label on it.
    expect(names).toContain('Hearts')
    expect(names).toContain('Sevens')
    expect(names).not.toContain('Spade Queen')
    expect(names).not.toContain('Spade Seven')
  })
})

describe('saying the thing you have to say every turn', () => {
  test('bluff claims a rank, judgement announces a bid', () => {
    expect(presetById('bluff').claim).toBe('rank')
    expect(presetById('judgement').claim).toBe('bid')
    for (const id of ['holdem', 'hearts', 'uno']) {
      expect(presetById(id).claim, `${id}`).toBeUndefined()
    }
  })
})

describe('sevens builds out from the seven', () => {
  test('the ace is high, which is what the rules say', () => {
    const order = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A']
    expect(order.indexOf('A')).toBeGreaterThan(order.indexOf('K'))
    // Thirteen ranks, seven in the middle, six either side.
    expect(order.indexOf('7')).toBe(5)
    expect(order.length - 1 - order.indexOf('7')).toBe(7)
  })

  test('a row never wanders into the suit next door', () => {
    const h = sitDown(4)
    h.setup('spade-seven')
    const rows = h.state.slots.filter((s) => ['sp', 'he', 'di', 'cl'].includes(s.id))
    const gap = Math.min(...rows.slice(1).map((r, i) => Math.abs(r.x - rows[i]!.x)))
    // The furthest a card leans from its own row, at eight units a rank.
    expect(7 * 8 * 2).toBeLessThan(gap)
    h.close()
  })
})
