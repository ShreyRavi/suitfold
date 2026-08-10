import type { Action, CardId, SeatId, TableState } from '../table/model.ts'
import { TABLE_H, TABLE_W, apply, emptyTable, inHand, onTable, project, stacks } from '../table/model.ts'
import { cryptoShuffle, place, presetById } from '../table/deck.ts'
import { SEAT_COLOURS, type PeerId, type Wire } from './peers.ts'

/**
 * The host's tab holds the table. Everyone else's tab draws it.
 *
 * There is no server, so somebody has to be the one with the cards. The host
 * shuffles and deals, exactly like whoever brings the deck to a kitchen table.
 * Every other player only ever receives what they are entitled to see.
 */
export class Host {
  state: TableState = emptyTable()
  private seatOf = new Map<PeerId, SeatId>()
  private peerOf = new Map<SeatId, PeerId>()

  constructor(
    private wire: Wire,
    readonly mySeat: SeatId,
    private onChange: () => void,
  ) {
    this.wire.hello.on((hello, from) => this.seat(from, hello.name))
    this.wire.action.on((action, from) => this.fromPeer(action, from))
    this.wire.onPeerLeave((id) => this.dropped(id))
  }

  // -- seating -------------------------------------------------------------

  private colour(i: number) {
    return SEAT_COLOURS[i % SEAT_COLOURS.length]!
  }

  seatSelf(name: string) {
    this.commit([{ t: 'seat_add', id: this.mySeat, name: clean(name) || 'Host', colour: this.colour(0) }])
  }

  private seat(peerId: PeerId, name: string) {
    const existing = this.seatOf.get(peerId)
    if (existing) {
      this.commit([{ t: 'seat_name', id: existing, name: clean(name) }])
      return
    }
    // Someone who dropped and came back takes their own seat again. Two rules
    // keep this from handing one player another player's cards:
    //   - never the host's own seat, which has no peer and so always looks free
    //   - only a seat currently marked disconnected, not merely unclaimed
    const returning = this.state.seats.find(
      (s) =>
        s.id !== this.mySeat &&
        !s.connected &&
        !this.peerOf.has(s.id) &&
        s.name.toLowerCase() === clean(name).toLowerCase(),
    )
    const id = returning?.id ?? `s${this.state.seats.length + 1}`
    this.seatOf.set(peerId, id)
    this.peerOf.set(id, peerId)

    const actions: Action[] = returning
      ? [{ t: 'seat_here', id, connected: true }]
      : [{ t: 'seat_add', id, name: unique(clean(name), this.state.seats.map((s) => s.name)), colour: this.colour(this.state.seats.length) }]
    this.commit(actions)
  }

  private dropped(peerId: PeerId) {
    const seat = this.seatOf.get(peerId)
    if (!seat) return
    this.seatOf.delete(peerId)
    this.peerOf.delete(seat)
    // Their cards stay in their hand. Phones background constantly and a
    // dropped connection is not someone leaving the table.
    this.commit([{ t: 'seat_here', id: seat, connected: false }])
  }

  /** Only the host can do this — it dumps that player's hand back on the table. */
  removeSeat(seat: SeatId) {
    const peer = this.peerOf.get(seat)
    if (peer) this.seatOf.delete(peer)
    this.peerOf.delete(seat)
    this.commit([{ t: 'seat_remove', id: seat }])
  }

  // -- actions -------------------------------------------------------------

  /** An action from a peer. The channel it arrived on is the seat it acts as. */
  private fromPeer(action: Action, from: PeerId) {
    const seat = this.seatOf.get(from)
    if (!seat) return
    if (!allowed(action, seat)) return
    if (!this.ownsCards(action, seat)) return
    this.commit([action])
  }

  /** From the host's own hands. */
  local(action: Action) {
    if (!this.ownsCards(action, this.mySeat)) return
    this.commit([action])
  }

  /**
   * You may move a card that is on the table or in your own hand. You may not
   * reach into somebody else's hand — which, since the projection never sent
   * you those ids, mostly means this catches a client that made them up.
   */
  private ownsCards(action: Action, seat: SeatId): boolean {
    const ids = 'ids' in action ? action.ids : []
    return ids.every((id) => {
      const card = this.state.cards[id]
      return !!card && (card.hand === null || card.hand === seat)
    })
  }

