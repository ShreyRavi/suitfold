import { joinRoom, selfId } from 'trystero/nostr'
import type { Action, CardId, SeatId, TableView } from '../table/model.ts'

/**
 * There is no server. Browsers meet through public relays and then talk
 * directly to each other over WebRTC.
 *
 * Two kinds of traffic, and the difference matters for how the table feels:
 *
 *   ACTIONS go to the host, which applies them and sends back the new table.
 *   That is the authoritative path, and it is what keeps the deck honest.
 *
 *   DRAGS go straight to everyone, many times a second, and are never stored.
 *   If they went through the host they would arrive as a series of jumps
 *   instead of a card sliding across the table.
 */

export type PeerId = string
export const myPeerId = (): PeerId => selfId

export interface Hello {
  name: string
  emoji?: string
  /**
   * Who this browser is, across reloads and reconnections. Names were doing
   * this job, which meant coming back as "Dad" when somebody else was already
   * called Dad handed you a new seat and left your cards stranded.
   */
  token?: string
}

export interface Snapshot {
  view: TableView
  seat: SeatId | null
  /** Which revision of the table this is. Snapshots are whole, not deltas. */
  rev: number
}

/** Where somebody's pointer is, in table coordinates. Never stored. */
export interface Cursor {
  by: SeatId
  x: number
  y: number
  /** false = they have left the table surface, so stop drawing them. */
  on: boolean
}

/** Live, un-stored, sent at pointer rate. */
export interface Drag {
  ids: CardId[]
  x: number
  y: number
  /** false = the drag ended, so stop drawing the ghost. */
  holding: boolean
  by: SeatId
}

type Send<T> = (data: T, to?: PeerId | PeerId[]) => void
type On<T> = (fn: (data: T, from: PeerId) => void) => void

export interface Wire {
  hello: { send: Send<Hello>; on: On<Hello> }
  action: { send: Send<Action>; on: On<Action> }
  snapshot: { send: Send<Snapshot>; on: On<Snapshot> }
  drag: { send: Send<Drag>; on: On<Drag> }
  cursor: { send: Send<Cursor>; on: On<Cursor> }
  /**
   * The host says which revision it is on, often and cheaply. A client whose
   * own revision does not match asks for the whole table back.
   *
   * This is the difference between a dropped message being a blip and being
   * permanent: snapshots are whole tables, so one that arrives fixes anything
   * that went missing. The problem was never the loss, it was that nothing
   * ever told a client it had fallen behind.
   */
  ping: { send: Send<number>; on: On<number> }
  resync: { send: Send<number>; on: On<number> }
  chat: { send: Send<string>; on: On<string> }
  onPeerJoin(fn: (id: PeerId) => void): void
  onPeerLeave(fn: (id: PeerId) => void): void
  peers(): PeerId[]
  leave(): void
}

export function connect(roomCode: string): Wire {
  const room = joinRoom({ appId: 'suitfold-table-v1' }, roomCode)

  const channel = <T>(namespace: string) => {
    const action = room.makeAction(namespace)
    return {
      send: ((data, to) => {
        void action.send(data as never, to ? { target: to } : undefined)
      }) as Send<T>,
      on: ((fn) => {
        action.onMessage = (data, ctx) => fn(data as T, ctx.peerId)
      }) as On<T>,
    }
  }

  return {
    hello: channel<Hello>('hello'),
    action: channel<Action>('act'),
    snapshot: channel<Snapshot>('snap'),
    drag: channel<Drag>('drag'),
    cursor: channel<Cursor>('cur'),
    ping: channel<number>('ping'),
    resync: channel<number>('resyn'),
    chat: channel<string>('chat'),
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
 * Table codes get read aloud, so the alphabet drops anything that sounds or
 * looks like something else.
 */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export function newCode(): string {
  const bytes = new Uint8Array(5)
  crypto.getRandomValues(bytes)
  return [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join('')
}

export const cleanCode = (raw: string) =>
  raw
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .replace(/[IO01]/g, (c) => ({ I: 'J', O: 'Q', '0': 'Q', '1': 'J' })[c] ?? c)
    .slice(0, 5)

export const SEAT_COLOURS = ['#1f4b7a', '#b9482f', '#4a7c59', '#7a5c1f', '#6b4a7a', '#2f7f8f', '#a8462c', '#3f5b8a']
