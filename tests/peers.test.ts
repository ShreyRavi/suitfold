import { describe, expect, test } from 'bun:test'
import type { Command } from '../src/core/types.ts'
import type { LogEntry } from '../src/core/narrate.ts'
import type { Hello, PeerId, Rejection, Snapshot, Wire } from '../src/net/peers.ts'
import { newRoomCode, normaliseCode } from '../src/net/peers.ts'
import { HostTable, authorize } from '../src/net/table.ts'
import { project } from '../src/core/project.ts'

/**
 * The peer table, driven through a fake wire. WebRTC itself is not testable
 * headlessly, but everything that matters — who gets seated, who may act, and
 * which cards each snapshot carries — lives above the transport.
 */

interface Sent {
  snapshots: { to: PeerId | PeerId[] | undefined; snap: Snapshot }[]
  logs: LogEntry[][]
  rejects: { to: PeerId | PeerId[] | undefined; r: Rejection }[]
}

function fakeWire() {
  const sent: Sent = { snapshots: [], logs: [], rejects: [] }
  const handlers: {
    hello?: (h: Hello, from: PeerId) => void
    command?: (c: Command, from: PeerId) => void
    leave?: (id: PeerId) => void
  } = {}

  const wire: Wire = {
    hello: { send: () => {}, on: (fn) => (handlers.hello = fn) },
    command: { send: () => {}, on: (fn) => (handlers.command = fn) },
    snapshot: { send: (snap, to) => sent.snapshots.push({ to, snap }), on: () => {} },
    log: { send: (entries) => sent.logs.push(entries), on: () => {} },
    reject: { send: (r, to) => sent.rejects.push({ to, r }), on: () => {} },
    onPeerJoin: () => {},
    onPeerLeave: (fn) => (handlers.leave = fn),
    peers: () => [],
    leave: () => {},
  }

  return {
    wire,
    sent,
    hello: (from: PeerId, name: string) => handlers.hello?.({ name }, from),
    command: (from: PeerId, c: Command) => handlers.command?.(c, from),
    leave: (from: PeerId) => handlers.leave?.(from),
  }
}

function table(names: string[] = ['Mom', 'Dad', 'You']) {
  const f = fakeWire()
  const t = new HostTable(f.wire, 'seat1', () => {})
  t.seatSelf(names[0]!)
  names.slice(1).forEach((n, i) => f.hello(`peer${i + 1}`, n))
  t.changeSettings({ mode: 'poker', smallBlind: 10, bigBlind: 20, startingStack: 1000 })
  return { t, f }
}

describe('room codes', () => {
  test('avoid characters that sound or look alike', () => {
    for (let i = 0; i < 200; i++) {
      const code = newRoomCode()
      expect(code).toHaveLength(6)
      expect(code).not.toMatch(/[IO01]/)
    }
  })

  test('normalise what someone types after hearing it out loud', () => {
    expect(normaliseCode('abc-234')).toBe('ABC234')
    expect(normaliseCode('  a b c 2 3 4  ')).toBe('ABC234')
    expect(normaliseCode('ABCDEFGH')).toBe('ABCDEF')
    // The ambiguous ones fold onto the letters the alphabet actually uses.
    expect(normaliseCode('I0O1')).toBe('JQQJ')
  })
})

describe('seating', () => {
  test('a hello gets you a seat, and the channel is your identity', () => {
    const { t } = table()
    expect(t.state.table.seats.map((s) => s.name)).toEqual(['Mom', 'Dad', 'You'])
    expect(t.state.table.seats.every((s) => s.connected)).toBe(true)
  })

  test('a second hello from the same peer renames rather than re-seats', () => {
    const { t, f } = table()
    f.hello('peer1', 'Daddy')
    expect(t.state.table.seats).toHaveLength(3)
    expect(t.state.table.seats[1]!.name).toBe('Daddy')
  })

  test('dropping does not empty the seat or touch the stack', () => {
    const { t, f } = table()
    t.openTable()
    const before = t.state.table.seats[1]!.stack
    f.leave('peer1')
    const seat = t.state.table.seats[1]!
    expect(seat.connected).toBe(false)
    expect(seat.away).toBe(false)
    expect(seat.stack).toBe(before)
  })

  test('someone who dropped reclaims their own seat by name', () => {
    const { t, f } = table()
    f.leave('peer1')
    f.hello('peer9', 'Dad')
    expect(t.state.table.seats).toHaveLength(3)
    expect(t.state.table.seats[1]!.connected).toBe(true)
  })

  test('a command from an unknown peer is ignored entirely', () => {
    const { t, f } = table()
    t.openTable()
    const turn = t.state.table.turn
    f.command('stranger', { c: 'poker_action', seatId: turn!, action: 'fold' })
    expect(t.state.table.turn).toBe(turn)
  })
})

