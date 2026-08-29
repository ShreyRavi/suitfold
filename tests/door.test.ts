import { describe, expect, test } from 'bun:test'
import { Host } from '../src/net/host.ts'
import type { Door, Wire } from '../src/net/peers.ts'

/**
 * The door: a person rather than a secret.
 *
 * Knowing the code gets you as far as knocking. Nothing else follows from it -
 * no seat, no snapshots, no cards - until somebody at the table says yes.
 */
const spy = () => {
  const sent: { data: Door; to?: string }[] = []
  const wire: Wire = {
    hello: { send: () => {}, on: () => {} },
    action: { send: () => {}, on: () => {} },
    snapshot: { send: () => {}, on: () => {} },
    drag: { send: () => {}, on: () => {} },
    cursor: { send: () => {}, on: () => {} },
    command: { send: () => {}, on: () => {} },
    ping: { send: () => {}, on: () => {} },
    resync: { send: () => {}, on: () => {} },
    chat: { send: () => {}, on: () => {} },
    door: {
      send: (data, to) => sent.push({ data, to: to as string }),
      on: () => {},
    },
    onPeerJoin: () => {},
    onPeerLeave: () => {},
    peers: () => [],
    leave: () => {},
  }
  return { wire, sent }
}

const table = () => {
  const { wire, sent } = spy()
  const h = new Host(wire, 'host', () => {})
  h.seatSelf('Mom')
  return { h, sent }
}

describe('somebody knocks', () => {
  test('a stranger waits rather than sitting down', () => {
    const { h, sent } = table()
    h.helloForTest('peer-1', 'Stranger', '🦊')
    expect(h.knocking.map((k) => k.name)).toEqual(['Stranger'])
    // The table is untouched: one seat, the host's own.
    expect(h.state.seats.length).toBe(1)
    expect(sent.at(-1)?.data.state).toBe('waiting')
  })

  test('knocking twice is still one person at the door', () => {
    const { h } = table()
    h.helloForTest('peer-1', 'Stranger', '🦊')
    h.helloForTest('peer-1', 'Stranger', '🦊')
    h.helloForTest('peer-1', 'Stranger', '🦊')
    expect(h.knocking.length).toBe(1)
  })

  test('letting them in seats them', () => {
    const { h } = table()
    h.helloForTest('peer-1', 'Dad', '🐺')
    h.admit('peer-1')
    expect(h.knocking).toEqual([])
    expect(h.state.seats.map((s) => s.name)).toEqual(['Mom', 'Dad'])
  })

  test('turning them away tells them so, and seats nobody', () => {
    const { h, sent } = table()
    h.helloForTest('peer-1', 'Stranger', '🦊')
    h.refuse('peer-1')
    expect(h.knocking).toEqual([])
    expect(h.state.seats.length).toBe(1)
    expect(sent.at(-1)?.data.state).toBe('refused')
  })

  test('somebody who wanders off stops being at the door', () => {
    const { h } = table()
    h.helloForTest('peer-1', 'Stranger', '🦊')
    h.droppedForTest('peer-1')
    expect(h.knocking).toEqual([])
  })

  test('two at once are two separate decisions', () => {
    const { h } = table()
    h.helloForTest('peer-1', 'Dad', '🐺')
    h.helloForTest('peer-2', 'Mum', '🦉')
    expect(h.knocking.length).toBe(2)
    h.admit('peer-1')
    expect(h.knocking.map((k) => k.name)).toEqual(['Mum'])
    expect(h.state.seats.map((s) => s.name)).toEqual(['Mom', 'Dad'])
  })
})

describe('coming back is not knocking again', () => {
  test('a reconnect after being let in goes straight to its seat', () => {
    const { h } = table()
    h.helloForTest('peer-1', 'Dad', '🐺')
    h.admit('peer-1')
    expect(h.state.seats.length).toBe(2)

    // Their phone slept and the connection went. They come back.
    h.droppedForTest('peer-1')
    h.helloForTest('peer-1', 'Dad', '🐺')

    // No second knock, and no second seat.
    expect(h.knocking).toEqual([])
    expect(h.state.seats.length).toBe(2)
  })

  test('somebody turned away has to ask again', () => {
    const { h } = table()
    h.helloForTest('peer-1', 'Stranger', '🦊')
    h.refuse('peer-1')
    h.helloForTest('peer-1', 'Stranger', '🦊')
    expect(h.knocking.length).toBe(1)
    expect(h.state.seats.length).toBe(1)
  })
})

describe('waiting gives nothing away', () => {
  test('nobody at the door is dealt anything', () => {
    const { h } = table()
    h.setup('holdem')
    h.helloForTest('peer-1', 'Stranger', '🦊')
    h.dealHand()
    // Two cards each for the seats that exist, and the stranger has no seat.
    expect(h.state.seats.length).toBe(1)
    expect(h.handOf('host').length).toBe(2)
    for (const k of h.knocking) {
      expect(h.state.seats.some((s) => s.name === k.name)).toBe(false)
    }
  })
})
