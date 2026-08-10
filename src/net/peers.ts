import { joinRoom, selfId } from 'trystero/nostr'
import type { Command } from '../core/types.ts'
import type { LogEntry } from '../core/narrate.ts'
import type { RoomView } from '../core/project.ts'

/**
 * The transport. There is no server: peers find each other through public
 * relays and then talk directly to each other over WebRTC.
 *
 * The property that matters for suitfold is that a data channel IS an identity.
 * The host knows which channel a message arrived on, so a player cannot claim
 * to be someone else — which is the seat-authorization problem the server
 * version needed tokens and cookies to solve.
 */

export type PeerId = string
export const myPeerId = (): PeerId => selfId

export interface Hello {
  /** The name this peer wants to sit under. */
  name: string
}

export interface Snapshot {
  view: RoomView
  seq: number
  seatId: string | null
  /** Present once a hand is over and the reveal is on. */
  descriptions?: Record<string, string>
  /** Published before the hand so the deal can be checked afterwards. */
  deckCommitment?: string
}

export interface Rejection {
  reason: string
}

type Send<T> = (data: T, to?: PeerId | PeerId[]) => void
type Receive<T> = (fn: (data: T, from: PeerId) => void) => void

export interface Wire {
  /** Everyone announces themselves to the host. */
  hello: { send: Send<Hello>; on: Receive<Hello> }
  /** Players → host. */
  command: { send: Send<Command>; on: Receive<Command> }
  /** Host → one player. Per-seat, because it carries that seat's cards. */
  snapshot: { send: Send<Snapshot>; on: Receive<Snapshot> }
  /** Host → everyone. Narrated lines only; raw events never leave the host. */
  log: { send: Send<LogEntry[]>; on: Receive<LogEntry[]> }
  reject: { send: Send<Rejection>; on: Receive<Rejection> }

  onPeerJoin(fn: (id: PeerId) => void): void
  onPeerLeave(fn: (id: PeerId) => void): void
  peers(): PeerId[]
  leave(): void
}

/**
 * Trystero handles discovery and the WebRTC handshake. The `nostr` strategy
 * uses public relays purely as a meeting point — no account, nothing of ours
 * running anywhere, and no card ever passes through them.
 */
export function connect(roomCode: string): Wire {
  const room = joinRoom({ appId: 'suitfold-v1' }, roomCode)

  // Everything we send is plain JSON, which is what trystero's DataPayload
  // wants; the cast keeps our own precise types at the call sites.
  const channel = <T>(namespace: string) => {
    const action = room.makeAction(namespace)
    return {
      send: ((data, to) => {
        void action.send(data as never, to ? { target: to } : undefined)
      }) as Send<T>,
      on: ((fn) => {
        action.onMessage = (data, ctx) => fn(data as T, ctx.peerId)
      }) as Receive<T>,
    }
  }

  return {
    hello: channel<Hello>('hello'),
    command: channel<Command>('cmd'),
    snapshot: channel<Snapshot>('snap'),
    log: channel<LogEntry[]>('log'),
    reject: channel<Rejection>('nope'),
    onPeerJoin: (fn) => {
      room.onPeerJoin = fn
    },
    onPeerLeave: (fn) => {
      room.onPeerLeave = fn
    },
    peers: () => Object.keys(room.getPeers()),
    leave: () => void room.leave(),
  }
}

/**
 * Room codes get read aloud on a video call, so the alphabet drops the
 * characters that sound or look alike. Six fits on one line and is quick to
 * type on a phone.
 */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no I, O, 0, 1

export function newRoomCode(): string {
  const bytes = new Uint8Array(6)
  crypto.getRandomValues(bytes)
  return [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join('')
}

export const normaliseCode = (raw: string) =>
  raw
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .replace(/I/g, 'J')
    .replace(/O/g, 'Q')
    .replace(/0/g, 'Q')
    .replace(/1/g, 'J')
    .slice(0, 6)

/**
 * The host shuffles, so the host can see the deck. They cannot change it: this
 * hash goes out before the hand and the deck is revealed after, so anyone can
 * check the two match. Same trust as a kitchen table, plus a receipt.
 */
export async function commit(deck: string[]): Promise<string> {
  const data = new TextEncoder().encode(deck.join(','))
  const digest = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 16)
}
