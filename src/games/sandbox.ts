import type { Command, Decision, Event, SandboxLayout, Seat, Zone } from '../core/types.ts'
import { ok, reject } from '../core/types.ts'
import type { RoomState } from '../core/state.ts'
import { handZoneId } from '../core/state.ts'
import { canSee } from '../core/project.ts'
import { shuffle, standardDeck, type RandomSource, cryptoRandom } from '../core/cards.ts'

export const DECK = 'deck'
export const DISCARD = 'discard'
export const BOARD = 'board'
export const TRICK = 'trick'

/**
 * Sandbox: the table with no rules on it.
 *
 * The whole module is the shape of a game module with every constraint removed.
 * It exists partly so the family can play Go Fish on night one, and partly
 * because a module that constrains nothing, sitting next to one that constrains
 * everything, is what proves the table layer is actually generic.
 *
 * The one rule it does enforce is visibility: you cannot move a card out of a
 * zone whose faces you are not entitled to see. Without that, "tap a card in
 * someone else's hand" would be a card-peeking oracle.
 */

interface Preset {
  deal: number
  discard: boolean
  board: boolean
  trick: boolean
}

const PRESETS: Record<SandboxLayout, Preset> = {
  'deck-only': { deal: 0, discard: true, board: false, trick: false },
  'deal-5': { deal: 5, discard: true, board: false, trick: false },
  'deal-7': { deal: 7, discard: true, board: false, trick: false },
  'deal-13': { deal: 13, discard: true, board: false, trick: false },
  trick: { deal: 7, discard: false, board: false, trick: true },
  everything: { deal: 7, discard: true, board: true, trick: true },
}

export function sandboxZones(seats: Seat[], layout: SandboxLayout): Zone[] {
  const p = PRESETS[layout]
  const zones: Zone[] = [
    { id: DECK, kind: 'deck', owner: null, visibility: 'hidden', ordered: true, layout: 'stack', label: 'Deck' },
  ]
  if (p.discard)
    zones.push({ id: DISCARD, kind: 'discard', owner: null, visibility: 'public', ordered: true, layout: 'stack', label: 'Discard' })
  if (p.board)
    zones.push({ id: BOARD, kind: 'board', owner: null, visibility: 'public', ordered: false, layout: 'row', label: 'Board' })
  if (p.trick)
    zones.push({ id: TRICK, kind: 'trick', owner: null, visibility: 'public', ordered: true, layout: 'row', label: 'Trick' })
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

/** Fresh table: rebuild zones, reshuffle a full deck, deal the preset. */
export function resetTable(state: RoomState, rng: RandomSource = cryptoRandom): Decision {
  const seats = state.table.seats.filter((s) => !s.away)
  const layout = state.settings.layout
  const preset = PRESETS[layout]
  const deck = shuffle(standardDeck(state.settings.jokers), rng)

  const events: Event[] = [
    { t: 'reveals_cleared' },
    { t: 'zones_set', zones: sandboxZones(state.table.seats, layout) },
    { t: 'cards_dealt_into', zoneId: DECK, cardIds: deck, faceUp: false },
  ]

  let cursor = 0
  for (let round = 0; round < preset.deal; round++) {
    for (const s of seats) {
      const card = deck[cursor++]
      if (!card) break
      events.push({ t: 'cards_moved', cardIds: [card], from: DECK, to: handZoneId(s.id), faceUp: false })
    }
  }
  // Sandbox has no turn order; the family decides who goes next.
  events.push({ t: 'turn_changed', seatId: null })
  return ok(events)
}

export function sandboxDecide(state: RoomState, cmd: Command, rng: RandomSource = cryptoRandom): Decision {
  switch (cmd.c) {
    case 'move': {
      const from = state.table.zones[cmd.from]
      const to = state.table.zones[cmd.to]
      if (!from || !to) return reject('illegal-move')
      // Visibility is the only rule sandbox enforces.
      if (!canSee(state, cmd.from, cmd.seatId)) return reject('zone-not-visible')
      const present = state.table.cards[cmd.from] ?? []
      if (!cmd.cardIds.every((c) => present.includes(c))) return reject('card-not-there')

      // Moving into a public zone turns the card up unless told otherwise;
      // moving into a hand or the deck turns it down.
      const faceUp = cmd.faceUp ?? (to.visibility === 'public' ? true : false)
      return ok([{ t: 'cards_moved', cardIds: cmd.cardIds, from: cmd.from, to: cmd.to, faceUp }])
    }

    case 'shuffle': {
      const cards = state.table.cards[cmd.zoneId] ?? []
      if (cards.length < 2) return reject('nothing-to-do')
      return ok([{ t: 'zone_shuffled', zoneId: cmd.zoneId, order: shuffle(cards, rng) }])
    }

    case 'flip': {
      return ok([{ t: 'cards_flipped', cardIds: cmd.cardIds, faceUp: cmd.faceUp }])
    }

    case 'deal': {
      const deck = state.table.cards[cmd.from] ?? []
      const seats = state.table.seats.filter((s) => !s.away)
      if (deck.length === 0 || seats.length === 0) return reject('nothing-to-do')
      const events: Event[] = []
      let cursor = 0
      for (let round = 0; round < cmd.count; round++) {
        for (const s of seats) {
          const card = deck[cursor++]
          if (!card) break
          events.push({
            t: 'cards_moved',
            cardIds: [card],
            from: cmd.from,
            to: handZoneId(s.id),
            faceUp: cmd.faceUp,
          })
        }
      }
      if (!events.length) return reject('nothing-to-do')
      return ok(events)
    }

    case 'gather': {
      const events: Event[] = []
      for (const [zoneId, cards] of Object.entries(state.table.cards)) {
        if (zoneId === cmd.to || cards.length === 0) continue
        events.push({ t: 'cards_moved', cardIds: cards.slice(), from: zoneId, to: cmd.to, faceUp: false })
      }
      if (!events.length) return reject('nothing-to-do')
      events.push({ t: 'reveals_cleared' })
      return ok(events)
    }

    case 'reset_table':
      return resetTable(state, rng)

    case 'adjust':
      if (!state.settings.counters) return reject('wrong-mode')
      return ok([
        { t: 'counter_adjusted', seatId: cmd.target, delta: cmd.delta, reason: cmd.reason },
      ])

    default:
      return reject('wrong-mode')
  }
}
