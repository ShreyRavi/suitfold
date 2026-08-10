import type { CardId, SeatId, ZoneId } from './types.ts'
import type { RoomState } from './state.ts'
import { pokerView } from '../games/poker/state.ts'

/**
 * THE SECURITY BOUNDARY.
 *
 * Everything the server sends to a client goes through this function. A card
 * face is included only when the viewer is allowed to see it, decided purely
 * from the zone's `visibility` — never from what game is being played.
 *
 * A game module cannot leak a card it has no way to address: modules emit
 * events, events change zones, and zones decide faces. There is no code path
 * where poker (or any future game) hands a face to the wrong socket.
 */

export interface CardView {
  /** Present only when this viewer may see the face. */
  id?: CardId
  faceUp: boolean
}

export interface ZoneView {
  id: ZoneId
  kind: string
  owner: SeatId | null
  layout: string
  label: string
  count: number
  cards: CardView[]
  /** True when this viewer sees faces here — the client uses it for affordances. */
  visible: boolean
}

export interface SeatView {
  id: SeatId
  name: string
  connected: boolean
  away: boolean
  stack: number
  cardCount: number
  isYou: boolean
  isButton: boolean
  isTurn: boolean
}

export interface RoomView {
  you: SeatId | null
  mode: string
  settings: RoomState['settings']
  open: boolean
  seats: SeatView[]
  zones: ZoneView[]
  turn: SeatId | null
  button: SeatId | null
  poker: ReturnType<typeof pokerView>
}

/** Can `viewer` see the faces of cards in `zoneId`? */
export function canSee(state: RoomState, zoneId: ZoneId, viewer: SeatId | null): boolean {
  const zone = state.table.zones[zoneId]
  if (!zone) return false
  if (state.table.revealed[zoneId]) return true // mucked reveal widens visibility
  switch (zone.visibility) {
    case 'public':
      return true
    case 'owner':
      return viewer !== null && zone.owner === viewer
    case 'hidden':
      return false
  }
}

export function project(state: RoomState, viewer: SeatId | null): RoomView {
  const t = state.table

  const zones: ZoneView[] = Object.values(t.zones).map((z) => {
    const ids = t.cards[z.id] ?? []
    const zoneVisible = canSee(state, z.id, viewer)
    return {
      id: z.id,
      kind: z.kind,
      owner: z.owner,
      layout: z.layout,
      label: z.label,
      count: ids.length,
      visible: zoneVisible,
      cards: ids.map((id) => {
        const faceUp = t.faceUp[id] ?? false
        // A card's face is sent when the zone allows it, OR when the card is
        // physically face-up on the table (a face-up card in a shared pile is
        // visible to the room regardless of the zone's default).
        const show = zoneVisible || faceUp
        return show ? { id, faceUp } : { faceUp }
      }),
    }
  })

  const seats: SeatView[] = t.seats.map((s) => ({
    id: s.id,
    name: s.name,
    connected: s.connected,
    away: s.away,
    stack: s.stack,
    cardCount: (t.cards[`hand:${s.id}`] ?? []).length,
    isYou: s.id === viewer,
    isButton: t.button === s.id,
    isTurn: t.turn === s.id,
  }))

  return {
    you: viewer,
    mode: state.settings.mode,
    settings: state.settings,
    open: state.open,
    seats,
    zones,
    turn: t.turn,
    button: t.button,
    poker: pokerView(state, viewer),
  }
}

/**
 * Test helper and audit hook: every card face present anywhere in a projection.
 * Used by the invariant test that asserts no projection ever contains a face the
 * viewer is not entitled to.
 */
export function facesIn(view: RoomView): Set<CardId> {
  const out = new Set<CardId>()
  for (const z of view.zones) for (const c of z.cards) if (c.id) out.add(c.id)
  return out
}
