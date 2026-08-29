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
/** Older than this and it is last week's game, not an interrupted one. */
const STALE = 6 * 60 * 60 * 1000

/**
 * Somebody connected to a table.
 *
 * This was never declared, so TypeScript quietly matched it against an
 * unrelated ambient type that happens to be called Client and happens to have
 * a send method. Nothing was checked here at all.
 */
interface Client {
  id: PeerId
  send(channel: string, data: unknown): void
}

/**
 * The front end, carried by the table itself.
 *
 * The page and the table are then always the same build, which matters because
 * a website updates every time it is deployed while this binary updates when
 * somebody downloads a new one. It also means the whole thing works with the
 * internet unplugged.
 */
const WEB = process.env.SUITFOLD_WEB ?? ''
const HOME = process.env.SUITFOLD_HOME ?? join(process.env.HOME ?? '.', 'Library/Application Support/suitfold')

/**
 * The house key.
 *
 * SUITFOLD_KEY holds the sha256 of a phrase, never the phrase, so the password
 * is not sitting in the binary in plain sight. It is still a shared family
 * secret rather than a security system: anybody who has it can play, and a
 * determined person with the binary and a word list could work a weak phrase
 * out. It is a lock on a garden gate, which is what was asked for.
 *
 * Unset means an open house, which is how the tests and a dev server run.
 */
const LOCK = (process.env.SUITFOLD_KEY ?? '').trim().toLowerCase()

async function sha(text: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Hand back a file as bytes with the type spelled out.
 *
 * Not `new Response(file)`: Bun sees an html BunFile and runs its own HTML
 * bundler over it, which inside a compiled binary cannot resolve the assets and
 * quietly serves a fallback page instead of the front end. Bytes and a header
 * are unambiguous.
 */
const TYPES: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  svg: 'image/svg+xml',
  png: 'image/png',
  json: 'application/json',
  woff2: 'font/woff2',
}

async function serve(file: Bun.BunFile) {
  const ext = (file.name ?? '').split('.').pop()?.toLowerCase() ?? ''
  return new Response(await file.arrayBuffer(), {
    headers: { 'content-type': TYPES[ext] ?? 'application/octet-stream' },
  })
}

async function lets(given: string | null) {
  if (!LOCK) return true
  if (!given) return false
  return (await sha(given)) === LOCK
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
      door: channel('door'),
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
    if (back) this.host.restore(back.state, back.tokens)
  }

  onJoin: (id: PeerId) => void = () => {}
  onLeave: (id: PeerId) => void = () => {}

  deliver(channel: string, data: unknown, from: PeerId) {
    for (const fn of this.handlers[channel] ?? []) fn(data as never, from)
  }

  join(client: Client, may = false) {
    this.clients.set(client.id, client)
    if (may) this.host.proved.add(client.id)
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
      writeFileSync(
        this.file,
        JSON.stringify({ at: Date.now(), state: this.host.state, tokens: this.host.tokens }),
      )
    } catch {
      // A table that cannot be written is still a table worth playing.
    }
  }

  load(): { state: TableState; tokens: Record<string, string> } | null {
    try {
      if (!existsSync(this.file)) return null
      const kept = JSON.parse(readFileSync(this.file, 'utf8')) as {
        at: number
        state: TableState
        tokens?: Record<string, string>
      }
      if (!kept?.state?.cards || Date.now() - kept.at > STALE) return null
      return {
        // Nobody is connected yet, whatever the file remembers.
        state: { ...emptyTable(), ...kept.state, seats: kept.state.seats.map((s) => ({ ...s, connected: false })) },
        // Written by an older build, before seats were kept with their owners.
        tokens: kept.tokens ?? {},
      }
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
  /** Whether this connection showed the phrase, and so may pick up the deck. */
  may: boolean
}

const server = Bun.serve<Seat>({
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
      // Not a 401. Anybody with the code may connect, because a guest follows
      // a link and has no phrase to give. The phrase decides one thing only:
      // whether this person may pick up the deck of a table nobody is holding.
      const may = await lets(url.searchParams.get('key'))
      const id = crypto.randomUUID()
      if (srv.upgrade(req, { data: { id, code, may } })) return undefined
      return new Response('expected a websocket', { status: 426 })
    }

    // The front end asks this before it bothers showing a password box.
    if (url.pathname === '/locked') return Response.json({ locked: !!LOCK })

    // And this to find out whether the phrase somebody typed is the phrase,
    // so a wrong one is turned away at the door rather than three screens in.
    if (url.pathname === '/check') {
      return Response.json({ ok: await lets(url.searchParams.get('key')) })
    }

    // Anything else is the front end, if we are carrying one.
    if (WEB) {
      const wanted = url.pathname === '/' ? '/index.html' : url.pathname
      const file = Bun.file(join(WEB, wanted.replace(/\.\./g, '')))
      if (await file.exists()) return await serve(file)
      // A single page app: unknown paths are still the app.
      const index = Bun.file(join(WEB, 'index.html'))
      if (await index.exists()) return await serve(index)
    }

    return new Response('suitfold table', { status: 200 })
  },

  websocket: {
    perMessageDeflate: false,

    open(ws) {
      const table = tableFor(ws.data.code)
      table.join({
        id: ws.data.id,
        send: (channel: string, data: unknown) => {
          try {
            ws.send(JSON.stringify({ channel, data }))
          } catch {
            /* gone mid-send */
          }
        },
      }, ws.data.may)
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
