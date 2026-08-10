import type { Event, LoggedEvent, SeatId } from './types.ts'
import type { RoomState } from './state.ts'

/**
 * Raw events are never sent to clients: `hand_started` carries the whole deck
 * and `cards_moved` carries card ids. The client gets this instead — a narrated
 * tail that is safe by construction and is also what the action log and the
 * "what did I miss" re-entry surface actually need.
 */
export interface LogEntry {
  seq: number
  kind: 'deal' | 'bet' | 'fold' | 'street' | 'award' | 'table' | 'seat'
  /** Who the line is about, for highlighting. */
  seatId: SeatId | null
  text: string
}

const chips = (n: number) => n.toLocaleString()

export function narrate(logged: LoggedEvent, state: RoomState): LogEntry | null {
  const e: Event = logged.e
  const name = (id: SeatId | null) =>
    (id && state.table.seats.find((s) => s.id === id)?.name) || 'Someone'

  switch (e.t) {
    case 'hand_started':
      return line('deal', null, `Hand ${state.poker.handNumber} — ${name(e.button)} on the button`)

    case 'blind_posted':
      return line(
        'bet',
        e.seatId,
        `${name(e.seatId)} posts the ${e.kind === 'sb' ? 'small' : 'big'} blind, ${chips(e.amount)}` +
          (e.allIn ? ' (all-in)' : ''),
      )

    case 'acted': {
      const who = name(e.seatId)
      if (e.action === 'fold') return line('fold', e.seatId, `${who} folds`)
      if (e.action === 'check') return line('bet', e.seatId, `${who} checks`)
      const suffix = e.allIn ? ' and is all-in' : ''
      if (e.action === 'call') return line('bet', e.seatId, `${who} calls ${chips(e.amount)}${suffix}`)
      const to = (state.poker.street[e.seatId] ?? 0)
      return line('bet', e.seatId, `${who} ${e.action === 'bet' ? 'bets' : 'raises to'} ${chips(to)}${suffix}`)
    }

    case 'street_advanced': {
      const label = { flop: 'Flop', turn: 'Turn', river: 'River', preflop: 'Preflop', showdown: 'Showdown' }[
        e.street
      ]
      return line('street', null, label)
    }

    case 'uncalled_returned':
      return line(
        'bet',
        e.seatId,
        `${chips(e.amount)} returned to ${name(e.seatId)} — uncalled`,
      )

    case 'pot_awarded': {
      const who = e.seatIds.map(name).join(' and ')
      const split = e.seatIds.length > 1 ? ' split' : ' wins'
      const what = e.description && e.description !== 'uncontested' ? ` with ${e.description}` : ''
      return line('award', e.seatIds[0] ?? null, `${who}${split} ${chips(e.amount)}${what}`)
    }

    case 'hand_completed':
      return e.showdown ? null : line('street', null, 'Hand over — no showdown')

    case 'restack':
      return line('seat', e.seatId, `${name(e.seatId)} re-stacks for ${chips(e.amount)}`)

    case 'seat_away':
      return line('seat', e.seatId, `${name(e.seatId)} ${e.away ? 'stands up' : 'sits back down'}`)

    case 'seat_added':
      return line('seat', e.seatId, `${e.name} takes a seat`)

    case 'seat_connected':
      return e.connected ? null : line('seat', e.seatId, `${name(e.seatId)} lost connection`)

    case 'table_opened':
      return line('table', null, `Table open — everyone starts with ${chips(e.startingStack)}`)

    case 'zone_shuffled':
      return line('table', null, `Deck shuffled`)

    case 'cards_moved': {
      // Sandbox needs to know cards moved; poker narrates its own dealing.
      if (state.settings.mode === 'poker') return null
      const from = state.table.zones[e.from]
      const to = state.table.zones[e.to]
      if (!from || !to) return null
      const n = e.cardIds.length
      const owner = to.owner ? name(to.owner) : to.label
      return line('deal', to.owner, `${n} card${n === 1 ? '' : 's'} → ${owner}`)
    }

    default:
      return null
  }

  function line(kind: LogEntry['kind'], seatId: SeatId | null, text: string): LogEntry {
    return { seq: logged.seq, kind, seatId, text }
  }
}

/**
 * Narrate history by replaying it: "raises to 80" reads the running total from
 * the state that event produced, not from now.
 */
export function narrateLog(log: LoggedEvent[], from: RoomState, apply: (s: RoomState, e: Event) => RoomState): LogEntry[] {
  let s = from
  const out: LogEntry[] = []
  for (const l of log) {
    s = apply(s, l.e)
    const entry = narrate(l, s)
    if (entry) out.push(entry)
  }
  return out
}
