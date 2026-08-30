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

/**
 * The same door, with the deck on a server.
 *
 * Nobody is sitting in 'table', so there is no host in a tab to answer the
 * first knock. The phrase settles that one case and one case only: whoever
 * brings it may pick up a deck nobody is holding. Everybody after them knocks
 * at the door like anyone else, and it is the dealer who answers - over the
 * wire, since the list is not in their browser.
 */
const held = () => {
  const { wire, sent } = spy()
  const snaps: { to?: string; snap: { seat: string; knocking?: { peer: string }[] } }[] = []
  wire.snapshot.send = (data, to) => {
    snaps.push({ to: to as string, snap: data as { seat: string; knocking?: { peer: string }[] } })
  }
  const h = new Host(wire, 'table', () => {})
  return { h, sent, snaps }
}

describe('the door when the deck is on a server', () => {
  test('the phrase opens an empty table, and deals', () => {
    const { h } = held()
    h.proved.add('peer-1')
    h.helloForTest('peer-1', 'Mom')

    expect(h.knocking).toHaveLength(0)
    expect(h.dealer).toBe('s1')
    expect(h.state.seats.map((s) => s.name)).toEqual(['Mom'])
  })

  test('without the phrase there is nobody to let you in', () => {
    const { h, sent } = held()
    h.helloForTest('peer-1', 'Chancer')

    expect(h.state.seats).toHaveLength(0)
    expect(h.dealer).toBe(null)
    expect(sent.at(-1)?.data.state).toBe('waiting')
  })

  test('the second person knocks, and the dealer hears about it', () => {
    const { h, snaps } = held()
    h.proved.add('peer-1')
    h.helloForTest('peer-1', 'Mom')
    snaps.length = 0

    h.helloForTest('peer-2', 'Kid')

    expect(h.state.seats).toHaveLength(1)
    const toDealer = snaps.filter((s) => s.to === 'peer-1').at(-1)
    expect(toDealer?.snap.knocking?.map((k) => k.peer)).toEqual(['peer-2'])
  })

  test('the knock goes to the dealer and to nobody else', () => {
    const { h, snaps } = held()
    h.proved.add('peer-1')
    h.helloForTest('peer-1', 'Mom')
    h.command({ c: 'admit', peer: 'peer-2' }, 's1')
    h.helloForTest('peer-2', 'Kid')
    h.command({ c: 'admit', peer: 'peer-2' }, 's1')
    snaps.length = 0

    h.helloForTest('peer-3', 'Stranger')

    expect(snaps.filter((s) => s.to === 'peer-2').every((s) => !s.snap.knocking)).toBe(true)
  })

  test('the dealer opens the door from across the room', () => {
    const { h } = held()
    h.proved.add('peer-1')
    h.helloForTest('peer-1', 'Mom')
    h.helloForTest('peer-2', 'Kid')

    h.command({ c: 'admit', peer: 'peer-2' }, 's1')

    expect(h.knocking).toHaveLength(0)
    expect(h.state.seats.map((s) => s.name)).toEqual(['Mom', 'Kid'])
  })

  test('somebody who is not the dealer cannot open it', () => {
    const { h, sent } = held()
    h.proved.add('peer-1')
    h.helloForTest('peer-1', 'Mom')
    h.helloForTest('peer-2', 'Kid')
    h.command({ c: 'admit', peer: 'peer-2' }, 's1')
    h.helloForTest('peer-3', 'Stranger')

    h.command({ c: 'admit', peer: 'peer-3' }, 's2')

    expect(h.knocking.map((k) => k.peer)).toEqual(['peer-3'])
    expect(h.state.seats).toHaveLength(2)
    expect(sent.at(-1)?.data.state).toBe('waiting')
  })

  test('the dealer can turn somebody away from across the room', () => {
    const { h, sent } = held()
    h.proved.add('peer-1')
    h.helloForTest('peer-1', 'Mom')
    h.helloForTest('peer-2', 'Stranger')

    h.command({ c: 'refuse', peer: 'peer-2' }, 's1')

    expect(h.knocking).toHaveLength(0)
    expect(h.state.seats).toHaveLength(1)
    expect(sent.at(-1)).toEqual({ data: { state: 'refused' }, to: 'peer-2' })
  })
})

