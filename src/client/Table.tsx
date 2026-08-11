import { useCallback, useEffect, useRef, useState } from 'react'
import type { CardId, SeatId, TableView } from '../table/model.ts'
import { CARD_GAP, CARD_H, CARD_W, SNAP, TABLE_H, TABLE_W, seatPlaces } from '../table/model.ts'
import type { Cursor, Drag } from '../net/peers.ts'
import { Card } from './Card.tsx'
import { Piece } from './Piece.tsx'
import { DieFace, dieLabel } from './Dice.tsx'
import { ChipStack, money } from './Chips.tsx'

interface Pos {
  x: number
  y: number
}

export interface TableProps {
  view: TableView
  me: SeatId | null
  drags: Record<CardId, Drag>
  onMove: (ids: CardId[], x: number, y: number) => void
  onFlip: (ids: CardId[]) => void
  onTake: (ids: CardId[]) => void
  onDrag: (d: Drag) => void
  onStack: (ids: CardId[], at: Pos) => void
  /** Everyone's pointer, live. */
  cursors: Record<SeatId, Cursor>
  onCursor: (c: Cursor) => void
  /** The dealer button and the blinds. They snap to nothing. */
  onPuck: (id: string, x: number, y: number) => void
  onDie: (id: string, x: number, y: number) => void
  onHold: (id: string, held: boolean) => void
  /** A card dragged out of the hand drawer and dropped on the felt. */
  onDropIn: (id: CardId, x: number, y: number) => void
}

/**
 * The table. Cards sit at positions and you drag them around; cards dropped on
 * top of each other snap to the same spot and become a pile.
 *
 * Dragging is broadcast straight to every other browser many times a second so
 * a card slides rather than teleports. Only the drop is sent to the host, which
 * is what actually changes the table.
 */
