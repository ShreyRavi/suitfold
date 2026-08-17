import { useCallback, useEffect, useRef, useState } from 'react'
import type { Action, CardId, SeatId, TableView } from '../table/model.ts'
import { FACES, project } from '../table/model.ts'
import { Host } from '../net/host.ts'
import { cleanCode, connect, newCode, type Cursor, type Drag, type Wire } from '../net/peers.ts'
import { forget, kept, reopen, type Kept } from '../net/keep.ts'

export type Stage = 'lobby' | 'joining' | 'table'

export interface Live {
  stage: Stage
  code: string
  isHost: boolean
  me: SeatId | null
  view: TableView | null
  /** Cards other people are dragging right now, drawn at their live position. */
  drags: Record<CardId, Drag>
  /** Where everyone's pointer is. Live, never stored. */
  cursors: Record<SeatId, Cursor>
  peers: number
  note: string | null
  create: (name: string, emoji: string) => void
  join: (code: string, name: string, emoji?: string) => void
  leave: () => void
  /** Send a change to whoever is holding the table. */
  act: (a: Action) => void
  /** Tell everyone where a card is right now, without storing anything. */
  broadcastDrag: (d: Drag) => void
  /** Tell everyone where your pointer is. Same deal: nothing is kept. */
  broadcastCursor: (c: Cursor) => void
  host: Host | null
  /** A table this tab was holding when it went away, if there is one. */
  unfinished: Kept | null
  resume: (name: string, emoji: string) => void
  discard: () => void
}

const NAME = 'suitfold.name'
const FACE = 'suitfold.face'
const TOKEN = 'suitfold.who'

/**
 * Who this browser is, kept for good. The host used to work out who was coming
 * back from the name they typed, which is fine until two people are called Dad.
 */
function whoAmI(): string {
  let id = localStorage.getItem(TOKEN)
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem(TOKEN, id)
  }
  return id
}

