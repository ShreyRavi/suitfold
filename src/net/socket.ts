import type { Action, SeatId } from '../table/model.ts'
import type { Cursor, Door, Drag, Hello, PeerId, Snapshot, Wire } from './peers.ts'
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
export function connectTo(url: string, roomCode: string, key = ''): Wire {
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
    // The phrase, if this browser has one. It does not decide whether you may
    // connect - a guest follows a link and has none. It decides one thing: may
    // this person pick up the deck of a table nobody is holding.
    const where =
      `${url.replace(/\/$/, '').replace(/^http/, 'ws')}/room?code=${encodeURIComponent(roomCode)}` +
      (key ? `&key=${encodeURIComponent(key)}` : '')
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
    door: channel<Door>('door'),
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
  // A server on the link wins. It is remembered only once it has answered, so
  // that a wrong address in a forwarded link is forgotten rather than kept.
  const asked = new URLSearchParams(location.search).get('server')
  if (asked) {
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
/**
 * Where a table is being held, when it is not this browser holding it.
 *
 * Deliberately not "suitfold.table": the crash net in keep.ts already owns
 * that key and stores an entire serialised table under it. The two collided,
 * so once anybody had played a hand this returned a JSON blob rather than an
 * address, joining failed, and invite links had the whole table pasted into
 * them.
 */
const HELD_AT = 'suitfold.held-at'

export function heldElsewhere(): string {
  const asked = new URLSearchParams(location.search).get('table')
  if (asked) {
    localStorage.setItem(HELD_AT, asked)
    return asked
  }
  return localStorage.getItem(HELD_AT) ?? ''
}

export const forgetTable = () => localStorage.removeItem(HELD_AT)

/**
 * The link you send people. It has to carry the server, or whoever opens it
 * quietly talks peer to peer instead and never finds the table.
 */
export function inviteLink(code: string): string {
  const held = heldElsewhere()
  const server = tableServer()
  const base = `${location.origin}${location.pathname}`
  const bits: string[] = []
  if (held) bits.push(`table=${encodeURIComponent(held)}`)
  else if (server) bits.push(`server=${encodeURIComponent(server)}`)
  // No phrase on the link. It is a way in to one table, not a key to the
  // site: whoever gets it can knock, and cannot start a table of their own.
  return `${base}${bits.length ? `?${bits.join('&')}` : ''}#${code}`
}

/** Internal now: nothing in the app offers to set one. */
const rememberServer = (url: string) => {
  if (url) localStorage.setItem('suitfold.server', url)
  else localStorage.removeItem('suitfold.server')
}

/** A seat id for somebody the server is holding the table for. */
export type ServerSeat = SeatId

/**
 * Where the table lives, once, having actually asked.
 *
 * A configured server is a hope, not a fact. It can be down, moved, or on a
 * network this laptop is not on, and a table that will not open because a box
 * somewhere is off is worse than no server at all. So we knock on it first,
 * and if nobody answers we play the way we always did: peer to peer, the deck
 * in whoever's tab started it.
 *
 * Asked once per page load and remembered, because every table opened in this
 * tab should agree about where it is.
 */
let asking: Promise<string> | null = null

export function whereTheTableIs(): Promise<string> {
  return (asking ??= (async () => {
    // Somewhere we were told about, or failing that, wherever this page came
    // from. That last one is the whole configuration story for anyone who runs
    // the server with the front end inside it: the page asks its own origin
    // whether there is a table server there, and there is.
    const told = heldElsewhere() || tableServer()
    const url = told || location.origin
    try {
      const res = await fetch(`${url.replace(/\/$/, '').replace(/^ws/, 'http')}/health`, {
        signal: AbortSignal.timeout(2500),
      })
      // Not just a 200. Static hosts answer plenty of things with a 200, and a
      // page that mistakes its own 404 for a table server never deals a card.
      const body = res.ok ? ((await res.json()) as { ok?: boolean; tables?: unknown }) : null
      if (body?.ok === true && Array.isArray(body.tables)) {
        // Remembered now that it has answered, so opening the app plainly next
        // time still finds the table.
        if (told) rememberServer(told)
        return url
      }
    } catch {
      /* down, moved, not on this network, or simply not a table server */
    }
    if (told) {
      console.warn('suitfold: no answer from', told, '- playing peer to peer instead')
      if (localStorage.getItem('suitfold.server') === told) rememberServer('')
    }
    return ''
  })())
}
