import type { Action, CardId, Note, SeatId, TableState } from '../table/model.ts'
import {
  CARD_GAP,
  FACES,
  WIRE,
  TABLE_H,
  TABLE_W,
  apply,
  describe,
  emptyTable,
  inHand,
  mentions,
  onTable,
  project,
  record,
  stacks,
} from '../table/model.ts'
import { cryptoShuffle, place, presetById } from '../table/deck.ts'
import { SEAT_COLOURS, type PeerId, type Wire } from './peers.ts'
import type { Command, Dealer } from './dealer.ts'
import { keep } from './keep.ts'

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
  /** Peers the host has already let in, so a reconnect does not knock again. */
  private welcome = new Set<PeerId>()
  private peerOf = new Map<SeatId, PeerId>()
  /**
   * People who have knocked and are waiting to be let in.
   *
   * Knowing the code gets you as far as this list and no further: no seat, no
   * snapshots, nothing of the game at all. Somebody who is actually at the
   * table decides, which is a better door than a secret for a game played by
   * people who know each other.
   */
  knocking: Knock[] = []

  /** Recent tables, so a mis-drag or a wrong deal can be taken back. */
  private history: TableState[] = []
  /**
   * Bumped on every change. Clients compare it against their own and ask for
   * the table back when it does not match.
   */
  private rev = 0
  /** Which browser is in which seat, so a reload comes back to its own cards. */
  private tokenOf = new Map<string, SeatId>()
  private beat: ReturnType<typeof setInterval> | null = null

  constructor(
    private wire: Wire,
    readonly mySeat: SeatId,
    private onChange: () => void,
    /** For the crash net. Nothing is written without it. */
    private code = '',
  ) {
    this.wire.hello.on((hello, from) => this.seat(from, hello.name, hello.emoji, hello.token))
    this.wire.action.on((action, from) => this.fromPeer(action, from))
    this.wire.resync.on((_, from) => this.catchUp(from))
    this.wire.command.on((cmd, from) => {
      const seat = this.seatOf.get(from)
      if (seat) this.command(cmd, seat)
    })
    this.wire.onPeerLeave((id) => this.dropped(id))

    // Say where we are, often. It is four bytes and it is the only thing that
    // lets a client notice it has missed something.
    this.beat = setInterval(() => this.wire.ping.send(this.rev), 2500)
  }

  // -- seating -------------------------------------------------------------

  private colour(i: number) {
    return SEAT_COLOURS[i % SEAT_COLOURS.length]!
  }

  seatSelf(name: string, emoji?: string) {
    this.dealer = this.mySeat
    this.commit([
      {
        t: 'seat_add',
        id: this.mySeat,
        name: clean(name) || 'Host',
        colour: this.colour(0),
        emoji: emoji || this.freeFace(),
      },
    ])
  }

  /**
   * A face nobody at the table is already wearing, so two people who both
   * picked the wolf do not become indistinguishable.
   */
  private freeFace(wanted?: string, except?: SeatId) {
    const taken = new Set(this.state.seats.filter((s) => s.id !== except).map((s) => s.emoji))
    if (wanted && !taken.has(wanted)) return wanted
    return FACES.find((f) => !taken.has(f)) ?? FACES[this.state.seats.length % FACES.length]!
  }

  /**
   * Whoever is allowed to deal. Normally the person holding the deck, which is
   * the same tab. When the table is held somewhere with nobody sitting at it -
   * a little app on a Mac - it is the first person who sat down.
   */
  dealer: SeatId | null = null

  /**
   * Carry out an instruction from the dealer. Anybody else asking is ignored:
   * these are the moves that would let one player quietly rearrange the game.
   */
  command(cmd: Command, from: SeatId) {
    if (this.dealer !== null && from !== this.dealer) return
    switch (cmd.c) {
      case 'setup':
        return this.setup(cmd.preset)
      case 'dealHand':
        return this.dealHand()
      case 'deal':
        return this.deal({ count: cmd.count, seats: cmd.seats, from: cmd.from, faceUp: cmd.faceUp })
      case 'gather':
        return this.gather()
      case 'shuffle':
        return this.shuffleStack(cmd.ids)
      case 'undo':
        return this.undo()
      case 'roll':
        return this.roll()
      case 'clock':
        return cmd.seconds === null ? this.stopClock() : this.startClock(cmd.seconds)
      case 'puckAdd':
        return this.addPuck(cmd.label, cmd.hint)
      case 'puckRemove':
        return this.removePuck(cmd.id)
      case 'score':
        return this.score(cmd.seat, cmd.by)
      case 'scoresClear':
        return this.clearScores()
      case 'logClear':
        return this.clearLog()
      case 'buyIn':
        return this.buyIn(cmd.each)
      case 'removeSeat':
        return this.removeSeat(cmd.seat)
    }
  }

  /** Stop the heartbeat. The table is over. */
  close() {
    if (this.beat) clearInterval(this.beat)
    this.beat = null
  }

  private seat(peerId: PeerId, name: string, emoji?: string, token?: string) {
    const existing = this.seatOf.get(peerId)
    if (existing) {
      // The hello repeats until it is acknowledged, so this runs again for a
      // seat that already exists. It has to make the name and the face unique
      // exactly as the first one did, or the second hello quietly undoes the
      // work of the first and two people end up identical.
      const others = this.state.seats.filter((s) => s.id !== existing)
      const settled = unique(clean(name), others.map((s) => s.name))
      const face = this.freeFace(emoji, existing)
      const seat = this.state.seats.find((s) => s.id === existing)
      if (seat?.name === settled && (!emoji || seat.emoji === face)) return
      this.commit([{ t: 'seat_name', id: existing, name: settled, emoji: face }])
      return
    }
    // Someone who dropped and came back takes their own seat again. If their
    // browser remembers who it was, that settles it outright. Otherwise fall
    // back to the name, with two rules that keep this from handing one player
    // another player's cards:
    //   - never the host's own seat, which has no peer and so always looks free
    //   - only a seat currently marked disconnected, not merely unclaimed
    const byToken = token ? this.tokenOf.get(token) : undefined
    const known = byToken ? this.state.seats.find((s) => s.id === byToken && !this.peerOf.has(s.id)) : undefined
    // A browser that knows who it is has said so. If it is somebody new, it is
    // somebody new, whatever they typed in the name box - otherwise a second
    // person called Dad would walk into the first Dad's seat and his cards.
    // The name is only a fallback for a browser with no memory of itself.
    const byName = token
      ? undefined
      : this.state.seats.find(
          (s) =>
            s.id !== this.mySeat &&
            !s.connected &&
            !this.peerOf.has(s.id) &&
            s.name.toLowerCase() === clean(name).toLowerCase(),
        )
    const returning = known ?? byName

    // Somebody coming back is somebody already let in: their phone slept, or
    // the wifi dropped, and making them knock again mid-hand would be worse
    // than useless. Only strangers wait.
    if (!returning && !this.welcome.has(peerId)) {
      if (!this.knocking.some((k) => k.peer === peerId)) {
        this.knocking.push({
          peer: peerId,
          name: clean(name) || 'Somebody',
          emoji: emoji || this.freeFace(),
          at: this.now(),
          ...(token ? { token } : {}),
        })
        this.onChange()
      }
      this.wire.door.send({ state: 'waiting' }, peerId)
      return
    }

    const id = returning?.id ?? `s${this.state.seats.length + 1}`
    // Nobody is sitting in the deck's own seat when the table is held
    // elsewhere, so the first person through the door deals.
    if (this.dealer === null) this.dealer = id
    this.seatOf.set(peerId, id)
    this.peerOf.set(id, peerId)
    if (token) this.tokenOf.set(token, id)

    const actions: Action[] = returning
      ? [{ t: 'seat_here', id, connected: true }]
      : [
          {
            t: 'seat_add',
            id,
            name: unique(clean(name), this.state.seats.map((s) => s.name)),
            colour: this.colour(this.state.seats.length),
            emoji: this.freeFace(emoji),
          },
        ]
    this.commit(actions)
  }

  private dropped(peerId: PeerId) {
    // Somebody who leaves the queue without being let in is simply gone.
    if (this.knocking.some((k) => k.peer === peerId)) {
      this.knocking = this.knocking.filter((k) => k.peer !== peerId)
      this.onChange()
    }
    const seat = this.seatOf.get(peerId)
    if (!seat) return
    this.seatOf.delete(peerId)
    this.peerOf.delete(seat)
    // Their cards stay in their hand. Phones background constantly and a
    // dropped connection is not someone leaving the table.
    this.commit([{ t: 'seat_here', id: seat, connected: false }])
  }

  /**
   * An action exactly as if it had arrived on that seat's channel, permission
   * checks and all. Tests only, and deliberately the same path a real peer
   * takes rather than a shortcut around it.
   */
  execAs(action: Action, seat: SeatId) {
    if (action.t === 'say') return this.say(seat, action.text)
    if (!allowed(action, seat)) return
    if (!this.ownsCards(action, seat)) return
    this.commit([action], seat)
  }

  /** A peer going quiet, without a peer. Tests only. */
  droppedForTest(peerId: PeerId) {
    this.dropped(peerId)
  }

  /**
   * A peer that knocks and is let in, in one go. Tests only, and the common
   * case: most tests are about what happens once somebody is at the table
   * rather than about the door itself.
   */
  joinForTest(peerId: PeerId, name: string, emoji?: string, token?: string) {
    this.seat(peerId, name, emoji, token)
    if (this.knocking.some((k) => k.peer === peerId)) this.admit(peerId)
  }

  /** Seating over the wire, without a wire. Tests only. */
  helloForTest(peerId: PeerId, name: string, emoji?: string, token?: string) {
    this.seat(peerId, name, emoji, token)
  }

  /** Seating somebody without a live connection. Tests only. */
  addSeatForTest(id: SeatId, name: string) {
    this.commit([
      { t: 'seat_add', id, name, colour: this.colour(this.state.seats.length), emoji: this.freeFace() },
    ])
  }

  /** Let somebody in. They are seated exactly as anybody else would be. */
  admit(peer: PeerId) {
    const knock = this.knocking.find((k) => k.peer === peer)
    if (!knock) return
    this.knocking = this.knocking.filter((k) => k.peer !== peer)
    this.welcome.add(peer)
    this.seat(peer, knock.name, knock.emoji, knock.token)
    this.onChange()
  }

  /** Turn somebody away. They are told, rather than left wondering. */
  refuse(peer: PeerId) {
    this.knocking = this.knocking.filter((k) => k.peer !== peer)
    this.wire.door.send({ state: 'refused' }, peer)
    this.onChange()
  }

  /** Only the host can do this - it dumps that player's hand back on the table. */
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
    if (action.t === 'say') return this.say(seat, action.text)
    if (!allowed(action, seat)) return
    if (!this.ownsCards(action, seat)) return
    this.commit([action], seat)
  }

  /** From the host's own hands. */
  local(action: Action) {
    if (action.t === 'say') return this.say(this.mySeat, action.text)
    if (!this.ownsCards(action, this.mySeat)) return
    this.commit([action], this.mySeat)
  }

  /**
   * Chat is a log line and nothing else. It goes through the host like every
   * other action so that everybody's list is in the same order.
   */
  say(seat: SeatId, text: string) {
    const said = text.trim().slice(0, 200)
    if (!said) return
    const to = mentions(said, this.state.seats).filter((id) => id !== seat)
    this.state = record(this.state, { kind: 'chat', text: said, seat, to }, seat, this.now())
    this.save()
    this.broadcast()
    this.onChange()
  }

  /** Wall clock, in one place, so tests can pin it. */
  private now() {
    return Date.now()
  }

  /** Wipe the history. Whoever is holding the deck only. */
  clearLog() {
    this.commit([{ t: 'log_clear' }])
  }

  /**
   * You may move a card that is on the table or in your own hand. You may not
   * reach into somebody else's hand - which, since the projection never sent
   * you those ids, mostly means this catches a client that made them up.
   */
  private ownsCards(action: Action, seat: SeatId): boolean {
    const ids = 'ids' in action ? action.ids : []
    return ids.every((id) => {
      const card = this.state.cards[id]
      return !!card && (card.hand === null || card.hand === seat)
    })
  }

  /**
   * The one place the table changes.
   *
   * `by` is who did it, which the log needs and nothing else does. `note` is
   * for the compound moves - a deal is a dozen actions and one sentence, so
   * dealing says "dealt 2 each" rather than filling the log with "picked up".
   */
  private commit(actions: Action[], by: SeatId | null = this.mySeat, note?: Note) {
    // Seat bookkeeping is not something anyone wants to undo.
    const worthUndoing = actions.some((a) => !a.t.startsWith('seat_'))
    if (worthUndoing) {
      this.history.push(this.state)
      if (this.history.length > 40) this.history.shift()
    }
    const before = this.state
    for (const a of actions) this.state = apply(this.state, a)

    const at = this.now()
    if (note) {
      this.state = record(this.state, note, by, at)
    } else {
      // Describe against the table as it was, so "took the pot" knows the size
      // of the pot it took.
      let seen = before
      for (const a of actions) {
        const line = describe(a, seen)
        seen = apply(seen, a)
        if (line) this.state = record(this.state, line, by, at)
      }
    }

    this.save()
    this.broadcast()
    this.onChange()
  }

  /** Write the table to this tab, so a reload is recoverable. */
  private save() {
    if (this.code) keep(this.code, this.state)
  }

  /** Carry on a table this tab was holding before it went away. */
  restore(state: TableState) {
    this.state = state
    this.save()
    this.broadcast()
    this.onChange()
  }

  get canUndo() {
    return this.history.length > 0
  }

  /** Put the table back the way it was. Host only. */
  undo() {
    const previous = this.history.pop()
    if (!previous) return
    // Seats are live connection state, so they survive an undo of the cards.
    // So does the log: history is a record of what happened, and taking a move
    // back is itself something that happened.
    this.state = record(
      { ...previous, seats: this.state.seats, log: this.state.log, logN: this.state.logN },
      { kind: 'game', text: 'took that back' },
      this.mySeat,
      this.now(),
    )
    this.save()
    this.broadcast()
    this.onChange()
  }

  broadcast() {
    this.rev++
    for (const [peerId, seat] of this.seatOf) {
      this.wire.snapshot.send({ view: project(this.state, seat), seat, rev: this.rev, dealer: this.dealer, wire: WIRE }, peerId)
    }
    this.wire.ping.send(this.rev)
  }

  catchUp(peerId: PeerId) {
    const seat = this.seatOf.get(peerId)
    if (!seat) return
    this.wire.snapshot.send({ view: project(this.state, seat), seat, rev: this.rev, dealer: this.dealer, wire: WIRE }, peerId)
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
    const asked = typeof preset.deal === 'function' ? preset.deal(seats.length) : preset.deal
    // Nothing stops a table of seven picking a game meant for two, and when
    // they do, five people getting a hand and two getting nothing is the worst
    // possible answer. Deal what there is, evenly.
    const room = seats.length ? Math.floor(deck.length / seats.length) : 0
    const each = asked === -1 ? -1 : Math.min(asked, room)
    if (each !== 0 && seats.length > 0) {
      if (each === -1) {
        // The whole deck, round by round, exactly as a person deals it. It used
        // to divide and round down, which left the remainder sitting on the
        // table: at three players Bluff started with a card nobody held, and
        // Old Maid lost the odd queen that is the entire point of the game.
        const perSeat = new Map<SeatId, CardId[]>(seats.map((s) => [s.id, []]))
        while (cut < deck.length) {
          for (const seat of seats) {
            const card = deck[cut++]
            if (!card) break
            perSeat.get(seat.id)!.push(card)
          }
        }
        for (const [seat, cards] of perSeat) if (cards.length) hands.push({ seat, cards })
      } else {
        for (const seat of seats) {
          const hand = deck.slice(cut, cut + each)
          cut += hand.length
          if (hand.length) hands.push({ seat: seat.id, cards: hand })
        }
      }
    }

    const slots = preset.slots?.(seats.length) ?? []
    const actions: Action[] = [
      // A new game buys everyone in, or clears the chips away entirely.
      { t: 'chips_start', each: preset.chips ?? 0, on: preset.chips !== undefined },
      {
        t: 'reset',
        deckName: preset.name,
        game: preset.id,
        slots,
        pucks: preset.pucks?.(seats.length) ?? [],
        dice: preset.dice?.() ?? [],
        lines: preset.lines?.() ?? [],
        cards: [
          ...place(preset, deck.slice(cut), slots),
          // Dealt cards need to exist before they can be taken into a hand.
          ...deck.slice(0, cut).map((id) => ({ id, faceUp: false, x: TABLE_W / 2, y: TABLE_H / 2 })),
        ],
      },
    ]
    // The reset lays out every card; dealt cards are then lifted into hands.
    for (const h of hands) {
      actions.push({ t: 'take', ids: h.cards, seat: h.seat })
    }
    this.commit(actions, this.mySeat, { kind: 'game', text: `set the table for ${preset.name}` })
  }

  /**
   * One press: gather everything, shuffle, deal a hand of whatever game is set
   * up, and lay the middle cards out face down so they can be turned over as
   * the hand goes. It is what a dealer does in one motion.
   */
  dealHand() {
    const preset = presetById(this.state.game)
    const spec = preset.hand
    const seats = this.state.seats
    if (!spec || seats.length === 0) return

    const slots = preset.slots?.(seats.length) ?? []
    const deck = cryptoShuffle(Object.keys(this.state.cards))
    const home = slots.find((s) => s.id === 'draw' || s.id === 'deck')
    const rest = { x: home?.x ?? TABLE_W / 2, y: home?.y ?? TABLE_H / 2 }

    let cut = 0
    const wanted = typeof spec.each === 'function' ? spec.each(seats.length) : spec.each
    const perHand = Math.min(wanted, Math.floor(deck.length / Math.max(seats.length, 1)))
    const hands: { seat: SeatId; cards: CardId[] }[] = []
    for (const seat of seats) {
      const hand = deck.slice(cut, cut + perHand)
      cut += hand.length
      if (hand.length) hands.push({ seat: seat.id, cards: hand })
    }

    // The middle cards get their own spots so each can be turned individually.
    const board: { id: CardId; x: number; y: number }[] = []
    if (spec.board) {
      const slot = slots.find((s) => s.id === (spec.boardSlot ?? 'board'))
      const cx = slot?.x ?? TABLE_W / 2
      const cy = slot?.y ?? TABLE_H / 2
      const gap = CARD_GAP
      const left = cx - ((spec.board - 1) * gap) / 2
      for (let i = 0; i < spec.board; i++) {
        const card = deck[cut++]
        if (card) board.push({ id: card, x: left + i * gap, y: cy })
      }
    }

    const actions: Action[] = [
      // Everything back to the deck first, so a half-played table deals clean.
      { t: 'play', ids: deck, x: rest.x, y: rest.y, faceUp: false },
      { t: 'reorder', ids: deck },
    ]
    for (const h of hands) actions.push({ t: 'take', ids: h.cards, seat: h.seat })
    for (const b of board) actions.push({ t: 'move', ids: [b.id], x: b.x, y: b.y })
    this.commit(actions, this.mySeat, {
      kind: 'game',
      text: `dealt a new hand, ${perHand} each`,
    })
  }

  /** Does the game that is set up know what one hand looks like? */
  get canDealHand() {
    return !!presetById(this.state.game).hand && this.state.seats.length > 0 && Object.keys(this.state.cards).length > 0
  }

  /** Shuffle a pile in place: same spot, new order. */
  shuffleStack(ids: CardId[]) {
    if (ids.length < 2) return
    this.commit([{ t: 'reorder', ids: cryptoShuffle(ids) }], this.mySeat, {
      kind: 'card',
      text: `shuffled ${ids.length} cards`,
    })
  }

  /** Where the deck lives on this table, if the game marked a spot for it. */
  private deckHome() {
    const home = this.state.slots.find((s) => s.id === 'draw' || s.id === 'deck')
    return { x: home?.x ?? TABLE_W / 2, y: home?.y ?? TABLE_H / 2 }
  }

  /**
   * Everything on the table and in every hand, back into one face-down pile -
   * on the deck's own spot when the game marked one, which is where you would
   * put a gathered deck on a real table.
   */
  gather() {
    const all = Object.values(this.state.cards).map((c) => c.id)
    if (!all.length) return
    const home = this.deckHome()
    this.commit(
      [
        { t: 'play', ids: all, x: home.x, y: home.y, faceUp: false },
        { t: 'reorder', ids: cryptoShuffle(all) },
      ],
      this.mySeat,
      { kind: 'card', text: `gathered ${all.length} cards back up` },
    )
  }

  /** Every face-down pile, biggest first - the things you can deal from. */
  sources(): { x: number; y: number; count: number }[] {
    return stacks(this.state)
      .filter((p) => p.length > 0 && p.every((c) => !c.faceUp))
      .map((p) => ({ x: p[0]!.x, y: p[0]!.y, count: p.length }))
      .sort((a, b) => b.count - a.count)
  }

  /**
   * Deal from a named pile to named seats. Everything is explicit so the panel
   * can say exactly what will happen before you press it.
   */
  deal(opts: { count: number; seats: SeatId[]; from?: { x: number; y: number }; faceUp?: boolean }) {
    const source = opts.from ?? this.sources()[0]
    // count === -1 means "all of them", which is how Bluff, War and Old Maid
    // start: the whole pile goes out and the table is left empty.
    if (!source || opts.seats.length === 0 || (opts.count < 1 && opts.count !== -1)) return

    const pile = stacks(this.state).find((p) => p[0]!.x === source.x && p[0]!.y === source.y)
    if (!pile) return

    const top = [...pile].reverse().map((c) => c.id) // off the top, like a real deal
    const actions: Action[] = []
    let i = 0
    // Round by round, so a short pile spreads fairly instead of loading the
    // first player up and leaving the last with nothing.
    const rounds = opts.count === -1 ? Math.ceil(top.length / opts.seats.length) : opts.count
    const perSeat = new Map<SeatId, CardId[]>()
    for (let round = 0; round < rounds; round++) {
      for (const seat of opts.seats) {
        const card = top[i++]
        if (!card) break
        perSeat.set(seat, [...(perSeat.get(seat) ?? []), card])
      }
    }
    for (const [seat, ids] of perSeat) {
      if (!ids.length) continue
      actions.push({ t: 'take', ids, seat })
      if (opts.faceUp) actions.push({ t: 'play', ids, x: source.x, y: source.y, faceUp: true })
    }
    if (actions.length) {
      const dealt = [...perSeat.values()].reduce((n, ids) => n + ids.length, 0)
      const who = opts.seats.length === this.state.seats.length ? 'everyone' : 'one player'
      this.commit(actions, this.mySeat, {
        kind: 'card',
        text: `dealt ${dealt} ${dealt === 1 ? 'card' : 'cards'} to ${who}`,
      })
    }
  }

  bet(seat: SeatId, amount: number) {
    this.commit([{ t: 'bet', seat, amount }], seat)
  }

  takePot(seat: SeatId, amount?: number) {
    this.commit([{ t: 'take_pot', seat, ...(amount === undefined ? {} : { amount }) }], seat)
  }

  /**
   * A marker with whatever is written on it. Poker gets its blinds laid out for
   * it, but every game has something worth remembering - whose deal it is, who
   * is calling - and a disc on the felt is how a real table remembers it.
   */
  addPuck(label: string, hint: string) {
    const short = label.trim().slice(0, 3).toUpperCase()
    if (!short) return
    const id = `pk-${short.toLowerCase()}-${this.state.pucks.length + 1}`
    // Along the bottom edge, beside whatever is already there.
    this.commit([
      {
        t: 'puck_add',
        id,
        label: short,
        hint: hint.trim().slice(0, 40) || short,
        x: TABLE_W / 2 - 470 + (this.state.pucks.length % 8) * 56,
        y: TABLE_H / 2 + 60,
      },
    ])
  }

  removePuck(id: string) {
    this.commit([{ t: 'puck_remove', id }])
  }

  /**
   * Rolling belongs to the host for the same reason shuffling does: it has to
   * be unguessable, and a client that invented its own numbers would be the
   * whole game. Anybody may ask for a roll; only this tab decides what came up.
   */
  roll() {
    const loose = this.state.dice.filter((d) => !d.held)
    if (!loose.length) return
    const bytes = new Uint32Array(loose.length)
    crypto.getRandomValues(bytes)
    const values: Record<string, number> = {}
    loose.forEach((d, i) => {
      values[d.id] = bytes[i]! % d.faces
    })
    // Numbered dice read one to six; lettered ones index their own faces.
    for (const d of loose) if (!d.letters) values[d.id] = (values[d.id] ?? 0) + 1
    this.commit([{ t: 'dice_roll', values }])
  }

  startClock(seconds: number) {
    this.commit([{ t: 'timer', endsAt: this.now() + seconds * 1000, seconds }])
  }

  stopClock() {
    this.commit([{ t: 'timer', endsAt: null, seconds: this.state.timer.seconds }])
  }

  adjustChips(seat: SeatId, by: number) {
    this.commit([{ t: 'chips_adjust', seat, by }])
  }

  buyIn(each: number) {
    this.commit([{ t: 'chips_start', each, on: each > 0 }])
  }

  score(seat: SeatId, by: number) {
    this.commit([{ t: 'score', seat, by }])
  }

  clearScores() {
    this.commit([{ t: 'scores_clear' }])
  }

  /** Turn the top card of a pile face up, the way you start a discard pile. */
  turnUp(at: { x: number; y: number }) {
    const pile = stacks(this.state).find((p) => p[0]!.x === at.x && p[0]!.y === at.y)
    const top = pile?.[pile.length - 1]
    if (!top) return
    this.commit(
      [{ t: 'move', ids: [top.id], x: at.x + 124, y: at.y }, { t: 'flip', ids: [top.id], faceUp: true }],
      this.mySeat,
      { kind: 'card', text: 'turned one face up' },
    )
  }

  handOf(seat: SeatId) {
    return inHand(this.state, seat)
  }

  tableCards() {
    return onTable(this.state)
  }
}

/** Somebody at the door, waiting to be let in. */
export interface Knock {
  peer: PeerId
  name: string
  emoji: string
  at: number
  token?: string
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
export function allowed(action: Action, seat: SeatId): boolean {
  // Setting the table and correcting somebody's stack belong to the host.
  if (
    [
      'seat_add',
      'seat_remove',
      'seat_name',
      'seat_here',
      'reset',
      'chips_start',
      'chips_adjust',
      'log_clear',
      'puck_add',
      'puck_remove',
      // Inventing dice values is exactly the thing a client must not do.
      'dice_roll',
      'timer',
    ].includes(action.t)
  ) {
    return false
  }
  // Betting spends your own chips, so it has to be your own seat.
  if (action.t === 'bet') return action.seat === seat
  // Anyone can shove the dealer button around; it is a reminder, not a rule.
  if (action.t === 'puck') return true
  return true
}
