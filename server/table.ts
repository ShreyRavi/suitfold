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
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
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

/**
 * Deliberately not the async WebCrypto one.
 *
 * The phrase arrives on the socket immediately before the hello that uses it.
 * An async check hands control back before it finishes, so the hello overtakes
 * it and the person who said the phrase is asked to knock at their own table.
 * Hashing here is a microsecond and it keeps the two messages in the order
 * they were sent.
 */
function sha(text: string) {
  return createHash('sha256').update(text).digest('hex')
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

function lets(given: string | null) {
  if (!LOCK) return true
  if (!given) return false
  return sha(given) === LOCK
}

/** One table: the real Host, plus whoever is connected to it. */
class Table {
  host: Host
  clients = new Map<PeerId, Client>()
  /** When somebody was last connected, so an abandoned table can be forgotten. */
  touched = Date.now()
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

  /** This connection said the phrase, so it may open a table nobody is at. */
  allow(id: PeerId) {
    this.host.proved.add(id)
  }

  join(client: Client, may = false) {
    this.touched = Date.now()
    this.clients.set(client.id, client)
    if (may) this.host.proved.add(client.id)
    this.onJoin(client.id)
  }

  part(id: PeerId) {
    this.touched = Date.now()
    this.clients.delete(id)
    this.onLeave(id)
    // Whoever deals next is the next person here, if the dealer walked out.
    if (this.host.dealer && !this.clients.size) this.host.dealer = null
  }

  /** Stop the heartbeat, so a forgotten table stops ticking. */
  close() {
    this.host.close()
    if (this.saveSoon) clearTimeout(this.saveSoon)
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

    /**
     * Enough to tell that this is a table server, and nothing more.
     *
     * It used to answer with every table's code and every player's name, to
     * anybody who asked. A code is not a nicety - it is the thing that gets you
     * as far as the door - so that was a public list of live tables, who is
     * sitting at them, and what to type to knock. Counts carry the operational
     * signal; the identities were never anybody else's business.
     */
    if (url.pathname === '/health') {
      return Response.json({
        ok: true,
        tables: [...tables.values()].map((t) => ({
          players: t.clients.size,
          seats: t.host.state.seats.length,
        })),
      })
    }

    if (url.pathname === '/room') {
      const code = (url.searchParams.get('code') ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8)
      if (!code) return new Response('no code', { status: 400 })
      // Not a 401. Anybody with the code may connect, because a guest follows a
      // link and has no phrase to give. The phrase arrives on the socket, not
      // in this URL, because a query string is written to the proxy's access
      // log and a phrase in a log file is a phrase you have given away.
      const id = crypto.randomUUID()
      if (srv.upgrade(req, { data: { id, code, may: false } })) return undefined
      return new Response('expected a websocket', { status: 426 })
    }

    // There was a /check here that said whether a phrase was the phrase, and a
    // /locked that said whether there was one. Nothing used either, and the
    // first was an unlimited guessing machine: the front end's six tries in
    // five minutes only ever governed the front end.

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
        if (!channel) return
        // The phrase, said on the socket rather than in the address. It never
        // reaches the Host: all it does is decide whether this connection may
        // pick up a deck nobody is holding.
        if (channel === 'prove') {
          if (lets(typeof data === 'string' ? data : null)) table.allow(ws.data.id)
          return
        }
        table.deliver(channel, data as Hello, ws.data.id)
      } catch {
        /* not ours */
      }
    },

    close(ws) {
      tables.get(ws.data.code)?.part(ws.data.id)
    },
  },
})

/**
 * Forget tables nobody came back to.
 *
 * A table that has not been touched in STALE will not load again anyway - the
 * file is already refused on the way in. Without this the refusal is the only
 * thing that ever happens to it: the JSON sits on the volume for good, and the
 * Table object sits in the Map for as long as the process lives. A family
 * playing twice a week would accumulate both forever.
 *
 * Anything with somebody connected is left alone however old it is, because a
 * long game is still a game.
 */
function sweep() {
  const now = Date.now()
  for (const [code, table] of tables) {
    if (table.clients.size) continue
    if (now - table.touched < STALE) continue
    table.close()
    tables.delete(code)
  }
  try {
    const dir = join(HOME, 'tables')
    if (!existsSync(dir)) return
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.json')) continue
      const file = join(dir, name)
      if (tables.has(name.slice(0, -5))) continue
      if (now - statSync(file).mtimeMs > STALE) unlinkSync(file)
    }
  } catch {
    // A volume that will not be tidied is not a reason to stop dealing.
  }
}

setInterval(sweep, 30 * 60 * 1000).unref?.()
sweep()

console.log(JSON.stringify({ ready: true, port: server.port }))
