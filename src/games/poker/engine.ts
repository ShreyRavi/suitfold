import type {
  CardId,
  Command,
  Decision,
  Event,
  Pot,
  Seat,
  SeatId,
  Street,
  Zone,
} from '../../core/types.ts'
import { ok, reject } from '../../core/types.ts'
import type { RoomState } from '../../core/state.ts'
import { apply, handZoneId } from '../../core/state.ts'
import { shuffle, standardDeck, type RandomSource, cryptoRandom } from '../../core/cards.ts'
import { legalActions } from './state.ts'
import { describeHand, showdown } from './eval.ts'

export const DECK = 'deck'
export const DISCARD = 'discard'
export const BOARD = 'board'

const applyAll = (s: RoomState, events: Event[]): RoomState => events.reduce(apply, s)

// ---------------------------------------------------------------------------
// Zones
// ---------------------------------------------------------------------------

export function pokerZones(seats: Seat[]): Zone[] {
  const zones: Zone[] = [
    { id: DECK, kind: 'deck', owner: null, visibility: 'hidden', ordered: true, layout: 'stack', label: 'Deck' },
    { id: DISCARD, kind: 'discard', owner: null, visibility: 'hidden', ordered: true, layout: 'stack', label: 'Burned' },
    { id: BOARD, kind: 'board', owner: null, visibility: 'public', ordered: true, layout: 'row', label: 'Board' },
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

// ---------------------------------------------------------------------------
// Seat ring / positions
// ---------------------------------------------------------------------------

const eligible = (s: Seat) => !s.away && s.stack > 0

function ringAfter(seats: Seat[], fromId: SeatId | null, pred: (s: Seat) => boolean): Seat | null {
  if (seats.length === 0) return null
  const start = fromId ? seats.findIndex((s) => s.id === fromId) : -1
  for (let i = 1; i <= seats.length; i++) {
    const s = seats[(start + i + seats.length * 2) % seats.length]!
    if (pred(s)) return s
  }
  return null
}

export interface Positions {
  button: SeatId
  sb: SeatId | null // null = dead small blind, nobody posts
  bb: SeatId
  players: SeatId[]
}

/**
 * Dead button rules. The big blind always advances one occupied seat forward.
 * The small blind is the seat immediately before it in the *full* ring — if
 * that seat is empty or busted the blind is dead and nobody posts it. The
 * button is the seat before that, and may itself be a dead marker.
 *
 * Heads-up is the documented exception: the button posts the small blind, acts
 * first preflop and last afterwards.
 */
export function positions(seats: Seat[], lastBB: SeatId | null): Positions | null {
  const playing = seats.filter(eligible)
  if (playing.length < 2) return null
  const n = seats.length

  if (playing.length === 2) {
    const bb = lastBB ? ringAfter(seats, lastBB, eligible)! : playing[1]!
    const button = playing.find((s) => s.id !== bb.id)!
    return { button: button.id, sb: button.id, bb: bb.id, players: playing.map((s) => s.id) }
  }

  if (!lastBB) {
    return {
      button: playing[0]!.id,
      sb: playing[1]!.id,
      bb: playing[2]!.id,
      players: playing.map((s) => s.id),
    }
  }

  const bb = ringAfter(seats, lastBB, eligible)!
  const idx = seats.findIndex((s) => s.id === bb.id)
  const prev1 = seats[(idx - 1 + n) % n]!
  const prev2 = seats[(idx - 2 + n) % n]!
  return {
    button: prev2.id,
    sb: eligible(prev1) ? prev1.id : null, // dead small blind
    bb: bb.id,
    players: playing.map((s) => s.id),
  }
}

// ---------------------------------------------------------------------------
// Starting a hand
// ---------------------------------------------------------------------------

export function startHand(
  state: RoomState,
  rng: RandomSource = cryptoRandom,
  /** Test hook: deal from an exact, hand-authored deck instead of shuffling. */
  forcedDeck?: CardId[],
): Decision {
  if (state.poker.phase !== 'idle' && state.poker.phase !== 'complete') return reject('hand-in-progress')
  const pos = positions(state.table.seats, state.poker.lastBB)
  if (!pos) return reject('not-enough-players')

  const { smallBlind: sb, bigBlind: bb } = state.settings
  const deck = forcedDeck ? forcedDeck.slice() : shuffle(standardDeck(false), rng)

  const events: Event[] = [
    { t: 'reveals_cleared' },
    { t: 'zones_set', zones: pokerZones(state.table.seats) },
    // The shuffled order is written to the log here. Replay reads THIS, never a
    // seed — so changing the shuffle implementation later cannot re-deal a
    // previously logged night.
    { t: 'cards_dealt_into', zoneId: DECK, cardIds: deck, faceUp: false },
    { t: 'hand_started', deck, button: pos.button, players: pos.players, sb, bb },
  ]

  let s = applyAll(state, events)

  // Blinds. A player with fewer chips than the blind posts all-in for less.
  const post = (seatId: SeatId, want: number, kind: 'sb' | 'bb') => {
    const seat = s.table.seats.find((x) => x.id === seatId)!
    const amount = Math.min(want, seat.stack)
    const e: Event = { t: 'blind_posted', seatId, amount, nominal: want, kind, allIn: amount >= seat.stack }
    events.push(e)
    s = apply(s, e)
  }
  if (pos.sb) post(pos.sb, sb, 'sb')
  post(pos.bb, bb, 'bb')

  // Two hole cards each, dealt one at a time around the table like a real deal.
  for (let round = 0; round < 2; round++) {
    for (const id of pos.players) {
      const top = (s.table.cards[DECK] ?? [])[0]
      if (!top) break
      const e: Event = { t: 'cards_moved', cardIds: [top], from: DECK, to: handZoneId(id), faceUp: false }
      events.push(e)
      s = apply(s, e)
    }
  }

  const first = firstToAct(s)
  events.push({ t: 'turn_changed', seatId: first })
  s = apply(s, events[events.length - 1]!)

  events.push(...settle(s))
  return ok(events)
}

/** Preflop action starts left of the big blind; afterwards, left of the button. */
function firstToAct(s: RoomState): SeatId | null {
  const p = s.poker
  const anchor = p.phase === 'preflop' ? p.bbSeat : p.button
  const next = ringAfter(s.table.seats, anchor, (x) => canAct(s, x.id))
  return next?.id ?? null
}

const inHand = (s: RoomState, id: SeatId) => s.poker.players.includes(id) && !s.poker.folded[id]
const canAct = (s: RoomState, id: SeatId) => inHand(s, id) && !s.poker.allIn[id]

function needsToAct(s: RoomState, id: SeatId): boolean {
  const p = s.poker
  if (!canAct(s, id)) return false
  if (!(p.acted[id] ?? false)) return true
  return (p.street[id] ?? 0) < p.currentBet
}

function nextToAct(s: RoomState, fromId: SeatId | null): SeatId | null {
  return ringAfter(s.table.seats, fromId, (x) => needsToAct(s, x.id))?.id ?? null
}

// ---------------------------------------------------------------------------
// decide
// ---------------------------------------------------------------------------

export function pokerDecide(state: RoomState, cmd: Command, rng: RandomSource = cryptoRandom): Decision {
  switch (cmd.c) {
    case 'deal_hand':
      return startHand(state, rng)

    case 'poker_action':
      return act(state, cmd.seatId, cmd.action, cmd.amount)

    case 'force_fold': {
      if (state.table.turn !== cmd.target) return reject('not-your-turn')
      return act(state, cmd.target, 'fold')
    }

    case 'restack': {
      // Chip conservation within a hand is only sound because this is refused
      // while a hand is live.
      if (state.poker.phase !== 'idle' && state.poker.phase !== 'complete') return reject('restack-mid-hand')
      return ok([{ t: 'restack', seatId: cmd.target, amount: cmd.amount }])
    }

    default:
      return reject('wrong-mode')
  }
}

function act(state: RoomState, seatId: SeatId, action: string, amount?: number): Decision {
  const p = state.poker
  if (state.table.turn !== seatId) return reject('not-your-turn')
  const seat = state.table.seats.find((s) => s.id === seatId)
  if (!seat) return reject('illegal-move')

  const legal = legalActions(state, seatId)
  if (!legal.includes(action as never)) {
    return reject(action === 'raise' || action === 'bet' ? 'action-not-reopened' : 'illegal-move')
  }

  const committed = p.street[seatId] ?? 0
  const toCall = p.currentBet - committed
  const events: Event[] = []

  if (action === 'fold') {
    events.push({ t: 'acted', seatId, action: 'fold', amount: 0, allIn: false })
  } else if (action === 'check') {
    if (toCall > 0) return reject('illegal-move')
    events.push({ t: 'acted', seatId, action: 'check', amount: 0, allIn: false })
  } else if (action === 'call') {
    const pay = Math.min(toCall, seat.stack)
    events.push({ t: 'acted', seatId, action: 'call', amount: pay, allIn: pay >= seat.stack })
  } else {
    // bet / raise. `amount` is the TOTAL this seat will have in on this street.
    const target = amount ?? 0
    const maxTo = committed + seat.stack
    if (target > maxTo) return reject('insufficient-chips')

    const raiseStep = Math.max(p.lastRaiseSize, state.settings.bigBlind)
    const minTo = p.currentBet + raiseStep
    const isAllIn = target === maxTo
    // A short all-in is legal — it just does not reopen action. Anything else
    // below the minimum is refused.
    if (target < minTo && !isAllIn) return reject('below-min-raise')
    if (target <= p.currentBet) return reject('below-min-raise')

    const pay = target - committed
    events.push({
      t: 'acted',
      seatId,
      action: p.currentBet === 0 ? 'bet' : 'raise',
      amount: pay,
      allIn: isAllIn,
    })
  }

  let s = applyAll(state, events)
  events.push(...settle(s))
  return ok(events)
}

// ---------------------------------------------------------------------------
// settle — everything the table does on its own after a human acts
// ---------------------------------------------------------------------------

const STREET_ORDER: Street[] = ['preflop', 'flop', 'turn', 'river']

export function settle(start: RoomState): Event[] {
  const out: Event[] = []
  let s = start
  const push = (...es: Event[]) => {
    for (const e of es) {
      out.push(e)
      s = apply(s, e)
    }
  }

  for (let guard = 0; guard < 200; guard++) {
    const p = s.poker
    if (p.phase === 'idle' || p.phase === 'complete' || p.phase === 'showdown') break

    const live = p.players.filter((id) => !p.folded[id])

    // Everyone folded to one player. No showdown, no reveal.
    if (live.length <= 1) {
      push(...finish(s, false))
      break
    }

    // The seat whose turn it already is gets checked FIRST — walking the ring
    // from it would skip straight past the player we are waiting on.
    const current = s.table.turn
    if (current && needsToAct(s, current)) break // waiting on a human

    const pending = nextToAct(s, current ?? p.button)
    if (pending) {
      push({ t: 'turn_changed', seatId: pending })
      break // waiting on a human
    }

    // Betting round is done.
    const streetIdx = STREET_ORDER.indexOf(p.phase as Street)
    const canStillBet = live.filter((id) => !p.allIn[id])

    if (streetIdx === STREET_ORDER.length - 1) {
      push(...finish(s, true))
      break
    }

    if (canStillBet.length <= 1) {
      // Everyone is committed. Run the remaining streets out with no betting.
      for (let i = streetIdx; i < STREET_ORDER.length - 1; i++) {
        push(...dealStreet(s, STREET_ORDER[i + 1]!))
      }
      push(...finish(s, true))
      break
    }

    push(...dealStreet(s, STREET_ORDER[streetIdx + 1]!))
    const first = ringAfter(s.table.seats, s.poker.button, (x) => canAct(s, x.id))
    push({ t: 'turn_changed', seatId: first?.id ?? null })
  }

  return out
}

function dealStreet(s: RoomState, street: Street): Event[] {
  const deck = s.table.cards[DECK] ?? []
  const count = street === 'flop' ? 3 : 1
  const events: Event[] = [{ t: 'street_advanced', street }]
  // Burn one, then deal.
  const burn = deck[0]
  if (burn) events.push({ t: 'cards_moved', cardIds: [burn], from: DECK, to: DISCARD, faceUp: false })
  const dealt = deck.slice(1, 1 + count)
  if (dealt.length) events.push({ t: 'cards_moved', cardIds: dealt, from: DECK, to: BOARD, faceUp: true })
  return events
}

/**
 * End the hand: return any uncalled bet, build the pots, award them, and
 * reveal if this went to showdown.
 */
function finish(s0: RoomState, wentToShowdown: boolean): Event[] {
  const out: Event[] = []
  let s = s0
  const push = (...es: Event[]) => {
    for (const e of es) {
      out.push(e)
      s = apply(s, e)
    }
  }

  // 1. Uncalled bet return. If one player put in strictly more than anyone
  // else could match, the excess comes back before any pot exists.
  const totals = s.poker.players.map((id) => ({ id, n: s.poker.total[id] ?? 0 })).sort((a, b) => b.n - a.n)
  const top = totals[0]
  const second = totals[1]
  if (top && second && top.n > second.n) {
    push({ t: 'uncalled_returned', seatId: top.id, amount: top.n - second.n })
  }

  // 2. Pots.
  const pots = buildPots(s)
  push({ t: 'pots_built', pots })

  // 3. Awards.
  const board = s.table.cards[BOARD] ?? []
  const live = s.poker.players.filter((id) => !s.poker.folded[id])

  pots.forEach((pot, i) => {
    const contenders = pot.eligible.filter((id) => live.includes(id))
    if (contenders.length === 0) return
    let winners: SeatId[]
    let description: string
    if (!wentToShowdown || contenders.length === 1) {
      winners = [contenders[0]!]
      description = contenders.length === 1 && !wentToShowdown ? 'everyone folded' : 'uncontested'
    } else {
      const r = showdown(
        contenders.map((id) => ({ seatId: id, hole: s.table.cards[handZoneId(id)] ?? [] })),
        board,
      )
      winners = r.winners
      description = r.description
    }
    push({
      t: 'pot_awarded',
      potIndex: i,
      seatIds: winners,
      amount: pot.amount,
      odd: oddChipSeat(s, winners),
      description,
    })
  })

  // 4. Reveal. Only on showdown, and only when the room has it on — a hand
  // everyone folded reveals nothing.
  if (wentToShowdown && s.settings.muckedReveal) {
    push({ t: 'zones_revealed', zoneIds: s.poker.players.map(handZoneId) })
  }
  push({ t: 'hand_completed', showdown: wentToShowdown })
  return out
}

/** Odd chip on a split pot goes to the first eligible winner left of the button. */
function oddChipSeat(s: RoomState, winners: SeatId[]): SeatId | null {
  if (winners.length <= 1) return null
  const seat = ringAfter(s.table.seats, s.poker.button, (x) => winners.includes(x.id))
  return seat?.id ?? winners[0]!
}

/**
 * Side pots. Contributions are layered: each distinct commitment level forms a
 * pot that only the players who reached that level can win.
 */
export function buildPots(s: RoomState): Pot[] {
  const p = s.poker
  const contributors = p.players.filter((id) => (p.total[id] ?? 0) > 0)
  const levels = [...new Set(contributors.map((id) => p.total[id] ?? 0))].sort((a, b) => a - b)

  const pots: Pot[] = []
  let prev = 0
  for (const level of levels) {
    let amount = 0
    for (const id of contributors) {
      const t = p.total[id] ?? 0
      amount += Math.min(t, level) - Math.min(t, prev)
    }
    const eligibleSeats = contributors.filter((id) => (p.total[id] ?? 0) >= level && !p.folded[id])
    if (amount > 0) pots.push({ amount, eligible: eligibleSeats })
    prev = level
  }

  // Layers with the same eligible set are one pot as far as anyone cares.
  const merged: Pot[] = []
  for (const pot of pots) {
    const last = merged[merged.length - 1]
    if (last && sameSet(last.eligible, pot.eligible)) last.amount += pot.amount
    else merged.push({ ...pot, eligible: pot.eligible.slice() })
  }
  return merged
}

const sameSet = (a: SeatId[], b: SeatId[]) =>
  a.length === b.length && a.every((x) => b.includes(x))

/** Hand descriptions for the reveal screen. */
export function revealDescriptions(s: RoomState): Record<SeatId, string> {
  const board = s.table.cards[BOARD] ?? []
  const out: Record<SeatId, string> = {}
  for (const id of s.poker.players) {
    const hole = s.table.cards[handZoneId(id)] ?? []
    if (hole.length) out[id] = describeHand(hole, board)
  }
  return out
}

export type { CardId }
