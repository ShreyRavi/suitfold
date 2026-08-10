import type { CardId, Command, Decision, Event, Seat, SeatId, Zone } from '../../core/types.ts'
import { ok, reject } from '../../core/types.ts'
import type { RoomState } from '../../core/state.ts'
import { apply, handZoneId } from '../../core/state.ts'
import { cryptoRandom, rankOf, shuffle, standardDeck, type RandomSource } from '../../core/cards.ts'
import { validateHand } from './melds.ts'

export const CLOSED = 'deck'
export const OPEN = 'discard'
export const WILD = 'wild'
export const HAND_SIZE = 13

/**
 * Indian Rummy, 13 cards, two decks plus printed jokers.
 *
 * The turn is two steps — draw, then discard — which is the first game here
 * where a turn is not a single action. Everything else is the table layer:
 * drawing is deck → hand, discarding is hand → discard.
 */

export function rummyZones(seats: Seat[]): Zone[] {
  const zones: Zone[] = [
    { id: CLOSED, kind: 'deck', owner: null, visibility: 'hidden', ordered: true, layout: 'stack', label: 'Closed' },
    { id: OPEN, kind: 'discard', owner: null, visibility: 'public', ordered: true, layout: 'stack', label: 'Open' },
    { id: WILD, kind: 'pile', owner: null, visibility: 'public', ordered: true, layout: 'stack', label: 'Joker' },
  ]
  for (const s of seats) {
    zones.push({
      id: handZoneId(s.id),
      kind: 'hand',
      owner: s.id,
      visibility: 'owner',
      ordered: true,
      layout: 'fan',
      label: `${s.name}'s hand`,
    })
  }
  return zones
}

const playing = (s: Seat) => !s.away

/** Deal 13 each, turn a wild joker, then flip one card to start the open pile. */
export function startRummy(state: RoomState, rng: RandomSource = cryptoRandom): Decision {
  const seats = state.table.seats.filter(playing)
  if (seats.length < 2) return reject('not-enough-players')

  const deck = shuffle(standardDeck(true, 2), rng)
  const events: Event[] = [
    { t: 'reveals_cleared' },
    { t: 'zones_set', zones: rummyZones(state.table.seats) },
    { t: 'cards_dealt_into', zoneId: CLOSED, cardIds: deck, faceUp: false },
    { t: 'rummy_started', players: seats.map((s) => s.id), deck },
  ]

  let s = state
  const move = (cardIds: CardId[], to: string, faceUp: boolean) => {
    const e: Event = { t: 'cards_moved', cardIds, from: CLOSED, to, faceUp }
    events.push(e)
    s = apply(s, e)
  }
  s = events.slice(0, 4).reduce(apply, state)

  for (let round = 0; round < HAND_SIZE; round++) {
    for (const seat of seats) {
      const top = (s.table.cards[CLOSED] ?? [])[0]
      if (top) move([top], handZoneId(seat.id), false)
    }
  }

  // One card turned face up: its RANK is wild in every suit for this hand.
  const jokerCard = (s.table.cards[CLOSED] ?? [])[0]
  if (jokerCard) move([jokerCard], WILD, true)
  // And one to start the open pile.
  const first = (s.table.cards[CLOSED] ?? [])[0]
  if (first) move([first], OPEN, true)

  const firstToAct = seats[0]!.id
  events.push({ t: 'turn_changed', seatId: firstToAct })
  return ok(events)
}

