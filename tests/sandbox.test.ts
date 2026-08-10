import { describe, expect, test } from 'bun:test'
import { HostTable } from '../src/net/table.ts'
import type { Wire } from '../src/net/peers.ts'
import { project } from '../src/core/project.ts'
import type { SandboxLayout } from '../src/core/types.ts'

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

/**
 * Sandbox is the module that constrains nothing. It exists so the family can
 * play Go Fish on night one, and so the table layer has a second consumer with
 * the opposite posture to poker — which is what makes "adding games is easy"
 * a tested claim rather than an aspiration.
 */

function sandbox(layout: SandboxLayout = 'deal-7', names = ['Mom', 'Dad', 'You']) {
  const t = new HostTable(silentWire(), 'seat1', () => {})
  t.changeSettings({ mode: 'sandbox', layout, counters: false })
  t.seatSelf(names[0]!)
  names.slice(1).forEach((n, i) => t.addSeatForTest(`seat${i + 2}`, n))
  t.openTable()
  return t
}

describe('sandbox', () => {
  test('deals the preset and leaves the rest in the deck', () => {
    const room = sandbox('deal-7')
    const seats = room.state.table.seats
    for (const s of seats) {
      expect((room.state.table.cards[`hand:${s.id}`] ?? []).length).toBe(7)
    }
    expect((room.state.table.cards['deck'] ?? []).length).toBe(52 - 7 * seats.length)
    expect(room.state.table.turn).toBeNull() // no turn order in sandbox
    room.stop()
  })

  test('every layout preset builds a table that is not broken', () => {
    for (const layout of ['deck-only', 'deal-5', 'deal-7', 'deal-13', 'trick', 'everything'] as const) {
      const room = sandbox(layout)
      const zones = Object.values(room.state.table.zones)
      expect(zones.some((z) => z.kind === 'deck')).toBe(true)
      expect(zones.filter((z) => z.kind === 'hand').length).toBe(3)
      // Every card is in exactly one zone.
      const seen = new Set<string>()
      for (const list of Object.values(room.state.table.cards)) {
        for (const c of list) {
          expect(seen.has(c), `${c} is in two zones`).toBe(false)
          seen.add(c)
        }
      }
      expect(seen.size).toBe(52)
      room.stop()
    }
  })

  test('a player can move a card from their own hand', () => {
    const room = sandbox('deal-7')
    const me = room.state.table.seats[0]!.id
    const card = room.state.table.cards[`hand:${me}`]![0]!
    const r = room.execForTest(
      { c: 'move', seatId: me, cardIds: [card], from: `hand:${me}`, to: 'discard' },
      me,
      false,
    )
    expect(r.ok).toBe(true)
    expect(room.state.table.cards['discard']).toContain(card)
    expect(room.state.table.cards[`hand:${me}`]).not.toContain(card)
    // It landed in a public zone, so it is face up for everyone now.
    expect(room.state.table.faceUp[card]).toBe(true)
    room.stop()
  })

  test('you cannot move a card out of a hand you cannot see', () => {
    const room = sandbox('deal-7')
    const me = room.state.table.seats[0]!.id
    const them = room.state.table.seats[1]!.id
    const theirCard = room.state.table.cards[`hand:${them}`]![0]!
    const r = room.execForTest(
      { c: 'move', seatId: me, cardIds: [theirCard], from: `hand:${them}`, to: 'discard' },
      me,
      false,
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('zone-not-visible')
    room.stop()
  })

  test('you cannot move a card out of the face-down deck', () => {
    const room = sandbox('deal-7')
    const me = room.state.table.seats[0]!.id
    const top = room.state.table.cards['deck']![0]!
    const r = room.execForTest({ c: 'move', seatId: me, cardIds: [top], from: 'deck', to: 'discard' }, me, false)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('zone-not-visible')
    room.stop()
  })

  test('projections never carry another hand', () => {
    const room = sandbox('deal-13')
    for (const seat of room.state.table.seats) {
      const view = project(room.state, seat.id)
      const mine = view.zones.find((z) => z.owner === seat.id)!
      expect(mine.cards.every((c) => c.id)).toBe(true)
      for (const z of view.zones) {
        if (z.id === mine.id) continue
        if (z.kind === 'hand' || z.kind === 'deck') {
          expect(z.cards.some((c) => c.id)).toBe(false)
        }
      }
    }
    room.stop()
  })

  test('the host can deal, gather and reshuffle', () => {
    const room = sandbox('deck-only')
    const host = room.state.table.seats[0]!.id
    expect(room.execForTest({ c: 'deal', seatId: host, from: 'deck', count: 3, faceUp: false }, host, true).ok).toBe(
      true,
    )
    for (const s of room.state.table.seats) {
      expect((room.state.table.cards[`hand:${s.id}`] ?? []).length).toBe(3)
    }
    expect(room.execForTest({ c: 'gather', seatId: host, to: 'deck' }, host, true).ok).toBe(true)
    expect((room.state.table.cards['deck'] ?? []).length).toBe(52)

    const before = (room.state.table.cards['deck'] ?? []).join(',')
    expect(room.execForTest({ c: 'shuffle', seatId: host, zoneId: 'deck' }, host, true).ok).toBe(true)
    expect((room.state.table.cards['deck'] ?? []).join(',')).not.toBe(before)
    room.stop()
  })

  test('a player cannot deal or gather', () => {
    const room = sandbox()
    const me = room.state.table.seats[0]!.id
    expect(room.execForTest({ c: 'deal', seatId: me, from: 'deck', count: 1, faceUp: false }, me, false).ok).toBe(
      false,
    )
    expect(room.execForTest({ c: 'gather', seatId: me, to: 'deck' }, me, false).ok).toBe(false)
    room.stop()
  })

  test('switching a room from poker to sandbox and back keeps the ledger', () => {
    const room = sandbox('deal-7')
    room.changeSettings({ mode: 'poker', counters: true, startingStack: 500 })
    room.openTable()
    expect(room.state.poker.phase).toBe('preflop')
    // Poker rebuilt the zones; nothing from the sandbox layout is left over.
    const zones = Object.values(room.state.table.zones)
    expect(zones.some((z) => z.id === 'board')).toBe(true)
    const seen = new Set<string>()
    for (const list of Object.values(room.state.table.cards)) for (const c of list) seen.add(c)
    expect(seen.size).toBe(52)
    room.stop()
  })
})
