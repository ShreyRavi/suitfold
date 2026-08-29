import type { CardId, SeatId, TableView } from '../table/model.ts'
import { presetById } from '../table/deck.ts'

/**
 * The things only the dealer does.
 *
 * These used to be methods you could only call if the table was sitting in
 * your own tab, which quietly meant the dealer and the deck had to be the same
 * browser. That is the one assumption stopping the table from living anywhere
 * else - in a little app on a Mac, say, that does not close when a tab does.
 *
 * So they are messages now. Whoever is holding the deck carries them out, and
 * whether that is this tab or something across the room is nobody's business
 * but the wire's.
 */
export type Command =
  | { c: 'setup'; preset: string }
  | { c: 'dealHand' }
  | { c: 'deal'; count: number; seats: SeatId[]; from?: { x: number; y: number }; faceUp?: boolean }
  | { c: 'gather' }
  | { c: 'shuffle'; ids: CardId[] }
  | { c: 'undo' }
  | { c: 'roll' }
  | { c: 'clock'; seconds: number | null }
  | { c: 'puckAdd'; label: string; hint: string }
  | { c: 'puckRemove'; id: string }
  | { c: 'score'; seat: SeatId; by: number }
  | { c: 'scoresClear' }
  | { c: 'logClear' }
  | { c: 'buyIn'; each: number }
  | { c: 'removeSeat'; seat: SeatId }
  | { c: 'admit'; peer: string }
  | { c: 'refuse'; peer: string }

/** What the table's controls need, wherever the table happens to be. */
export interface Dealer {
  setup(preset: string): void
  dealHand(): void
  deal(opts: { count: number; seats: SeatId[]; from?: { x: number; y: number }; faceUp?: boolean }): void
  gather(): void
  shuffleStack(ids: CardId[]): void
  undo(): void
  readonly canUndo: boolean
  roll(): void
  startClock(seconds: number): void
  stopClock(): void
  addPuck(label: string, hint: string): void
  removePuck(id: string): void
  score(seat: SeatId, by: number): void
  clearScores(): void
  sources(): { x: number; y: number; count: number }[]
  readonly canDealHand: boolean
  /** Answering the door. */
  admit(peer: string): void
  refuse(peer: string): void
}

/**
 * A dealer somewhere else.
 *
 * Everything that changes the table is a message. The two things that only
 * ask questions - what can I deal from, is there a hand to deal - are worked
 * out from what this browser can already see, because a face-down pile is a
 * position and a count whether or not you know what is in it.
 */
export function remoteDealer(view: () => TableView, send: (cmd: Command) => void): Dealer {
  return {
    setup: (preset) => send({ c: 'setup', preset }),
    dealHand: () => send({ c: 'dealHand' }),
    deal: (opts) => send({ c: 'deal', ...opts }),
    gather: () => send({ c: 'gather' }),
    shuffleStack: (ids) => send({ c: 'shuffle', ids }),
    undo: () => send({ c: 'undo' }),
    // The table would have to tell us, and it is not worth a round trip to grey
    // out a button that does nothing when there is nothing to undo.
    get canUndo() {
      return true
    },
    roll: () => send({ c: 'roll' }),
    startClock: (seconds) => send({ c: 'clock', seconds }),
    stopClock: () => send({ c: 'clock', seconds: null }),
    addPuck: (label, hint) => send({ c: 'puckAdd', label, hint }),
    removePuck: (id) => send({ c: 'puckRemove', id }),
    score: (seat, by) => send({ c: 'score', seat, by }),
    clearScores: () => send({ c: 'scoresClear' }),
    admit: (peer) => send({ c: 'admit', peer }),
    refuse: (peer) => send({ c: 'refuse', peer }),
    sources: () => facedownPiles(view()),
    get canDealHand() {
      const v = view()
      return !!presetById(v.game).hand && v.seats.length > 0 && v.cards.length > 0
    },
  }
}

/** Every face-down pile, biggest first: the things you can deal from. */
export function facedownPiles(view: TableView): { x: number; y: number; count: number }[] {
  const piles = new Map<string, { x: number; y: number; count: number }>()
  for (const c of view.cards) {
    if (c.hand !== null || c.faceUp) continue
    const key = `${c.x},${c.y}`
    const at = piles.get(key) ?? { x: c.x, y: c.y, count: 0 }
    at.count++
    piles.set(key, at)
  }
  return [...piles.values()].sort((a, b) => b.count - a.count)
}
