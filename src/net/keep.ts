import type { TableState } from '../table/model.ts'
import { emptyTable } from '../table/model.ts'

/**
 * A crash net for whoever is holding the deck.
 *
 * There is no server, so the host's tab *is* the table: reload it and the game
 * is gone. That is fine when you mean to close it and awful when the tab dies
 * on its own, so the host's table is written to its own browser after every
 * change and offered back when it starts up again.
 *
 * This is not a save file and not a ledger. One table, on one machine, that
 * the person who made it can carry on or throw away — nothing leaves the tab,
 * and guests keep nothing at all.
 */
const KEY = 'suitfold.table'
/** Older than this and it is last week's game, not an accident. */
const STALE = 6 * 60 * 60 * 1000

export interface Kept {
  code: string
  at: number
  state: TableState
}

export function keep(code: string, state: TableState) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ code, at: Date.now(), state } satisfies Kept))
  } catch {
    // A full or blocked store is not a reason to stop the game.
  }
}

export function kept(): Kept | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const k = JSON.parse(raw) as Kept
    if (!k?.state?.cards || !k.code) return null
    if (Date.now() - k.at > STALE) return forget()
    // A table with nothing on it is not worth offering back.
    if (Object.keys(k.state.cards).length === 0 && k.state.log.length < 2) return forget()
    return k
  } catch {
    return forget()
  }
}

export function forget(): null {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* nothing to do */
  }
  return null
}

/**
 * What comes back is a table, not a room. Everybody who was connected is not
 * connected any more — they have to come back through the link — so the seats
 * are marked away and the deck is handed to whoever is restoring it.
 */
export function reopen(k: Kept, mySeat: string): TableState {
  return {
    ...emptyTable(),
    ...k.state,
    seats: k.state.seats.map((s) => ({ ...s, connected: s.id === mySeat })),
  }
}