export function useTable(): Live {
  const [stage, setStage] = useState<Stage>('lobby')
  const [code, setCode] = useState('')
  const [isHost, setIsHost] = useState(false)
  const [me, setMe] = useState<SeatId | null>(null)
  const [view, setView] = useState<TableView | null>(null)
  const [drags, setDrags] = useState<Record<CardId, Drag>>({})
  const [cursors, setCursors] = useState<Record<SeatId, Cursor>>({})
  const [unfinished, setUnfinished] = useState<Kept | null>(() => kept())
  const [peers, setPeers] = useState(0)
  const [note, setNote] = useState<string | null>(null)

  const wire = useRef<Wire | null>(null)
  const host = useRef<Host | null>(null)
  /** The revision of the table this browser has actually drawn. */
  const rev = useRef(0)
  /** When each live drag was last heard about, so a stuck one can be dropped. */
  const dragAt = useRef<Record<CardId, number>>({})

  const flash = useCallback((m: string) => {
    setNote(m)
    setTimeout(() => setNote(null), 2400)
  }, [])

  const wireUp = useCallback((w: Wire, name: string, asHost: boolean) => {
    w.snapshot.on((snap) => {
      // A snapshot is a whole table, not a change to one, so an old one
      // arriving late must not undo a newer one that got here first.
      if (snap.rev < rev.current) return
      rev.current = snap.rev
      setView(snap.view)
      setMe(snap.seat)
      setStage('table')
    })

    // The host says where it is every couple of seconds. If that is not where
    // we are, we missed something, so ask for the table back. This is what
    // turns a dropped message from permanent damage into a blink.
    w.ping.on((at) => {
      if (at === rev.current) return
      rev.current = Math.max(rev.current, 0)
      w.resync.send(0)
    })

    // Live drags are drawn immediately and never stored. A drag that ends,
    // or whose owner goes quiet, disappears.
    w.drag.on((d) => {
      const now = Date.now()
      setDrags((prev) => {
        const next = { ...prev }
        for (const id of d.ids) {
          if (d.holding) {
            next[id] = d
            dragAt.current[id] = now
          } else {
            delete next[id]
            delete dragAt.current[id]
          }
        }
        return next
      })
    })

    // Pointers arrive constantly and are drawn straight away. A pointer that
    // leaves the table, or whose owner goes quiet, disappears.
    w.cursor.on((c) => {
      setCursors((prev) => {
        if (!c.on) {
          if (!prev[c.by]) return prev
          const next = { ...prev }
          delete next[c.by]
          return next
        }
        return { ...prev, [c.by]: c }
      })
    })

    w.chat.on((text) => flash(text))

    w.onPeerJoin((id) => {
      setPeers(w.peers().length)
      if (asHost) setTimeout(() => host.current?.catchUp(id), 500)
      else w.hello.send({ name }, id)
    })

    w.onPeerLeave(() => {
      setPeers(w.peers().length)
      // Whatever they were holding, they are not holding it now.
      setDrags({})
      dragAt.current = {}
    })
  }, [flash])

  /** Open a table. `carryOn` puts back the one this tab was holding before. */
  const start = useCallback(
    (name: string, emoji: string, carryOn?: Kept) => {
      const c = carryOn?.code ?? newCode()
      localStorage.setItem(NAME, name)
      localStorage.setItem(FACE, emoji)
      setCode(c)
      setIsHost(true)
      setStage('joining')
      setUnfinished(null)

      const w = connect(c)
      wire.current = w
      wireUp(w, name, true)

      const h = new Host(
        w,
        'host',
        () => {
          rev.current++
          setView(project(h.state, 'host'))
          setMe('host')
          setStage('table')
        },
        c,
      )
      host.current = h
      if (carryOn) h.restore(reopen(carryOn, 'host'))
      h.seatSelf(name, emoji)
    },
    [wireUp],
  )

  const create = useCallback((name: string, emoji: string) => start(name, emoji), [start])
  const resume = useCallback(
    (name: string, emoji: string) => {
      const k = kept()
      if (k) start(name, emoji, k)
    },
    [start],
  )
  const discard = useCallback(() => {
    forget()
    setUnfinished(null)
  }, [])

  const join = useCallback(
    (raw: string, name: string, emoji = rememberedFace()) => {
      const c = cleanCode(raw)
      if (c.length < 4) return
      localStorage.setItem(NAME, name)
      localStorage.setItem(FACE, emoji)
      setCode(c)
      setIsHost(false)
      setStage('joining')

      const w = connect(c)
      wire.current = w
      wireUp(w, name, false)
      const token = whoAmI()
      w.hello.send({ name, emoji, token })
      // The host may not have heard the first hello, so say it a few times.
      const again = setInterval(() => w.hello.send({ name, emoji, token }), 2000)
      setTimeout(() => clearInterval(again), 20000)
    },
    [wireUp],
  )

  const act = useCallback((a: Action) => {
    if (host.current) host.current.local(a)
    else wire.current?.action.send(a)
  }, [])

  const broadcastDrag = useCallback((d: Drag) => {
    wire.current?.drag.send(d)
  }, [])

  const broadcastCursor = useCallback((c: Cursor) => {
    wire.current?.cursor.send(c)
  }, [])

  const leave = useCallback(() => {
    // Stop the heartbeat before letting go of the host, or it ticks forever.
    host.current?.close()
    wire.current?.leave()
    wire.current = null
    host.current = null
    setStage('lobby')
    setView(null)
    setMe(null)
    setCode('')
    setIsHost(false)
    setDrags({})
    setCursors({})
    rev.current = 0
    // Closing the table on purpose is not a crash, so there is nothing to keep.
    forget()
  }, [])

  /**
   * A card being dragged is drawn where the dragger says it is, which is right
   * until the message saying they let go never arrives. Then that card sits at
   * a stale spot forever, ignoring the real table underneath it. So a drag
   * nobody has mentioned for a couple of seconds is over.
   */
  useEffect(() => {
    const sweep = setInterval(() => {
      const cutoff = Date.now() - 2500
      setDrags((prev) => {
        const stale = Object.keys(prev).filter((id) => (dragAt.current[id] ?? 0) < cutoff)
        if (!stale.length) return prev
        const next = { ...prev }
        for (const id of stale) {
          delete next[id]
          delete dragAt.current[id]
        }
        return next
      })
    }, 1000)
    return () => clearInterval(sweep)
  }, [])

  useEffect(() => () => wire.current?.leave(), [])

  return {
    stage,
    code,
    isHost,
    me,
    view,
    drags,
    cursors,
    peers,
    note,
    create,
    join,
    leave,
    act,
    broadcastDrag,
    broadcastCursor,
    host: host.current,
    unfinished,
    resume,
    discard,
  }
}

export const rememberedName = () => localStorage.getItem(NAME) ?? ''
export const rememberedFace = () => localStorage.getItem(FACE) ?? ''

/**
 * Two people at a family table are quite likely to type "Dad". The host makes
 * names unique when they collide, but a suggested name nobody else will pick
 * is friendlier than being silently renamed to "Dad 2".
 */
const ADJECTIVES = ['Lucky', 'Sly', 'Bold', 'Quiet', 'Wild', 'Sharp', 'Calm', 'Quick', 'Sunny', 'Cheeky']
const NOUNS = ['Otter', 'Magpie', 'Badger', 'Heron', 'Fox', 'Hare', 'Wren', 'Stoat', 'Robin', 'Pike']

export function suggestName(): string {
  const pick = <T,>(list: readonly T[]) => list[Math.floor(Math.random() * list.length)]!
  return `${pick(ADJECTIVES)} ${pick(NOUNS)}`
}

export const suggestFace = () => FACES[Math.floor(Math.random() * FACES.length)]!