  private commit(actions: Action[]) {
    for (const a of actions) this.state = apply(this.state, a)
    this.broadcast()
    this.onChange()
  }

  broadcast() {
    for (const [peerId, seat] of this.seatOf) {
      this.wire.snapshot.send({ view: project(this.state, seat), seat }, peerId)
    }
  }

  catchUp(peerId: PeerId) {
    const seat = this.seatOf.get(peerId)
    if (!seat) return
    this.wire.snapshot.send({ view: project(this.state, seat), seat }, peerId)
  }

  // -- setting the table ---------------------------------------------------

  /** New deck, shuffled, dealt out, and whatever is left laid out. */
  setup(presetId: string) {
    const preset = presetById(presetId)
    const deck = cryptoShuffle(preset.cards())
    const seats = this.state.seats

    // Deal first, so only what is left over goes onto the table.
    const hands: { seat: SeatId; cards: CardId[] }[] = []
    let cut = 0
    if (preset.deal !== 0 && seats.length > 0) {
      const each = preset.deal === -1 ? Math.floor(deck.length / seats.length) : preset.deal
      for (const seat of seats) {
        const hand = deck.slice(cut, cut + each)
        cut += hand.length
        if (hand.length) hands.push({ seat: seat.id, cards: hand })
      }
    }

    const actions: Action[] = [
      {
        t: 'reset',
        deckName: preset.name,
        cards: [
          ...place(preset, deck.slice(cut)),
          // Dealt cards need to exist before they can be taken into a hand.
          ...deck.slice(0, cut).map((id) => ({ id, faceUp: false, x: TABLE_W / 2, y: TABLE_H / 2 })),
        ],
      },
    ]
    // The reset lays out every card; dealt cards are then lifted into hands.
    for (const h of hands) {
      actions.push({ t: 'take', ids: h.cards, seat: h.seat })
    }
    this.commit(actions)
  }

  /** Shuffle a pile in place: same spot, new order. */
  shuffleStack(ids: CardId[]) {
    if (ids.length < 2) return
    this.commit([{ t: 'reorder', ids: cryptoShuffle(ids) }])
  }

  /** Everything on the table and in every hand, back into one face-down pile. */
  gather() {
    const all = Object.values(this.state.cards).map((c) => c.id)
    if (!all.length) return
    this.commit([
      { t: 'play', ids: all, x: TABLE_W / 2, y: TABLE_H / 2, faceUp: false },
      { t: 'reorder', ids: cryptoShuffle(all) },
    ])
  }

  /** Deal `count` from the biggest face-down pile to every seated player. */
  deal(count: number) {
    const piles = stacks(this.state)
      .filter((p) => p.length > 1 && p.every((c) => !c.faceUp))
      .sort((a, b) => b.length - a.length)
    const pile = piles[0]
    if (!pile || this.state.seats.length === 0) return

    const top = [...pile].reverse().map((c) => c.id) // deal from the top down
    const actions: Action[] = []
    let i = 0
    for (const seat of this.state.seats) {
      const hand = top.slice(i, i + count)
      i += count
      if (hand.length) actions.push({ t: 'take', ids: hand, seat: seat.id })
    }
    if (actions.length) this.commit(actions)
  }

  handOf(seat: SeatId) {
    return inHand(this.state, seat)
  }

  tableCards() {
    return onTable(this.state)
  }
}

const clean = (n: string) => (n || '').trim().slice(0, 14)

/** Two people called Dad are two seats, not one. */
function unique(name: string, taken: string[]): string {
  const base = name || 'Player'
  if (!taken.some((t) => t.toLowerCase() === base.toLowerCase())) return base
  for (let i = 2; i < 20; i++) {
    const tryName = `${base} ${i}`
    if (!taken.some((t) => t.toLowerCase() === tryName.toLowerCase())) return tryName
  }
  return base
}

/** Seat management belongs to the host; everything else is fair game. */
export function allowed(action: Action, _seat: SeatId): boolean {
  return !['seat_add', 'seat_remove', 'seat_name', 'seat_here', 'reset'].includes(action.t)
}