/**
 * A redeploy is a restart, and a restart must not lose people.
 *
 * The whole reason to put the table on a server is that it survives everybody
 * closing everything. If a returning browser is treated as a stranger, it gets
 * a fresh seat while its own one sits there disconnected with its cards still
 * in it, which is worse than not keeping the table at all.
 */
describe('coming back after the table server restarts', () => {
  const kept = () => {
    const { wire } = spy()
    const first = new Host(wire, 'table', () => {})
    first.proved.add('peer-1')
    first.helloForTest('peer-1', 'Mom', '🐯', 'tok-mom')
    first.joinForTest('peer-2', 'Kid', '🐺', 'tok-kid')
    return {
      state: JSON.parse(JSON.stringify(first.state)),
      tokens: JSON.parse(JSON.stringify(first.tokens)),
    }
  }

  const reopened = (saved: ReturnType<typeof kept>) => {
    const { wire, sent } = spy()
    const h = new Host(wire, 'table', () => {})
    h.restore(saved.state, saved.tokens)
    return { h, sent }
  }

  test('a player takes their own seat again, from a new connection', () => {
    const saved = kept()
    const { h } = reopened(saved)
    h.proved.add('peer-9')
    h.helloForTest('peer-9', 'Mom', '🐯', 'tok-mom')

    expect(h.state.seats.map((s) => s.name)).toEqual(['Mom', 'Kid'])
    expect(h.state.seats.find((s) => s.name === 'Mom')?.connected).toBe(true)
  })

  test('somebody who was let in before does not knock again', () => {
    const saved = kept()
    const { h, sent } = reopened(saved)
    h.helloForTest('peer-9', 'Kid', '🐺', 'tok-kid')

    expect(h.knocking).toHaveLength(0)
    expect(sent.filter((s) => s.data.state === 'waiting')).toHaveLength(0)
    expect(h.state.seats).toHaveLength(2)
  })

  test('a stranger with a made up token still knocks', () => {
    const saved = kept()
    const { h, sent } = reopened(saved)
    h.helloForTest('peer-9', 'Mom', '🐯', 'not-a-real-token')

    expect(h.state.seats).toHaveLength(2)
    expect(h.knocking.map((k) => k.peer)).toEqual(['peer-9'])
    expect(sent.at(-1)?.data.state).toBe('waiting')
  })

  test('a table written by an older build still opens', () => {
    const saved = kept()
    const { wire } = spy()
    const h = new Host(wire, 'table', () => {})
    h.restore(saved.state)

    expect(h.state.seats.map((s) => s.name)).toEqual(['Mom', 'Kid'])
  })
})

/**
 * A token is a credential, not a detail.
 *
 * It is how a browser proves it is the one that sat down, so somebody else
 * holding it can take that seat. The dealer needs to know who is at the door,
 * which is a name and a face, and has no business being handed the proof of
 * anybody's identity along with it.
 */
test('the door list sent to the dealer carries no tokens', () => {
  const { wire } = spy()
  const snaps: { knocking?: Record<string, unknown>[] }[] = []
  wire.snapshot.send = (data) => {
    snaps.push(data as { knocking?: Record<string, unknown>[] })
  }
  const h = new Host(wire, 'table', () => {})
  h.proved.add('peer-1')
  h.helloForTest('peer-1', 'Mom', '🐯', 'tok-mom')
  h.helloForTest('peer-2', 'Kid', '🐺', 'secret-token-of-the-kid')

  const lists = snaps.filter((s) => s.knocking?.length)
  expect(lists.length).toBeGreaterThan(0)
  for (const s of lists) {
    for (const k of s.knocking!) {
      expect(Object.keys(k).sort()).toEqual(['at', 'emoji', 'name', 'peer'])
      expect(JSON.stringify(k)).not.toContain('secret-token-of-the-kid')
    }
  }
  // The host still knows, because it is the host.
  expect(h.knocking[0]?.token).toBe('secret-token-of-the-kid')
})
