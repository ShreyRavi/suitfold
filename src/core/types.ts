// The table layer. Every card game suitfold will ever run is expressed in these
// primitives: cards live in zones, and games move them between zones.
//
// Nothing in this file knows what poker is.

export type CardId = string // "AS" | "TD" | "2C" | "X1" (joker)
export type SeatId = string
export type ZoneId = string

export type ZoneKind = 'deck' | 'discard' | 'hand' | 'board' | 'trick' | 'pile'

/** Who may see the *faces* of the cards in this zone. */
export type Visibility =
  | 'public' // everyone sees faces
  | 'owner' // only the owning seat sees faces
  | 'hidden' // nobody sees faces (face-down deck)

/** Rendering hint for the client. Not load-bearing on the server. */
export type ZoneLayout = 'stack' | 'fan' | 'row' | 'grid'

export interface Zone {
  id: ZoneId
  kind: ZoneKind
  owner: SeatId | null // null = shared
  visibility: Visibility
  ordered: boolean
  layout: ZoneLayout
  label: string
}

export interface Seat {
  id: SeatId
  name: string
  connected: boolean
  /** Seat exists but the player stood up. Chips stay parked here. */
  away: boolean
  /** Chips. Unused when the room has counters off. */
  stack: number
}

export type GameMode = 'sandbox' | 'poker' | 'rummy' | 'bluff' | 'blackjack' | 'uno'

export interface RoomSettings {
  mode: GameMode
  /** Sandbox furniture preset. Ignored in poker. */
  layout: SandboxLayout
  counters: boolean // chips on/off
  smallBlind: number
  bigBlind: number
  startingStack: number
  muckedReveal: boolean
  autoApprove: boolean
  jokers: boolean
}

export type SandboxLayout = 'deck-only' | 'deal-5' | 'deal-7' | 'deal-13' | 'trick' | 'everything'

/**
 * The generic table. `cards` is the source of truth for where every card is;
 * a card id appears in exactly one zone.
 */
export interface TableState {
  seats: Seat[]
  zones: Record<ZoneId, Zone>
  cards: Record<ZoneId, CardId[]>
  faceUp: Record<CardId, boolean>
  /** Temporary visibility widening — this is what the mucked reveal uses. */
  revealed: Record<ZoneId, true>
  turn: SeatId | null
  button: SeatId | null
}

// ---------------------------------------------------------------------------
// Events. The log is made of these. Core events mutate TableState; game events
// are handed to the active module's applier.
// ---------------------------------------------------------------------------

export type CoreEvent =
  | { t: 'room_opened'; settings: RoomSettings }
  | { t: 'settings_changed'; settings: Partial<RoomSettings> }
  | { t: 'seat_added'; seatId: SeatId; name: string; stack: number }
  | { t: 'seat_renamed'; seatId: SeatId; name: string }
  | { t: 'seat_connected'; seatId: SeatId; connected: boolean }
  | { t: 'seat_away'; seatId: SeatId; away: boolean }
  | { t: 'zones_set'; zones: Zone[] }
  | { t: 'cards_dealt_into'; zoneId: ZoneId; cardIds: CardId[]; faceUp: boolean }
  | { t: 'cards_moved'; cardIds: CardId[]; from: ZoneId; to: ZoneId; faceUp?: boolean; index?: number }
  | { t: 'zone_shuffled'; zoneId: ZoneId; order: CardId[] }
  | { t: 'cards_flipped'; cardIds: CardId[]; faceUp: boolean }
  | { t: 'zones_revealed'; zoneIds: ZoneId[] }
  | { t: 'reveals_cleared' }
  | { t: 'counter_adjusted'; seatId: SeatId; delta: number; reason: string }
  | { t: 'restack'; seatId: SeatId; amount: number }
  | { t: 'turn_changed'; seatId: SeatId | null }
  | { t: 'button_moved'; seatId: SeatId | null }
  | { t: 'table_opened'; startingStack: number }

export type PokerEvent =
  | { t: 'hand_started'; deck: CardId[]; button: SeatId; players: SeatId[]; sb: number; bb: number }
  | {
      t: 'blind_posted'
      seatId: SeatId
      /** What this seat could actually put in. Less than `nominal` when short. */
      amount: number
      /** The room's blind. A short all-in big blind still opens the betting for
       *  the full amount, so this - not `amount` - sets the bet to match. */
      nominal: number
      kind: 'sb' | 'bb'
      allIn: boolean
    }
  | { t: 'acted'; seatId: SeatId; action: PokerActionKind; amount: number; allIn: boolean }
  | { t: 'street_advanced'; street: Street }
  | { t: 'uncalled_returned'; seatId: SeatId; amount: number }
  | { t: 'pots_built'; pots: Pot[] }
  | { t: 'pot_awarded'; potIndex: number; seatIds: SeatId[]; amount: number; odd: SeatId | null; description: string }
  | { t: 'hand_completed'; showdown: boolean }

