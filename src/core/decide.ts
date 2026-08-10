import type { Command, Decision, Event } from './types.ts'
import { ok, reject } from './types.ts'
import type { RoomState } from './state.ts'
import { pokerDecide, startHand } from '../games/poker/engine.ts'
import { resetTable, sandboxDecide } from '../games/sandbox.ts'
import { rummyDecide, startRummy } from '../games/rummy/engine.ts'
import type { RandomSource } from './cards.ts'
import { cryptoRandom } from './cards.ts'

/**
 * The single entry point for every player and host action.
 *
 * Commands that belong to the table itself (standing up, sitting down) are
 * handled here. Everything else is routed to the active module. Nothing in this
 * file knows the rules of any game.
 */
export function decide(state: RoomState, cmd: Command, rng: RandomSource = cryptoRandom): Decision {
  // Table-level commands, identical in every mode.
  switch (cmd.c) {
    case 'stand_up': {
      const seat = state.table.seats.find((s) => s.id === cmd.seatId)
      if (!seat || seat.away) return reject('nothing-to-do')
      const events: Event[] = []
      // Standing up mid-hand folds that player's hand; the hand continues for
      // everyone else and the chips they already committed stay in the pot.
      const p = state.poker
      if (state.settings.mode === 'poker' && p.players.includes(cmd.seatId) && !p.folded[cmd.seatId]) {
        const folded = pokerDecide(state, { c: 'force_fold', seatId: cmd.seatId, target: cmd.seatId }, rng)
        if (folded.ok) events.push(...folded.events)
        else if (state.table.turn !== cmd.seatId) {
          // Not their turn — mark the hand dead without touching the action.
          events.push({ t: 'acted', seatId: cmd.seatId, action: 'fold', amount: 0, allIn: false })
        }
      }
      // Chips stay parked on the seat. They are never removed from the room,
      // which is what keeps the night-level chip conservation invariant true.
      events.push({ t: 'seat_away', seatId: cmd.seatId, away: true })
      return ok(events)
    }

    case 'sit_down': {
      const seat = state.table.seats.find((s) => s.id === cmd.seatId)
      if (!seat || !seat.away) return reject('nothing-to-do')
      return ok([{ t: 'seat_away', seatId: cmd.seatId, away: false }])
    }
  }

  switch (state.settings.mode) {
    case 'poker':
      return pokerDecide(state, cmd, rng)
    case 'rummy':
      return rummyDecide(state, cmd, rng)
    default:
      return sandboxDecide(state, cmd, rng)
  }
}

/** Set the table up for whichever mode the room is in. */
export function openTable(state: RoomState, rng: RandomSource = cryptoRandom): Decision {
  switch (state.settings.mode) {
    case 'poker':
      return startHand(state, rng)
    case 'rummy':
      return startRummy(state, rng)
    default:
      return resetTable(state, rng)
  }
}

export { ok, reject }