describe('authorization', () => {
  test('a peer cannot act as a seat it does not hold', () => {
    const { t, f } = table()
    t.openTable()
    const turn = t.state.table.turn!
    // peer2 is seat3; it names the seat whose turn it is.
    f.command('peer2', { c: 'poker_action', seatId: turn, action: 'fold' })
    if (turn !== 'seat3') expect(t.state.table.turn).toBe(turn)
    expect(f.sent.rejects.length).toBeGreaterThan(0)
  })

  test('host-only commands are host-only', () => {
    expect(authorize({ c: 'restack', seatId: 'seat2', target: 'seat2', amount: 100 }, 'seat2', false)).toBe(
      false,
    )
    expect(authorize({ c: 'force_fold', seatId: 'seat2', target: 'seat3' }, 'seat2', false)).toBe(false)
    expect(authorize({ c: 'deal_hand', seatId: 'seat1' }, 'seat1', true)).toBe(true)
    expect(authorize({ c: 'poker_action', seatId: 'seat2', action: 'fold' }, 'seat2', false)).toBe(true)
    expect(authorize({ c: 'poker_action', seatId: 'seat3', action: 'fold' }, 'seat2', false)).toBe(false)
  })
})

describe('snapshots', () => {
  test('every snapshot carries only its own seat cards', () => {
    const { t } = table()
    t.openTable()
    for (const seat of t.state.table.seats) {
      const snap = t.snapshotFor(seat.id)
      const mine = snap.view.zones.find((z) => z.owner === seat.id && z.kind === 'hand')!
      expect(mine.cards.every((c) => c.id)).toBe(true)
      for (const z of snap.view.zones) {
        if (z.id === mine.id) continue
        if (z.kind === 'hand' || z.kind === 'deck') {
          expect(z.cards.some((c) => c.id), `${seat.id} saw a face in ${z.id}`).toBe(false)
        }
      }
    }
  })

  test('a spectator with no seat sees no hand at all', () => {
    const { t } = table()
    t.openTable()
    const view = project(t.state, null)
    for (const z of view.zones) {
      if (z.kind === 'hand' || z.kind === 'deck') {
        expect(z.cards.some((c) => c.id)).toBe(false)
      }
    }
  })

  test('players are sent a snapshot each, never a broadcast', () => {
    const { t, f } = table()
    f.sent.snapshots.length = 0
    t.openTable()
    // Each snapshot goes to exactly one peer, because it contains cards.
    expect(f.sent.snapshots.length).toBeGreaterThan(0)
    for (const s of f.sent.snapshots) expect(typeof s.to).toBe('string')
  })

  test('the log broadcast never contains a card id', () => {
    const { t, f } = table()
    t.openTable()
    const text = JSON.stringify(f.sent.logs)
    // Narration talks about people and chips, never "AS" or "TD".
    expect(text).not.toMatch(/"[2-9TJQKA][SHDC]"/)
  })
})

describe('playing through peers', () => {
  test('a hand runs to completion driven entirely by peer commands', () => {
    const { t, f } = table(['Mom', 'Dad', 'You'])
    t.openTable()
    const peerFor: Record<string, PeerId> = { seat2: 'peer1', seat3: 'peer2' }

    let guard = 0
    while (t.state.poker.phase !== 'complete' && t.state.table.turn && guard++ < 60) {
      const seatId = t.state.table.turn
      const legal = t.snapshotFor(seatId).view.poker.legal
      const action = legal.includes('check') ? 'check' : legal.includes('call') ? 'call' : 'fold'
      const cmd: Command = { c: 'poker_action', seatId, action }
      if (seatId === 'seat1') t.local(cmd)
      else f.command(peerFor[seatId]!, cmd)
    }

    expect(t.state.poker.phase).toBe('complete')
    const total = t.state.table.seats.reduce((a, s) => a + s.stack, 0)
    expect(total).toBe(3000) // chips conserved with no server anywhere
    t.stop()
  })
})
