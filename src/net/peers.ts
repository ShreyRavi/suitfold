import { joinRoom, selfId } from 'trystero/nostr'
import type { Action, CardId, SeatId, TableView } from '../table/model.ts'
import type { Command } from './dealer.ts'

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

/**
 * Public nostr relays, used purely to swap connection details. No game data
 * goes through them: once two browsers have found each other they talk
 * directly, and a relay that dies mid-game costs nothing.
 *
 * These are run by strangers as a favour and they come and go, so this is a
 * snapshot rather than a promise. Two kinds of failure have been seen: the
 * honest one, where the socket will not open, and the awkward one, where it
 * opens and the relay then refuses to carry anything - a web of trust policy,
 * or a spam rule. The second looks perfectly healthy to anything that only
 * checks whether it can connect, which is why the list is long.
 *
 * It cannot be checked from a script: trystero needs WebRTC, and there is no
 * RTCPeerConnection outside a browser. Two browser tabs is the only real test.
 */
const RELAYS = [
  'wss://nos.lol',
  'wss://relay.primal.net',
  'wss://relay.nostr.net',
  'wss://nostr.oxtr.dev',
  'wss://relay.mostr.pub',
  'wss://nostr.mom',
]

/** Somebody at the door, waiting to be let in. */
export interface Knock {
  peer: PeerId
  name: string
  emoji: string
  at: number
}

/** What the host says to somebody who has knocked. */
export interface Door {
  state: 'waiting' | 'refused'
}

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
  /** Who is allowed to deal, when the table is not being held in a tab. */
  dealer?: SeatId | null
  /**
   * Anybody waiting at the door, sent to the dealer and to nobody else.
   *
   * The door lives wherever the deck does. When that is a server rather than
   * somebody's tab, the person who has to answer it is not the person holding
   * the list, so the list has to travel.
   */
  knocking?: Knock[]
  /** Which version of the wire the table speaks. Absent means older than 1. */
  wire?: number
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
  /**
   * What the dealer wants done. Separate from actions because these are not
   * changes to the table, they are instructions to whoever is holding it -
   * shuffle, deal, take that back - and only one person may give them.
   */
  command: { send: Send<Command>; on: On<Command> }
  ping: { send: Send<number>; on: On<number> }
  resync: { send: Send<number>; on: On<number> }
  chat: { send: Send<string>; on: On<string> }
  /**
   * The host telling somebody where they stand at the door: waiting to be let
   * in, or turned away. Only ever host to guest, and only before they are
   * seated, which is exactly when they get no snapshots to learn it from.
   */
  door: { send: Send<Door>; on: On<Door> }
  onPeerJoin(fn: (id: PeerId) => void): void
  onPeerLeave(fn: (id: PeerId) => void): void
  peers(): PeerId[]
  leave(): void
}

export function connect(roomCode: string): Wire {
  const room = joinRoom(
    {
      appId: 'suitfold-table-v1',
      // Browsers still talk to each other directly; these are only used to
      // introduce them. Naming several matters because they are public, they
      // are run by strangers as a favour, and any one of them can be down or
      // rate limiting on the night you want to play. With no server of our own
      // this handshake is the single thing that can stop a game starting, so
      // it does not get to depend on one stranger's goodwill.
      // No redundancy setting: supplying urls makes trystero use all of them
      // and ignore it, so asking for four of eight would have been a comment
      // that lied. All of them, and the bad ones cost a failed socket.
      relayConfig: { urls: RELAYS },
      // No shared password on the room any more. It used to be the phrase,
      // which made the phrase a real cryptographic requirement for reaching
      // anybody - but it also meant everybody joining had to know it, and
      // joining is meant to need nothing but a code now. The door is a person
      // instead: knowing the code gets you as far as knocking, and somebody at
      // the table decides. Trystero still encrypts the handshake with a key
      // derived from the app and room ids, so nothing is in the clear.
    },
    roomCode,
  )

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
    command: channel<Command>('cmd'),
    ping: channel<number>('ping'),
    resync: channel<number>('resyn'),
    chat: channel<string>('chat'),
    door: channel<Door>('door'),
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
