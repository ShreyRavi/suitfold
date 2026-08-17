/**
 * The table, held by something that is not a browser tab.
 *
 * This is the whole point of the Mac app. The rules, the shuffling and the
 * secrecy boundary are the same Host class the browser runs - there is one
 * implementation of the game and it lives in src/ - but it runs here instead,
 * in a process that does not close because somebody shut a tab, does not get
 * throttled for being in the background, and writes the table to disk.
 *
 * Everyone plays in a browser, including whoever started it. They just connect
 * to this rather than to each other.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { Host } from '../src/net/host.ts'
import { emptyTable, type TableState } from '../src/table/model.ts'
import type { Hello, PeerId, Wire } from '../src/net/peers.ts'

const PORT = Number(process.env.PORT ?? 8123)
/**
 * The front end, served by the same thing that holds the table.
 *
 * This is the fix for a whole class of bug rather than one instance of it. The
 * website updates every time it is deployed; this binary updates when somebody
 * downloads a new one. Left alone, a browser on today's build ends up talking
 * to a table from three months ago, and every field added in between is a
 * crash waiting to happen.
 *
 * So the app hands out the client it was built with. They cannot disagree,
 * because they are the same build. It also means a game works with the
 * internet unplugged, which is worth having on its own.
 */
const WEB = process.env.SUITFOLD_WEB ?? ''
const HOME = process.env.SUITFOLD_HOME ?? join(process.env.HOME ?? '.', 'Library/Application Support/suitfold')
/** A table nobody has come back to in a day is last week's game. */
const STALE = 24 * 60 * 60 * 1000

interface Client {
  id: PeerId
  send: (channel: string, data: unknown) => void
}

/** One table: the real Host, plus whoever is connected to it. */
class Table {
  host: Host
  clients = new Map<PeerId, Client>()
  private handlers: Record<string, ((data: never, from: PeerId) => void)[]> = {}
  private saveSoon: ReturnType<typeof setTimeout> | null = null

  constructor(readonly code: string) {
    const channel = (name: string) => ({
      send: (data: unknown, to?: PeerId | PeerId[]) => {
        const ids = to === undefined ? [...this.clients.keys()] : Array.isArray(to) ? to : [to]
        for (const id of ids) this.clients.get(id)?.send(name, data)
      },
      on: (fn: (data: never, from: PeerId) => void) => {
        ;(this.handlers[name] ??= []).push(fn)
      },
    })

    const wire = {
      hello: channel('hello'),
      action: channel('action'),
      snapshot: channel('snapshot'),
      drag: channel('drag'),
      cursor: channel('cursor'),
      command: channel('command'),
      ping: channel('ping'),
      resync: channel('resync'),
      chat: channel('chat'),
      onPeerJoin: (fn: (id: PeerId) => void) => {
        this.onJoin = fn
      },
      onPeerLeave: (fn: (id: PeerId) => void) => {
        this.onLeave = fn
      },
      peers: () => [...this.clients.keys()],
      leave: () => {},
    } as unknown as Wire

    // 'table' is a seat nobody sits in: the deck's own place. Every actual
    // player is a peer, the dealer included, which is what lets the dealer be
    // somebody who arrived rather than whoever happened to be holding state.
    this.host = new Host(wire, 'table', () => this.later())
    const back = this.load()
    if (back) this.host.restore(back)
  }

  onJoin: (id: PeerId) => void = () => {}
  onLeave: (id: PeerId) => void = () => {}

  deliver(channel: string, data: unknown, from: PeerId) {
    for (const fn of this.handlers[channel] ?? []) fn(data as never, from)
  }

  join(client: Client) {
    this.clients.set(client.id, client)
    this.onJoin(client.id)
  }

  part(id: PeerId) {
    this.clients.delete(id)
    this.onLeave(id)
    // Whoever deals next is the next person here, if the dealer walked out.
    if (this.host.dealer && !this.clients.size) this.host.dealer = null
  }

  // -- keeping it ----------------------------------------------------------

  private get file() {
    return join(HOME, 'tables', `${this.code}.json`)
  }

  private later() {
    if (this.saveSoon) return
    this.saveSoon = setTimeout(() => {
      this.saveSoon = null
      this.save()
    }, 400)
  }

  save() {
    try {
      mkdirSync(dirname(this.file), { recursive: true })
      writeFileSync(this.file, JSON.stringify({ at: Date.now(), state: this.host.state }))
    } catch {
      // A table that cannot be written is still a table worth playing.
    }
  }

  load(): TableState | null {
    try {
      if (!existsSync(this.file)) return null
      const kept = JSON.parse(readFileSync(this.file, 'utf8')) as { at: number; state: TableState }
      if (!kept?.state?.cards || Date.now() - kept.at > STALE) return null
      // Nobody is connected yet, whatever the file remembers.
      return { ...emptyTable(), ...kept.state, seats: kept.state.seats.map((s) => ({ ...s, connected: false })) }
    } catch {
      return null
    }
  }
}

const tables = new Map<string, Table>()
const tableFor = (code: string) => {
  let t = tables.get(code)
  if (!t) {
    t = new Table(code)
    tables.set(code, t)
  }
  return t
}

interface Seat {
  id: PeerId
  code: string
}

const server = Bun.serve<Seat, Record<string, never>>({
  port: PORT,
  hostname: '0.0.0.0',

  async fetch(req, srv) {
    const url = new URL(req.url)

    if (url.pathname === '/health') {
      return Response.json({
        ok: true,
        tables: [...tables.entries()].map(([code, t]) => ({
          code,
          players: t.clients.size,
          seats: t.host.state.seats.map((s) => ({ name: s.name, emoji: s.emoji, here: s.connected })),
          game: t.host.state.deckName,
        })),
      })
    }

    if (url.pathname === '/room') {
      const code = (url.searchParams.get('code') ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8)
      if (!code) return new Response('no code', { status: 400 })
      const id = crypto.randomUUID()
      if (srv.upgrade(req, { data: { id, code } })) return undefined
      return new Response('expected a websocket', { status: 426 })
    }

    // Anything else is the front end, if we are carrying one.
    if (WEB) {
      const wanted = url.pathname === '/' ? '/index.html' : url.pathname
      const file = Bun.file(join(WEB, wanted.replace(/\.\./g, '')))
      if (await file.exists()) return new Response(file)
      // A single page app: unknown paths are still the app.
      const index = Bun.file(join(WEB, 'index.html'))
      if (await index.exists()) return new Response(index)
    }

    return new Response('suitfold table', { status: 200 })
  },

  websocket: {
    perMessageDeflate: false,

    open(ws) {
      const table = tableFor(ws.data.code)
      table.join({
        id: ws.data.id,
        send: (channel, data) => {
          try {
            ws.send(JSON.stringify({ channel, data }))
          } catch {
            /* gone mid-send */
          }
        },
      })
    },

    message(ws, raw) {
      const table = tables.get(ws.data.code)
      if (!table) return
      try {
        const { channel, data } = JSON.parse(String(raw)) as { channel: string; data: unknown }
        if (channel) table.deliver(channel, data as Hello, ws.data.id)
      } catch {
        /* not ours */
      }
    },

    close(ws) {
      tables.get(ws.data.code)?.part(ws.data.id)
    },
  },
})

console.log(JSON.stringify({ ready: true, port: server.port }))