export function Table({
  view,
  me,
  drags,
  cursors,
  onMove,
  onFlip,
  onTake,
  onDrag,
  onStack,
  onPuck,
  onDie,
  onHold,
  onDropIn,
  onCursor,
}: TableProps) {
  const wrap = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)
  const [dragging, setDragging] = useState<{
    ids: CardId[]
    at: Pos
    grab: Pos
    /** Started on the count badge, which grabs the whole pile. */
    viaBadge?: boolean
    moved?: boolean
    /** A marker rather than cards, which lands wherever it is dropped. */
    puck?: string
    die?: string
  } | null>(null)
  const [menu, setMenu] = useState<{ ids: CardId[]; at: Pos } | null>(null)
  /** The card under the pointer, drawn large off to one side. */
  const [peek, setPeek] = useState<{ face: string; at: Pos } | null>(null)
  // Holding still on a card opens its menu. Right-click is spoken for: it
  // turns the card over, which is what a right-click on a card should do.
  const press = useRef<ReturnType<typeof setTimeout> | null>(null)

  // The table is a fixed coordinate space scaled to whatever room it has, so
  // every browser agrees on where a card is regardless of screen size.
  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const fit = () => {
      const r = el.getBoundingClientRect()
      setScale(Math.min(r.width / TABLE_W, r.height / TABLE_H))
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const toTable = useCallback(
    (clientX: number, clientY: number): Pos => {
      const el = wrap.current
      if (!el) return { x: 0, y: 0 }
      const r = el.getBoundingClientRect()
      const offX = (r.width - TABLE_W * scale) / 2
      const offY = (r.height - TABLE_H * scale) / 2
      return { x: (clientX - r.left - offX) / scale, y: (clientY - r.top - offY) / scale }
    },
    [scale],
  )

  const places = seatPlaces(view.seats)

  // Piles are derived, never stored: cards sharing a spot are a pile.
  const piles = new Map<string, typeof view.cards>()
  for (const c of view.cards) {
    if (c.hand !== null) continue
    const key = `${c.x},${c.y}`
    const list = piles.get(key) ?? []
    list.push(c)
    piles.set(key, list)
  }

  const startDrag = (
    e: React.PointerEvent,
    ids: CardId[],
    from: Pos,
    viaBadge = false,
    puck?: string,
    /** Hold still on this and you get the menu for these cards. */
    menuIds?: CardId[],
    die?: string,
  ) => {
    if (!me) return
    e.preventDefault()
    // Capture keeps the drag alive if the pointer leaves the card. It throws
    // for a pointer id the browser does not consider active, which must not
    // abort the drag before it starts.
    try {
      ;(e.currentTarget as Element).setPointerCapture?.(e.pointerId)
    } catch {
      /* not a live pointer */
    }
    const p = toTable(e.clientX, e.clientY)
    setDragging({
      ids,
      at: from,
      grab: { x: p.x - from.x, y: p.y - from.y },
      viaBadge,
      ...(puck ? { puck } : {}),
      ...(die ? { die } : {}),
    })
    onDrag({ ids, x: from.x, y: from.y, holding: true, by: me })

    if (menuIds) {
      clearPress()
      press.current = setTimeout(() => {
        setDragging(null)
        setPeek(null)
        onDrag({ ids, x: from.x, y: from.y, holding: false, by: me })
        setMenu({ ids: menuIds, at: from })
      }, 460)
    }
  }

  const clearPress = () => {
    if (press.current) clearTimeout(press.current)
    press.current = null
  }
  useEffect(() => clearPress, [])

  const sent = useRef(0)

  /** Pointer rate is far faster than anyone needs to see. Twenty a second. */
  const tellCursor = (e: React.PointerEvent) => {
    if (!me) return
    const now = performance.now()
    if (now - sent.current < 50) return
    sent.current = now
    const p = toTable(e.clientX, e.clientY)
    onCursor({ by: me, x: p.x, y: p.y, on: true })
  }

  const onPointerMove = (e: React.PointerEvent) => {
    tellCursor(e)
    if (!dragging || !me) return
    const p = toTable(e.clientX, e.clientY)
    const at = { x: p.x - dragging.grab.x, y: p.y - dragging.grab.y }
    // Moving means you meant to drag, not to hold still.
    if (Math.hypot(at.x - dragging.at.x, at.y - dragging.at.y) > 4) clearPress()
    const moved =
      dragging.moved || Math.hypot(at.x - dragging.at.x, at.y - dragging.at.y) > 0.5 || !dragging.viaBadge
    setDragging({ ...dragging, at, moved })
    onDrag({ ids: dragging.ids, x: at.x, y: at.y, holding: true, by: me })
  }

  /**
   * Where a card dropped here belongs: on a pile it landed on, in a slot it
   * was aimed at, in the space in front of somebody, or exactly where it was
   * let go. Holes are for pieces, so they are not a target for a card.
   */
  const snapTo = (x: number, y: number, ignore: Set<CardId>): Pos => {
    let best: Pos | null = null
    let bestDist = SNAP
    for (const c of view.cards) {
      if (c.hand !== null || ignore.has(c.id)) continue
      const d = Math.hypot(c.x - x, c.y - y)
      if (d < bestDist) {
        bestDist = d
        best = { x: c.x, y: c.y }
      }
    }
    for (const slot of [...view.slots.filter((sl) => !sl.dot), ...places.map((p) => ({ ...p.drop }))]) {
      const d = Math.hypot(slot.x - x, slot.y - y)
      if (d < Math.max(bestDist, SNAP * 1.7)) {
        bestDist = d
        best = { x: slot.x, y: slot.y }
      }
    }
    return best ?? { x: clamp(x, 30, TABLE_W - 30), y: clamp(y, 30, TABLE_H - 30) }
  }

  const endDrag = () => {
    if (!dragging || !me) return
    const { ids, at, viaBadge, moved, puck, die } = dragging
    clearPress()
    setDragging(null)
    onDrag({ ids, x: at.x, y: at.y, holding: false, by: me })

    // A marker has no pile to join and no hand to go into. It stays where you
    // put it, which is the whole point of it.
    if (die) {
      onDie(die, clamp(at.x, 20, TABLE_W - 20), clamp(at.y, 20, TABLE_H - 20))
      return
    }

    if (puck) {
      // A board has holes, and a piece dropped near one drops into it. A
      // lettered marker on a table with no holes just stays where you put it.
      let best: Pos | null = null
      let bestDist = 40
      for (const slot of view.slots) {
        if (!slot.dot && !slot.cell) continue
        const d = Math.hypot(slot.x - at.x, slot.y - at.y)
        if (d < bestDist) {
          bestDist = d
          best = { x: slot.x, y: slot.y }
        }
      }
      const to = best ?? { x: clamp(at.x, 18, TABLE_W - 18), y: clamp(at.y, 18, TABLE_H - 18) }
      onPuck(puck, to.x, to.y)
      return
    }

    // Pressing the badge without moving is a tap, and a tap opens the menu.
    if (viaBadge && !moved) {
      setMenu({ ids, at: { x: at.x, y: at.y } })
      return
    }

    // Dropped low enough over the rail? That means "into my hand".
    if (at.y > TABLE_H - 40) {
      onTake(ids)
      return
    }

    const target = snapTo(at.x, at.y, new Set(ids))
    onMove(ids, target.x, target.y)
  }

  return (
    <div
      className="felt"
      ref={wrap}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onPointerLeave={() => me && onCursor({ by: me, x: 0, y: 0, on: false })}
      onDragOver={(e) => {
        // Anything dragged out of your own hand can land here.
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
      }}
      onDrop={(e) => {
        e.preventDefault()
        const id = e.dataTransfer.getData('text/plain')
        if (!id) return
        const p = toTable(e.clientX, e.clientY)
        const to = snapTo(p.x, p.y, new Set([id]))
        onDropIn(id, to.x, to.y)
      }}
    >
      <div
        className="felt-inner"
        style={{ width: TABLE_W, height: TABLE_H, transform: `translate(-50%, -50%) scale(${scale})` }}
        onPointerDown={() => {
          setMenu(null)
          setPeek(null)
        }}
      >
        <div className="felt-face" aria-hidden="true" />

        {/* Markings on the felt: where things go, not what you may do. */}
        {/* The board underneath: snakes, ladders, anything drawn rather than
            picked up. */}
        {view.lines.length > 0 && (
          <svg className="lines" viewBox={`0 0 ${TABLE_W} ${TABLE_H}`} aria-hidden="true">
            {view.lines.map((l) => (
              <path
                key={l.id}
                d={
                  l.wavy
                    ? snake(l.x1, l.y1, l.x2, l.y2)
                    : `M${l.x1} ${l.y1} L${l.x2} ${l.y2}`
                }
                stroke={l.colour}
                strokeWidth={l.wavy ? 9 : 11}
                strokeLinecap="round"
                fill="none"
                opacity={l.wavy ? 0.85 : 0.7}
                strokeDasharray={l.wavy ? undefined : '2 14'}
              />
            ))}
          </svg>
        )}

        {view.slots.map((slot) =>
          slot.cell ? (
            <div
              key={slot.id}
              className="cell"
              style={{
                transform: `translate(${slot.x}px, ${slot.y}px) translate(-50%, -50%)`,
                width: slot.cell,
                height: slot.cell,
                ...(slot.shade ? { background: slot.shade } : {}),
              }}
              aria-hidden="true"
            >
              {slot.note && <span className="cell-note">{slot.note}</span>}
            </div>
          ) : slot.dot ? (
            <div
              key={slot.id}
              className="hole"
              style={{ transform: `translate(${slot.x}px, ${slot.y}px) translate(-50%, -50%)` }}
              aria-hidden="true"
            />
          ) : (
            <div
              key={slot.id}
              className="slot"
              style={{
                transform: `translate(${slot.x - (slot.wide ? (slot.wide * CARD_GAP) / 2 : CARD_W / 2)}px, ${slot.y - CARD_H / 2}px)`,
                width: slot.wide ? slot.wide * CARD_GAP : CARD_W,
              }}
              aria-hidden="true"
            >
              <span className="slot-label">{slot.label}</span>
            </div>
          ),
        )}

        {/* The space in front of each player, where what they play goes. It is
            a marking like any other: it holds nothing and stops nothing. */}
        {/* Only worth marking out when there is somebody to tell apart from. */}
        {view.cards.length > 0 &&
          view.seats.length > 1 &&
          places.map(({ seat, drop }) => (
            <div
              key={`drop-${seat.id}`}
              className={`slot slot--seat ${seat.id === me ? 'is-me' : ''}`}
              style={{ transform: `translate(${drop.x - CARD_W / 2}px, ${drop.y - CARD_H / 2}px)`, width: CARD_W }}
              aria-hidden="true"
            >
              <span className="slot-label">{seat.id === me ? 'You' : seat.name}</span>
            </div>
          ))}

        {/* The dealer button and the blinds. Drag one round as the deal moves. */}
        {view.pucks.map((puck) => {
          const held = dragging?.puck === puck.id
          const remote = drags[puck.id]
          const at = held ? dragging!.at : remote ? { x: remote.x, y: remote.y } : { x: puck.x, y: puck.y }
          return (
            <button
              key={puck.id}
              className={`puck ${
                puck.id.startsWith('cp-') ? 'puck--chess' : puck.colour ? 'puck--piece' : `puck--${puck.id.replace('pk-', '')}`
              } ${held || remote ? 'is-live' : ''} ${puck.label.startsWith('w') ? 'is-white' : ''}`}
              style={{
                transform: `translate(${at.x}px, ${at.y}px) translate(-50%, -50%)`,
                ...(puck.colour ? { background: puck.colour } : {}),
              }}
              title={puck.hint}
              aria-label={puck.hint}
              onPointerDown={(e) => {
                e.stopPropagation()
                startDrag(e, [puck.id], { x: puck.x, y: puck.y }, false, puck.id)
              }}
            >
              {puck.label.length === 2 && /^[wb]/.test(puck.label) ? (
                <Piece kind={puck.label[1]!} />
              ) : (
                puck.label
              )}
            </button>
          )
        })}

        {/* Everyone else sits around the edge; you are the rail at the bottom. */}
        {places.map(({ seat, x, y }) => (
          <div
            key={seat.id}
            className={`spot ${seat.connected ? '' : 'is-away'} ${seat.id === me ? 'is-me' : ''}`}
            style={{ transform: `translate(${x}px, ${y}px) translate(-50%, -50%)` }}
          >
            <span className="spot-face" style={{ background: seat.colour }}>
              {seat.emoji}
            </span>
            <span className="spot-name">
              {seat.name}
              {seat.id === me && <i>you</i>}
            </span>
            {/* A fan of backs, not a number. Counting somebody's cards is part
                of the game, and a digit does the counting for you. */}
            <span
              className="spot-hand"
              title={`${view.handCounts[seat.id] ?? 0} cards`}
              style={{ width: 10 + Math.max(view.handCounts[seat.id] ?? 0, 1) * 5 }}
            >
              {Array.from({ length: view.handCounts[seat.id] ?? 0 }).map((_, i) => (
                <i key={i} style={{ left: i * 5 }} />
              ))}
            </span>
            {view.chipsOn && (
              <span className="spot-chips">
                <ChipStack amount={view.chips[seat.id] ?? 0} />
                {money(view.chips[seat.id] ?? 0)}
              </span>
            )}
            {(view.scores[seat.id] ?? 0) !== 0 && (
              <span className="spot-score">{view.scores[seat.id]}</span>
            )}
          </div>
        ))}
        {[...piles.entries()].map(([key, cards]) => {
          const top = cards[cards.length - 1]!
          const beingDragged = dragging?.ids.includes(top.id)
          const remote = drags[top.id]
          const pos = beingDragged ? dragging!.at : remote ? { x: remote.x, y: remote.y } : { x: top.x, y: top.y }
          const held = !!remote && remote.by !== me

          return (
            <div
              // Keyed by the card on top, not by where the pile is. Keying it
              // by position meant that moving a card unmounted and remounted
              // it, which replayed the turn-over animation every single time
              // you put one down.
              key={top.id}
              className={`pile ${beingDragged || remote ? 'is-live' : ''}`}
              style={{ transform: `translate(${pos.x - CARD_W / 2}px, ${pos.y - CARD_H / 2}px)`, zIndex: top.z }}
            >
              {/* The cards underneath, offset a little so a pile looks like one */}
              {cards.slice(0, -1).slice(-3).map((c, i) => (
                <div key={c.id} className="pile-under" style={{ transform: `translate(${i + 1}px, ${i + 1}px)` }}>
                  <Card face={c.face} />
                </div>
              ))}

              <div
                className={`pile-top ${beingDragged ? 'is-dragging' : ''}`}
                onPointerDown={(e) =>
                  !held && startDrag(e, [top.id], { x: top.x, y: top.y }, false, undefined, cards.map((c) => c.id))
                }
                onDoubleClick={() => {
                  // Right-click turns a card over, so a double-click is free to
                  // do the thing you actually want twice a hand: look at it.
                  if (top.face) setPeek({ face: top.face, at: { x: top.x, y: top.y } })
                }}
                onContextMenu={(e) => {
                  // Right-click turns it over. Everything else is behind a
                  // hold, or the count badge on a pile.
                  e.preventDefault()
                  clearPress()
                  setDragging(null)
                  onFlip([top.id])
                }}
              >
                <Card face={top.face} held={held} />
              </div>

              {cards.length > 1 && (
                /* Dragging a card takes that card. Dragging the count takes the
                   whole pile - you pick a stack up by the label on it. Press
                   without moving and it is a tap, which opens the menu. */
                <button
                  className="pile-count"
                  title="Drag to move the whole pile"
                  onPointerDown={(e) => {
                    e.stopPropagation()
                    if (!held) startDrag(e, cards.map((c) => c.id), { x: top.x, y: top.y }, true)
                  }}
                >
                  {cards.length}
                </button>
              )}
            </div>
          )
        })}

        {/* The pot sits in its slot when the game has one, otherwise in the
            middle where a pot goes. */}
        {view.chipsOn && view.pot > 0 && (
          <div className="pot" style={{ transform: `translate(${potAt(view).x - 60}px, ${potAt(view).y - 26}px)` }}>
            <ChipStack amount={view.pot} big />
            <span className="pot-amount">{money(view.pot)}</span>
          </div>
        )}

        {/* Dice. Anyone can shove one about; only the host decides what it
            shows, for the same reason only the host shuffles. */}
        {view.dice.map((die) => {
          const held = dragging?.die === die.id
          const remote = drags[die.id]
          const at = held ? dragging!.at : remote ? { x: remote.x, y: remote.y } : { x: die.x, y: die.y }
          return (
            <button
              key={die.id}
              className={`die ${die.held ? 'is-kept' : ''} ${held || remote ? 'is-live' : ''} ${
                die.letters ? 'die--letter' : ''
              }`}
              style={{ transform: `translate(${at.x}px, ${at.y}px) translate(-50%, -50%)` }}
              aria-label={dieLabel(die)}
              title={die.held ? 'Kept back from the next roll' : 'Tap to keep this one back'}
              onPointerDown={(e) => {
                e.stopPropagation()
                startDrag(e, [die.id], { x: die.x, y: die.y }, false, undefined, undefined, die.id)
              }}
              onDoubleClick={() => onHold(die.id, !die.held)}
            >
              <DieFace die={die} />
            </button>
          )
        })}

        {/* Everyone else's pointer. It is the cheapest possible presence: four
            numbers at twenty a second, drawn and never stored. */}
        {Object.values(cursors).map((c) => {
          if (c.by === me) return null
          const seat = view.seats.find((s) => s.id === c.by)
          if (!seat) return null
          return (
            <div key={c.by} className="cursor" style={{ transform: `translate(${c.x}px, ${c.y}px)` }}>
              <svg viewBox="0 0 12 18" width="14" height="21" aria-hidden="true">
                <path d="M1 1 11 9 6.4 9.7 9 15.6 6.6 16.6 4.1 10.8 1 13.6Z" fill={seat.colour} stroke="#fff" strokeWidth="1.1" />
              </svg>
              <span className="cursor-who" style={{ background: seat.colour }}>
                {seat.emoji} {seat.name}
              </span>
            </div>
          )
        })}

        {/* A card under the pointer, drawn big enough to read without leaning
            in. It goes beside the card rather than over it, and is clamped to
            the table so it is never half off the edge. */}
        {peek && !dragging && (
          <button
            className="peek"
            aria-label="Close"
            onClick={() => setPeek(null)}
            onPointerDown={(e) => e.stopPropagation()}
            style={{
              transform: `translate(${clamp(
                peek.at.x < TABLE_W / 2 ? peek.at.x + 62 : peek.at.x - PEEK_W - 62,
                8,
                TABLE_W - PEEK_W - 8,
              )}px, ${clamp(peek.at.y - PEEK_H / 2, 8, TABLE_H - PEEK_H - 8)}px)`,
            }}
          >
            <Card face={peek.face} />
            <span className="peek-x" aria-hidden="true">
              ✕
            </span>
          </button>
        )}

        {menu && (
          <div
            className="pile-menu"
            style={{ transform: `translate(${clamp(menu.at.x - 70, 4, TABLE_W - 148)}px, ${clamp(menu.at.y + 52, 4, TABLE_H - 190)}px)` }}
          >
            <button onClick={() => { onFlip(menu.ids); setMenu(null) }}>Flip all</button>
            <button onClick={() => { onStack(menu.ids, menu.at); setMenu(null) }}>Shuffle pile</button>
            <button onClick={() => { onTake(menu.ids); setMenu(null) }}>Take into hand</button>
            <button
              onClick={() => {
                // Spread the pile out so every card can be seen and grabbed.
                menu.ids.forEach((id, i) => {
                  const across = i % 8
                  const down = Math.floor(i / 8)
                  onMove([id], clamp(menu.at.x - 130 + across * 38, 30, TABLE_W - 30), clamp(menu.at.y + down * 26, 30, TABLE_H - 30))
                })
                setMenu(null)
              }}
            >
              Spread out
            </button>
            <button onClick={() => setMenu(null)}>Close</button>
          </div>
        )}
      </div>
    </div>
  )
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

/** A snake, as three bends between where it starts and where it drops you. */
function snake(x1: number, y1: number, x2: number, y2: number) {
  const dx = x2 - x1
  const dy = y2 - y1
  const nx = -dy
  const ny = dx
  const len = Math.hypot(nx, ny) || 1
  const wob = 26
  const ox = (nx / len) * wob
  const oy = (ny / len) * wob
  return (
    `M${x1} ${y1} ` +
    `C${x1 + dx * 0.25 + ox} ${y1 + dy * 0.25 + oy}, ${x1 + dx * 0.4 - ox} ${y1 + dy * 0.4 - oy}, ${x1 + dx * 0.5} ${y1 + dy * 0.5} ` +
    `C${x1 + dx * 0.6 + ox} ${y1 + dy * 0.6 + oy}, ${x1 + dx * 0.8 - ox} ${y1 + dy * 0.8 - oy}, ${x2} ${y2}`
  )
}

/** The size of the hover preview, kept in step with .peek in the stylesheet. */
const PEEK_W = 200
const PEEK_H = 280

/** The pot goes in the Pot slot if the game drew one, otherwise the middle. */
function potAt(view: TableView) {
  const slot = view.slots.find((s) => s.id === 'pot' || s.label.toLowerCase() === 'pot')
  return slot ? { x: slot.x, y: slot.y } : { x: TABLE_W / 2, y: TABLE_H / 2 + 120 }
}

