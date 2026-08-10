import type { Command, Event, LoggedEvent, RoomSettings, SeatId } from '../core/types.ts'
import { apply, initialState, type RoomState } from '../core/state.ts'
import { decide, openTable } from '../core/decide.ts'
import { project } from '../core/project.ts'
import { narrate, type LogEntry } from '../core/narrate.ts'
import { revealDescriptions } from '../games/poker/engine.ts'
import type { PeerId, Snapshot, Wire } from './peers.ts'
import { commit } from './peers.ts'

/**
 * The dealer. Runs in the host's tab and nowhere else.
 *
 * This is the server, minus the server: same pure engine, same event log, same
 * per-seat projection. The log lives in memory for the length of the session
 * because this is a game, not a bank — closing the tab ends the night.
 */
export class HostTable {
  state: RoomState = initialState()
  private log: LoggedEvent[] = []
  private seq = 0
  /** Which seat each connected peer is sitting in. A channel is an identity. */
  private seatOf = new Map<PeerId, SeatId>()
  private peerOf = new Map<SeatId, PeerId>()
  private dealTimer: ReturnType<typeof setTimeout> | null = null
  private deckHash = ''

  constructor(
    private wire: Wire,
    private mySeat: SeatId,
    private onLocalChange: () => void,
  ) {
    this.wire.hello.on((hello, from) => this.seatPeer(from, hello.name))
    this.wire.command.on((cmd, from) => this.handle(cmd, from))
    this.wire.onPeerLeave((id) => this.dropPeer(id))
  }

  // -- seating -------------------------------------------------------------

  /** The host's own seat. No hello, no channel — it is this tab. */
  seatSelf(name: string) {
    this.commit([
      { t: 'seat_added', seatId: this.mySeat, name: name.trim().slice(0, 16) || 'Host',
        stack: this.state.settings.startingStack },
      { t: 'seat_connected', seatId: this.mySeat, connected: true },
    ])
  }

  /**
   * A peer announces a name and gets a seat. Names are how the family knows
   * each other; the seat is bound to the channel, so nobody can take a seat
   * that is already answering on someone else's connection.
   */
  private seatPeer(peerId: PeerId, name: string) {
    const clean = (name || 'Player').trim().slice(0, 16)
    const existing = this.seatOf.get(peerId)
    if (existing) {
      this.commit([{ t: 'seat_renamed', seatId: existing, name: clean }])
      return
    }

    // Reclaim a seat of the same name whose peer has gone (someone who dropped
    // and came back), otherwise take a free one.
    const byName = this.state.table.seats.find(
      (s) => s.name.toLowerCase() === clean.toLowerCase() && !this.peerOf.has(s.id),
    )
    const seatId = byName?.id ?? `seat${this.state.table.seats.length + 1}`

    const events: Event[] = []
    if (!byName) events.push({ t: 'seat_added', seatId, name: clean, stack: this.state.settings.startingStack })
    events.push({ t: 'seat_connected', seatId, connected: true })

    this.seatOf.set(peerId, seatId)
    this.peerOf.set(seatId, peerId)
    this.commit(events)
  }

  private dropPeer(peerId: PeerId) {
    const seatId = this.seatOf.get(peerId)
    if (!seatId) return
    this.seatOf.delete(peerId)
    this.peerOf.delete(seatId)
    // A dropped connection is not leaving the table. Phones background
    // constantly; the seat, the stack and the hand are all untouched.
    this.commit([{ t: 'seat_connected', seatId, connected: false }])
  }

  // -- commands ------------------------------------------------------------

  /** From a peer. `from` is the channel, which is the only identity we trust. */
  private handle(cmd: Command, from: PeerId) {
    const seatId = this.seatOf.get(from)
    if (!seatId) return
    this.exec(cmd, seatId, false, from)
  }

  /** From the host's own UI. */
  local(cmd: Command) {
    this.exec(cmd, this.mySeat, true)
  }

  /** Test seam: seat someone without a peer connection. */
  addSeatForTest(seatId: SeatId, name: string) {
    this.commit([
      { t: 'seat_added', seatId, name, stack: this.state.settings.startingStack },
      { t: 'seat_connected', seatId, connected: true },
    ])
  }

  /** Test seam: put an exact hand in front of a seat, through the log. */
  stackHandForTest(seatId: SeatId, cards: string[]) {
    const zone = `hand:${seatId}`
    const current = this.state.table.cards[zone] ?? []
    const events: Event[] = []
    if (current.length) events.push({ t: 'cards_moved', cardIds: current, from: zone, to: 'deck', faceUp: false })
    events.push({ t: 'cards_moved', cardIds: cards, from: 'deck', to: zone, faceUp: false })
    this.commit(events)
  }