export type PokerActionKind = 'fold' | 'check' | 'call' | 'bet' | 'raise'
export type Street = 'preflop' | 'flop' | 'turn' | 'river' | 'showdown'

export interface Pot {
  amount: number
  eligible: SeatId[]
}

export interface MeldGroup {
  kind: 'pure-run' | 'run' | 'set'
  cards: CardId[]
  jokers: CardId[]
}

export type RummyEvent =
  | { t: 'rummy_started'; players: SeatId[]; deck: CardId[] }
  | { t: 'rummy_drew'; seatId: SeatId; from: 'closed' | 'open' }
  | { t: 'rummy_discarded'; seatId: SeatId; cardId: CardId }
  | { t: 'rummy_declared'; seatId: SeatId; groups: MeldGroup[] }

export type GameEvent = PokerEvent | RummyEvent
export type Event = CoreEvent | GameEvent

/**
 * An event with its ordering key. The log lives in memory for the length of a
 * session: it is what late joiners replay to catch up and what the action log
 * is narrated from. Nothing is written to disk — it is just a game.
 */
export interface LoggedEvent {
  seq: number
  e: Event
}

// ---------------------------------------------------------------------------
// Commands and decisions
// ---------------------------------------------------------------------------

export type Command =
  // table-layer commands (sandbox uses these directly; poker rejects most)
  | { c: 'move'; seatId: SeatId; cardIds: CardId[]; from: ZoneId; to: ZoneId; faceUp?: boolean }
  | { c: 'shuffle'; seatId: SeatId; zoneId: ZoneId }
  | { c: 'flip'; seatId: SeatId; cardIds: CardId[]; faceUp: boolean }
  | { c: 'deal'; seatId: SeatId; from: ZoneId; count: number; faceUp: boolean }
  | { c: 'gather'; seatId: SeatId; to: ZoneId }
  | { c: 'adjust'; seatId: SeatId; target: SeatId; delta: number; reason: string }
  // poker commands
  | { c: 'poker_action'; seatId: SeatId; action: PokerActionKind; amount?: number }
  | { c: 'deal_hand'; seatId: SeatId }
  // host commands
  | { c: 'force_fold'; seatId: SeatId; target: SeatId }
  | { c: 'restack'; seatId: SeatId; target: SeatId; amount: number }
  | { c: 'stand_up'; seatId: SeatId }
  | { c: 'sit_down'; seatId: SeatId }
  | { c: 'reset_table'; seatId: SeatId }
  // rummy
  | { c: 'draw'; seatId: SeatId; from: 'closed' | 'open' }
  | { c: 'discard'; seatId: SeatId; cardId: CardId }
  | { c: 'declare'; seatId: SeatId; cardId: CardId }
  // bluff
  | { c: 'claim'; seatId: SeatId; cardIds: CardId[]; rank: string }
  | { c: 'challenge'; seatId: SeatId }
  | { c: 'pass'; seatId: SeatId }
  // blackjack
  | { c: 'hit'; seatId: SeatId }
  | { c: 'stand'; seatId: SeatId }
  | { c: 'bet'; seatId: SeatId; amount: number }
  // uno
  | { c: 'play'; seatId: SeatId; cardId: CardId; colour?: string }

export type RejectReason =
  | 'not-your-turn'
  | 'not-host'
  | 'illegal-move'
  | 'zone-not-visible'
  | 'card-not-there'
  | 'below-min-raise'
  | 'action-not-reopened'
  | 'insufficient-chips'
  | 'wrong-mode'
  | 'hand-in-progress'
  | 'not-enough-players'
  | 'restack-mid-hand'
  | 'nothing-to-do'
  | 'must-draw-first'
  | 'must-discard'
  | 'invalid-declaration'
  | 'not-playable'

export type Decision =
  | { ok: true; events: Event[] }
  /** `detail` carries a game-specific explanation, e.g. why a rummy hand is
   *  not a valid declaration. Shown to the player instead of a bare code. */
  | { ok: false; reason: RejectReason; detail?: string }

export const ok = (events: Event[]): Decision => ({ ok: true, events })
export const reject = (reason: RejectReason, detail?: string): Decision => ({
  ok: false,
  reason,
  ...(detail ? { detail } : {}),
})
