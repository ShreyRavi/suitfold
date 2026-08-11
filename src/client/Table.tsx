import { useCallback, useEffect, useRef, useState } from 'react'
import type { CardId, SeatId, TableView } from '../table/model.ts'
import { SNAP, TABLE_H, TABLE_W } from '../table/model.ts'
import type { Drag } from '../net/peers.ts'
import { Card } from './Card.tsx'
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
}

/**
 * The table. Cards sit at positions and you drag them around; cards dropped on
 * top of each other snap to the same spot and become a pile.
 *
 * Dragging is broadcast straight to every other browser many times a second so
 * a card slides rather than teleports. Only the drop is sent to the host, which
 * is what actually changes the table.
 */
export function Table({ view, me, drags, onMove, onFlip, onTake, onDrag, onStack }: TableProps) {
  const wrap = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)
  const [dragging, setDragging] = useState<{ ids: CardId[]; at: Pos; grab: Pos } | null>(null)
  const [menu, setMenu] = useState<{ ids: CardId[]; at: Pos } | null>(null)

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

  // Piles are derived, never stored: cards sharing a spot are a pile.
  const piles = new Map<string, typeof view.cards>()
  for (const c of view.cards) {
    if (c.hand !== null) continue
    const key = `${c.x},${c.y}`
    const list = piles.get(key) ?? []
    list.push(c)
    piles.set(key, list)
  }

  const startDrag = (e: React.PointerEvent, ids: CardId[], from: Pos) => {
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
    setDragging({ ids, at: from, grab: { x: p.x - from.x, y: p.y - from.y } })
    onDrag({ ids, x: from.x, y: from.y, holding: true, by: me })
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging || !me) return
    const p = toTable(e.clientX, e.clientY)
    const at = { x: p.x - dragging.grab.x, y: p.y - dragging.grab.y }
    setDragging({ ...dragging, at })
    onDrag({ ids: dragging.ids, x: at.x, y: at.y, holding: true, by: me })
  }

  const endDrag = () => {
    if (!dragging || !me) return
    const { ids, at } = dragging
    setDragging(null)
    onDrag({ ids, x: at.x, y: at.y, holding: false, by: me })

    // Dropped low enough over the rail? That means "into my hand".
    if (at.y > TABLE_H - 40) {
      onTake(ids)
      return
    }

    // Snap onto a nearby pile or into a slot, otherwise stay where dropped.
    const ignore = new Set(ids)
    let best: Pos | null = null
    let bestDist = SNAP
    for (const c of view.cards) {
      if (c.hand !== null || ignore.has(c.id)) continue
      const d = Math.hypot(c.x - at.x, c.y - at.y)
      if (d < bestDist) {
        bestDist = d
        best = { x: c.x, y: c.y }
      }
    }
    // Slots pull a little harder, because they are what you were aiming at.
    for (const slot of view.slots) {
      const d = Math.hypot(slot.x - at.x, slot.y - at.y)
      if (d < Math.max(bestDist, SNAP * 1.7)) {
        bestDist = d
        best = { x: slot.x, y: slot.y }
      }
    }
    const target = best ?? {
      x: clamp(at.x, 30, TABLE_W - 30),
      y: clamp(at.y, 30, TABLE_H - 30),
    }
    onMove(ids, target.x, target.y)
  }

  return (
    <div className="felt" ref={wrap} onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerCancel={endDrag}>
      <div
        className="felt-inner"
        style={{ width: TABLE_W, height: TABLE_H, transform: `scale(${scale})` }}
        onPointerDown={() => setMenu(null)}
      >
        <div className="felt-face" aria-hidden="true" />

        {/* Markings on the felt: where things go, not what you may do. */}
        {view.slots.map((slot) => (
          <div
            key={slot.id}
            className="slot"
            style={{
              transform: `translate(${slot.x - (slot.wide ? (slot.wide * 74) / 2 : 34)}px, ${slot.y - 48}px)`,
              width: slot.wide ? slot.wide * 74 : 68,
            }}
            aria-hidden="true"
          >
            <span className="slot-label">{slot.label}</span>
          </div>
        ))}

        {/* Everyone else sits around the edge; you are the rail at the bottom. */}
        {seatSpots(view, me).map(({ seat, x, y, count }) => (
          <div
            key={seat.id}
            className={`spot ${seat.connected ? '' : 'is-away'}`}
            style={{ transform: `translate(${x}px, ${y}px)` }}
          >
            <span className="spot-dot" style={{ background: seat.colour }} />
            <span className="spot-name">{seat.name}</span>
            <span className="spot-count">{count}</span>
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
              key={key}
              className={`pile ${beingDragged || remote ? 'is-live' : ''}`}
              style={{ transform: `translate(${pos.x - 34}px, ${pos.y - 48}px)`, zIndex: top.z }}
            >
              {/* The cards underneath, offset a little so a pile looks like one */}
              {cards.slice(0, -1).slice(-3).map((c, i) => (
                <div key={c.id} className="pile-under" style={{ transform: `translate(${i + 1}px, ${i + 1}px)` }}>
                  <Card face={c.face} />
                </div>
              ))}

              <div
                className={`pile-top ${beingDragged ? 'is-dragging' : ''}`}
                onPointerDown={(e) => !held && startDrag(e, [top.id], { x: top.x, y: top.y })}
                onDoubleClick={() => onFlip([top.id])}
                onContextMenu={(e) => {
                  e.preventDefault()
                  setMenu({ ids: cards.map((c) => c.id), at: { x: top.x, y: top.y } })
                }}
              >
                <Card face={top.face} held={held} />
              </div>

              {cards.length > 1 && (
                <button
                  className="pile-count"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => setMenu({ ids: cards.map((c) => c.id), at: { x: top.x, y: top.y } })}
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

/** The pot goes in the Pot slot if the game drew one, otherwise the middle. */
function potAt(view: TableView) {
  const slot = view.slots.find((s) => s.id === 'pot' || s.label.toLowerCase() === 'pot')
  return slot ? { x: slot.x, y: slot.y } : { x: TABLE_W / 2, y: TABLE_H / 2 + 120 }
}

/** Lay the other players around the top half of the table. */
function seatSpots(view: TableView, me: SeatId | null) {
  const others = view.seats.filter((s) => s.id !== me)
  const rx = TABLE_W / 2 - 90
  const ry = TABLE_H / 2 - 30
  return others.map((seat, i) => {
    const t = (i + 1) / (others.length + 1)
    const angle = Math.PI * (1 + t) // left, over the top, to the right
    return {
      seat,
      x: TABLE_W / 2 + rx * Math.cos(angle) - 52,
      y: TABLE_H / 2 + ry * Math.sin(angle) - 14,
      count: view.handCounts[seat.id] ?? 0,
    }
  })
}