  /** Test seam: run a command as a given seat and report the outcome. */
  execForTest(cmd: Command, actor: SeatId, isHost: boolean): { ok: boolean; reason?: string; detail?: string } {
    if (!authorize(cmd, actor, isHost)) return { ok: false, reason: 'not-host' }
    const d = decide(this.state, cmd)
    if (!d.ok) return { ok: false, reason: d.reason, detail: d.detail }
    this.commit(d.events)
    return { ok: true }
  }

  private exec(cmd: Command, actor: SeatId, isHost: boolean, from?: PeerId) {
    if (!authorize(cmd, actor, isHost)) {
      if (from) this.wire.reject.send({ reason: 'not-host' }, from)
      return
    }
    const d = decide(this.state, cmd)
    if (!d.ok) {
      const message = d.detail ?? d.reason
      if (from) this.wire.reject.send({ reason: message }, from)
      else this.rejectLocally(message)
      return
    }
    this.commit(d.events)
  }

  private localReject: ((reason: string) => void) | null = null
  onLocalReject(fn: (reason: string) => void) {
    this.localReject = fn
  }
  private rejectLocally(reason: string) {
    this.localReject?.(reason)
  }

  // -- host actions --------------------------------------------------------

  changeSettings(settings: Partial<RoomSettings>) {
    this.commit([{ t: 'settings_changed', settings }])
  }

  openTable() {
    const wasOpen = this.state.open
    const events: Event[] = []
    if (!wasOpen) events.push({ t: 'table_opened', startingStack: this.state.settings.startingStack })
    this.commit(events)
    const d = openTable(this.state)
    if (d.ok) {
      void this.recordCommitment(d.events)
      this.commit(d.events)
    }
    return d
  }

  /** Publish a hash of the shuffled deck so the deal can be checked afterwards. */
  private async recordCommitment(events: Event[]) {
    const started = events.find((e) => e.t === 'hand_started')
    if (started && 'deck' in started) {
      this.deckHash = await commit(started.deck as string[])
      this.broadcast([])
    }
  }

  // -- the log -------------------------------------------------------------

  private commit(events: Event[]) {
    if (events.length === 0) {
      this.broadcast([])
      return
    }
    const entries: LogEntry[] = []
    for (const e of events) {
      const logged: LoggedEvent = { seq: ++this.seq, e }
      this.log.push(logged)
      this.state = apply(this.state, e)
      const entry = narrate(logged, this.state)
      if (entry) entries.push(entry)
    }
    // Keep the log bounded. It exists to catch up a returning player and to
    // narrate the action, not to be an archive.
    if (this.log.length > 400) this.log = this.log.slice(-300)

    this.armAutoDeal()
    this.broadcast(entries)
  }

  private broadcast(entries: LogEntry[]) {
    for (const [peerId, seatId] of this.seatOf) {
      this.wire.snapshot.send(this.snapshotFor(seatId), peerId)
    }
    if (entries.length) this.wire.log.send(entries)
    this.onLocalChange()
  }

  snapshotFor(seatId: SeatId | null): Snapshot {
    const snap: Snapshot = {
      view: project(this.state, seatId),
      seq: this.seq,
      seatId,
      deckCommitment: this.deckHash,
    }
    if (this.state.poker.result?.showdown && Object.keys(this.state.table.revealed).length) {
      snap.descriptions = revealDescriptions(this.state)
    }
    return snap
  }

  /** Narrated history, for a player who just arrived or came back. */
  logSince(seq: number): LogEntry[] {
    let s = initialState()
    const out: LogEntry[] = []
    for (const l of this.log) {
      s = apply(s, l.e)
      if (l.seq <= seq) continue
      const entry = narrate(l, s)
      if (entry) out.push(entry)
    }
    return out.slice(-60)
  }

  catchUp(peerId: PeerId) {
    const seatId = this.seatOf.get(peerId)
    if (!seatId) return
    this.wire.snapshot.send(this.snapshotFor(seatId), peerId)
    const entries = this.logSince(0)
    if (entries.length) this.wire.log.send(entries, peerId)
  }

  // -- auto-deal -----------------------------------------------------------

  private armAutoDeal() {
    if (this.dealTimer) clearTimeout(this.dealTimer)
    this.dealTimer = null
    if (this.state.settings.mode !== 'poker') return
    if (!this.state.open) return
    if (this.state.poker.phase !== 'complete') return
    this.dealTimer = setTimeout(() => {
      this.dealTimer = null
      const d = openTable(this.state)
      if (d.ok) {
        void this.recordCommitment(d.events)
        this.commit(d.events)
      }
    }, 6000)
  }

  stop() {
    if (this.dealTimer) clearTimeout(this.dealTimer)
    this.dealTimer = null
  }
}

/** Host-only commands are host-only; everything else acts as its own seat. */
export function authorize(cmd: Command, actor: SeatId, isHost: boolean): boolean {
  const hostOnly = ['force_fold', 'restack', 'reset_table', 'deal', 'gather', 'adjust', 'deal_hand']
  if (hostOnly.includes(cmd.c)) return isHost
  return 'seatId' in cmd && cmd.seatId === actor
}
