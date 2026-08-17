import type { Action, SeatId } from '../table/model.ts'
import type { Cursor, Drag, Hello, PeerId, Snapshot, Wire } from './peers.ts'
import type { Command } from './dealer.ts'

/**
 * The same table, over one socket to a box you own.
 *
 * Everything else in the app talks to a Wire and does not care what is behind
 * it. Peer to peer is one implementation; this is the other. Messages arrive in
 * order and do not go missing, reconnecting is instant, and the table lives on
 * the server rather than in whoever's tab happened to start it.
 *
 * It reconnects on its own, backing off a little each time, because a laptop
 * lid closing for ten seconds should not end the game.
 */
export function connectTo(url: string, roomCode: string): Wire {
  const handlers: Record<string, ((data: never, from: PeerId) => void)[]> = {}
  let sock: WebSocket | null = null
  let shut = false
  let tries = 0
  /** Anything said while the socket was down, said again once it is back. */
  let backlog: string[] = []
  /** Who else is in the room, as the server tells us. */
  const others = new Set<PeerId>()
  let joined: (id: PeerId) => void = () => {}
  let parted: (id: PeerId) => void = () => {}

  const open = () => {
    if (shut) return
    const where = `${url.replace(/\/$/, '')}/room?code=${encodeURIComponent(roomCode)}`
    sock = new WebSocket(where)

    sock.onopen = () => {
      tries = 0
      const waiting = backlog
      backlog = []
      for (const line of waiting) sock?.send(line)
      // Whatever we missed while we were away.
      raise('reconnected', null, 'server')
    }

    sock.onmessage = (ev) => {
      try {
        const { channel, data, from } = JSON.parse(String(ev.data)) as {
          channel: string
          data: unknown
          from?: PeerId
        }
        if (channel === '__you') return
        if (channel === '__join') {
          const id = String(data)
          if (!others.has(id)) {
            others.add(id)
            joined(id)
          }
          return
        }
        if (channel === '__leave') {
          const id = String(data)
          others.delete(id)
          parted(id)
          return
        }
        raise(channel, data, from ?? 'server')
      } catch {
        /* not ours */
      }
    }

    sock.onclose = () => {
      if (shut) return
      // A second, then two, then four, up to ten. Quick enough not to notice,
      // slow enough not to hammer a box that is actually down.
      const wait = Math.min(1000 * 2 ** tries++, 10_000)
      setTimeout(open, wait)
    }

    sock.onerror = () => sock?.close()
  }

  const raise = (channel: string, data: unknown, from: PeerId) => {
    for (const fn of handlers[channel] ?? []) fn(data as never, from)
  }

  const say = (channel: string, data: unknown, to?: PeerId | PeerId[]) => {
    const line = JSON.stringify({ channel, data, ...(to === undefined ? {} : { to }) })
    if (sock?.readyState === WebSocket.OPEN) sock.send(line)
    // Pointer positions are worthless by the time a socket comes back.
    else if (channel !== 'drag' && channel !== 'cursor') backlog.push(line)
  }

  const channel = <T,>(name: string) => ({
    send: (data: T, to?: PeerId | PeerId[]) => say(name, data, to),
    on: (fn: (data: T, from: PeerId) => void) => {
      ;(handlers[name] ??= []).push(fn as never)
    },
  })

  open()

  return {
    hello: channel<Hello>('hello'),
    action: channel<Action>('action'),
    snapshot: channel<Snapshot>('snapshot'),
    drag: channel<Drag>('drag'),
    cursor: channel<Cursor>('cursor'),
    command: channel<Command>('command'),
    ping: channel<number>('ping'),
    resync: channel<number>('resync'),
    chat: channel<string>('chat'),
    onPeerJoin: (fn) => {
      joined = fn
      // A socket coming back is everybody arriving again as far as the host is
      // concerned, which is what makes it send them the table.
      ;(handlers['reconnected'] ??= []).push(((_: unknown) => {
        for (const id of others) fn(id)
      }) as never)
    },
    onPeerLeave: (fn) => {
      parted = fn
    },
    peers: () => [...others],
    leave: () => {
      shut = true
      sock?.close()
    },
  }
}

/**
 * Where the table server is, if there is one.
 *
 * Set VITE_TABLE_SERVER at build time to point everybody at your own box, or
 * add ?server=wss://... to the link to try one without rebuilding. Empty means
 * peer to peer, which is the default and needs nothing.
 */
export function tableServer(): string {
  // A server on the link wins, and is remembered, so that the next time this
  // browser opens the app plainly it still knows where the table is.
  const asked = new URLSearchParams(location.search).get('server')
  if (asked) {
    rememberServer(asked)
    return asked
  }
  const remembered = localStorage.getItem('suitfold.server')
  if (remembered) return remembered
  return (import.meta.env?.VITE_TABLE_SERVER as string | undefined) ?? ''
}

/**
 * A table being held somewhere that is not a browser - the Mac app, usually.
 *
 * Different from a relay: with a relay the deck still lives in whoever started
 * the game, and this browser runs the Host. With this, nobody's tab holds
 * anything. Close every window and the game is exactly where you left it.
 */
export function heldElsewhere(): string {
  const asked = new URLSearchParams(location.search).get('table')
  if (asked) {
    localStorage.setItem('suitfold.table', asked)
    return asked
  }
  return localStorage.getItem('suitfold.table') ?? ''
}

export const forgetTable = () => localStorage.removeItem('suitfold.table')

/**
 * The link you send people. It has to carry the server, or whoever opens it
 * quietly talks peer to peer instead and never finds the table.
 */
export function inviteLink(code: string): string {
  const held = heldElsewhere()
  const server = tableServer()
  const base = `${location.origin}${location.pathname}`
  const q = held
    ? `?table=${encodeURIComponent(held)}`
    : server
      ? `?server=${encodeURIComponent(server)}`
      : ''
  return `${base}${q}#${code}`
}

export const rememberServer = (url: string) => {
  if (url) localStorage.setItem('suitfold.server', url)
  else localStorage.removeItem('suitfold.server')
}

/** A seat id for somebody the server is holding the table for. */
export type ServerSeat = SeatId
