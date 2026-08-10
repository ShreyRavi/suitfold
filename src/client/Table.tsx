import { useCallback, useEffect, useRef, useState } from 'react'
import type { CardId, SeatId, TableView } from '../table/model.ts'
import { SNAP, TABLE_H, TABLE_W } from '../table/model.ts'
import type { Drag } from '../net/peers.ts'
import { Card } from './Card.tsx'

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

    // Snap onto a nearby pile, otherwise stay where it was dropped.
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
        {[...piles.entries()].map(([key, cards]) => {
          const top = cards[cards.length - 1]!
          const beingDragged = dragging?.ids.includes(top.id)
          const remote = drags[top.id]
          const pos = beingDragged ? dragging!.at : remote ? { x: remote.x, y: remote.y } : { x: top.x, y: top.y }
          const held = !!remote && remote.by !== me

          return (
            <div
              key={key}
              className="pile"
              style={{ transform: `translate(${pos.x - 31}px, ${pos.y - 44}px)`, zIndex: top.z }}
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
