/**
 * suitfold's optional table server.
 *
 * Entirely optional: the app needs no server at all. Browsers find each other
 * over public relays and talk directly, and whoever started the table holds it.
 * That is lovely right up until somebody's wifi hiccups, a phone sleeps, or a
 * public relay decides it has heard enough from you today.
 *
 * This is the other way to run it. Every browser opens one WebSocket to a box
 * you own and this forwards between them. What it buys:
 *
 *   - Messages arrive, in order. No WebRTC, no NAT, no public relay.
 *   - Reconnecting is a second, not a renegotiation.
 *   - Anything said while a socket was down is said again when it comes back.
 *
 * What it deliberately does NOT do is hold the table. The deck still lives in
 * whoever started it, so the rules and the secrecy boundary have exactly one
 * implementation, in one place, shared by both ways of running. This is a wire,
 * not a referee: it forwards sealed messages and never looks inside one, so it
 * cannot see anybody's cards even though it is your own machine.
 */

const PORT = Number(process.env.PORT ?? 8787)
/** A room nobody has come back to is not a room. */
const EMPTY_FOR = 30 * 60 * 1000

interface Seat {
  id: string
  room: string
}

interface Client {
  id: string
  send: (line: string) => void
}

interface Room {
  clients: Map<string, Client>
  emptyAt: number | null
}

const rooms = new Map<string, Room>()

const roomFor = (code: string): Room => {
  let room = rooms.get(code)
  if (!room) {
    room = { clients: new Map(), emptyAt: null }
    rooms.set(code, room)
  }
  return room
}

/** Tell everyone in a room something, optionally skipping one of them. */
function shout(room: Room, line: string, except?: string) {
  for (const [id, client] of room.clients) {
    if (id === except) continue
    client.send(line)
  }
}

setInterval(() => {
  for (const [code, room] of rooms) {
    if (room.emptyAt && Date.now() - room.emptyAt > EMPTY_FOR) rooms.delete(code)
  }
}, 60_000)

const server = Bun.serve<Seat>({
  port: PORT,

  fetch(req, srv) {
    const url = new URL(req.url)

    // Coolify, and anything else keeping an eye on it, wants a pulse.
    if (url.pathname === '/health') {
      return Response.json({
        ok: true,
        rooms: rooms.size,
        players: [...rooms.values()].reduce((n, r) => n + r.clients.size, 0),
      })
    }

    if (url.pathname === '/room') {
      const code = (url.searchParams.get('code') ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8)
      if (!code) return new Response('no code', { status: 400 })
      const id = crypto.randomUUID()
      if (srv.upgrade(req, { data: { id, room: code } })) return undefined
      return new Response('expected a websocket', { status: 426 })
    }

    return new Response('suitfold table server', {
      status: 200,
      headers: { 'content-type': 'text/plain' },
    })
  },

  websocket: {
    // Messages are small and frequent; batching them adds lag you can feel
    // when somebody is dragging a card.
    perMessageDeflate: false,

    open(ws) {
      const room = roomFor(ws.data.room)
      room.emptyAt = null
      room.clients.set(ws.data.id, { id: ws.data.id, send: (line) => ws.send(line) })

      // Everybody already here hears about the newcomer, and the newcomer
      // hears about them, which is what the host uses to start talking.
      ws.send(JSON.stringify({ channel: '__you', data: ws.data.id }))
      for (const id of room.clients.keys()) {
        if (id !== ws.data.id) ws.send(JSON.stringify({ channel: '__join', data: id, from: id }))
      }
      shout(room, JSON.stringify({ channel: '__join', data: ws.data.id, from: ws.data.id }), ws.data.id)
    },

    message(ws, raw) {
      const room = rooms.get(ws.data.room)
      if (!room) return
      let msg: { channel?: string; data?: unknown; to?: string | string[] }
      try {
        msg = JSON.parse(String(raw))
      } catch {
        return
      }
      if (!msg.channel) return

      // Stamped with who it came from, so the far end knows, and never with
      // anything this server made up.
      const line = JSON.stringify({ channel: msg.channel, data: msg.data, from: ws.data.id })
      if (msg.to === undefined) {
        shout(room, line, ws.data.id)
      } else {
        for (const id of Array.isArray(msg.to) ? msg.to : [msg.to]) {
          room.clients.get(id)?.send(line)
        }
      }
    },

    close(ws) {
      const room = rooms.get(ws.data.room)
      if (!room) return
      room.clients.delete(ws.data.id)
      shout(room, JSON.stringify({ channel: '__leave', data: ws.data.id, from: ws.data.id }))
      if (!room.clients.size) room.emptyAt = Date.now()
    },
  },
})

console.log(`suitfold table server on :${server.port}`)