export function rummyDecide(state: RoomState, cmd: Command, rng: RandomSource = cryptoRandom): Decision {
  const r = state.rummy

  switch (cmd.c) {
    case 'deal_hand':
    case 'reset_table':
      return startRummy(state, rng)

    case 'draw': {
      if (state.table.turn !== cmd.seatId) return reject('not-your-turn')
      if (r.phase !== 'draw') return reject('must-discard', 'Discard a card before drawing another.')
      const from = cmd.from === 'open' ? OPEN : CLOSED
      const pile = state.table.cards[from] ?? []
      // The open pile is taken from the top; the closed deck from the front.
      const card = cmd.from === 'open' ? pile[pile.length - 1] : pile[0]
      if (!card) return reject('nothing-to-do', 'That pile is empty.')
      return ok([
        { t: 'cards_moved', cardIds: [card], from, to: handZoneId(cmd.seatId), faceUp: false },
        { t: 'rummy_drew', seatId: cmd.seatId, from: cmd.from },
      ])
    }

    case 'discard': {
      if (state.table.turn !== cmd.seatId) return reject('not-your-turn')
      if (r.phase !== 'discard') return reject('must-draw-first', 'Take a card first.')
      const hand = state.table.cards[handZoneId(cmd.seatId)] ?? []
      if (!hand.includes(cmd.cardId)) return reject('card-not-there')

      const events: Event[] = [
        { t: 'cards_moved', cardIds: [cmd.cardId], from: handZoneId(cmd.seatId), to: OPEN, faceUp: true },
        { t: 'rummy_discarded', seatId: cmd.seatId, cardId: cmd.cardId },
      ]
      const next = nextSeat(state, cmd.seatId)
      events.push({ t: 'turn_changed', seatId: next })
      // Refill the closed deck from the open pile if it runs out, so a long
      // hand never simply stops.
      const closed = state.table.cards[CLOSED] ?? []
      if (closed.length <= 1) {
        const open = (state.table.cards[OPEN] ?? []).filter((c) => c !== cmd.cardId)
        if (open.length > 1) {
          const recycled = open.slice(0, -1)
          events.push({ t: 'cards_moved', cardIds: recycled, from: OPEN, to: CLOSED, faceUp: false })
          events.push({ t: 'zone_shuffled', zoneId: CLOSED, order: shuffle(recycled, rng) })
        }
      }
      return ok(events)
    }

    case 'declare': {
      if (state.table.turn !== cmd.seatId) return reject('not-your-turn')
      if (r.phase !== 'discard') return reject('must-draw-first', 'Take a card first.')
      const hand = state.table.cards[handZoneId(cmd.seatId)] ?? []
      if (!hand.includes(cmd.cardId)) return reject('card-not-there')

      // You finish by putting one card away and showing the other thirteen.
      const showing = hand.filter((c) => c !== cmd.cardId)
      const check = validateHand(showing, wildRank(state))
      if (!check.valid) {
        // Refused before it costs anything, with the reason in plain English.
        return reject('invalid-declaration', check.reason)
      }

      return ok([
        { t: 'cards_moved', cardIds: [cmd.cardId], from: handZoneId(cmd.seatId), to: OPEN, faceUp: true },
        { t: 'zones_revealed', zoneIds: state.table.seats.map((s) => handZoneId(s.id)) },
        { t: 'rummy_declared', seatId: cmd.seatId, groups: check.groups },
        { t: 'turn_changed', seatId: null },
      ])
    }

    default:
      return reject('wrong-mode')
  }
}

/** The rank of the turned joker card. Printed jokers have no rank. */
export function wildRank(state: RoomState): string | null {
  const card = (state.table.cards[WILD] ?? [])[0]
  if (!card || card.startsWith('X')) return null
  return rankOf(card)
}

function nextSeat(state: RoomState, from: SeatId): SeatId | null {
  const seats = state.table.seats.filter(playing)
  if (seats.length === 0) return null
  const i = seats.findIndex((s) => s.id === from)
  return seats[(i + 1) % seats.length]!.id
}

/** Is this hand one card away from a valid declaration? Used for the hint. */
export function couldDeclare(state: RoomState, seatId: SeatId): CardId | null {
  const hand = state.table.cards[handZoneId(seatId)] ?? []
  if (hand.length !== HAND_SIZE + 1) return null
  const wild = wildRank(state)
  for (const card of hand) {
    if (validateHand(hand.filter((c) => c !== card), wild).valid) return card
  }
  return null
}
