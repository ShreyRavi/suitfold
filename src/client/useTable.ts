import { useCallback, useEffect, useRef, useState } from 'react'
import type { Action, CardId, SeatId, TableView } from '../table/model.ts'
import { project } from '../table/model.ts'
import { Host } from '../net/host.ts'
import { cleanCode, connect, newCode, type Drag, type Wire } from '../net/peers.ts'

export type Stage = 'lobby' | 'joining' | 'table'

export interface Live {
  stage: Stage
  code: string
  isHost: boolean
  me: SeatId | null
  view: TableView | null
  /** Cards other people are dragging right now, drawn at their live position. */
  drags: Record<CardId, Drag>
  peers: number
  note: string | null
  create: (name: string) => void
  join: (code: string, name: string) => void
  leave: () => void
  /** Send a change to whoever is holding the table. */
  act: (a: Action) => void
  /** Tell everyone where a card is right now, without storing anything. */
  broadcastDrag: (d: Drag) => void
  host: Host | null
}

const NAME = 'suitfold.name'

export function useTable(): Live {
  const [stage, setStage] = useState<Stage>('lobby')
  const [code, setCode] = useState('')
  const [isHost, setIsHost] = useState(false)
  const [me, setMe] = useState<SeatId | null>(null)
  const [view, setView] = useState<TableView | null>(null)
  const [drags, setDrags] = useState<Record<CardId, Drag>>({})
  const [peers, setPeers] = useState(0)
  const [note, setNote] = useState<string | null>(null)

  const wire = useRef<Wire | null>(null)
  const host = useRef<Host | null>(null)

  const flash = useCallback((m: string) => {
    setNote(m)
    setTimeout(() => setNote(null), 2400)
  }, [])

  const wireUp = useCallback((w: Wire, name: string, asHost: boolean) => {
    w.snapshot.on((snap) => {
      setView(snap.view)
      setMe(snap.seat)
      setStage('table')
    })

    // Live drags are drawn immediately and never stored. A drag that ends,
    // or whose owner goes quiet, disappears.
    w.drag.on((d) => {
      setDrags((prev) => {
        const next = { ...prev }
        for (const id of d.ids) {
          if (d.holding) next[id] = d
          else delete next[id]
        }
        return next
      })
    })

    w.chat.on((text) => flash(text))

    w.onPeerJoin((id) => {
      setPeers(w.peers().length)
      if (asHost) setTimeout(() => host.current?.catchUp(id), 500)
      else w.hello.send({ name }, id)
    })

    w.onPeerLeave(() => setPeers(w.peers().length))
  }, [flash])

  const create = useCallback(
    (name: string) => {
      const c = newCode()
      localStorage.setItem(NAME, name)
      setCode(c)
      setIsHost(true)
      setStage('joining')

      const w = connect(c)
      wire.current = w
      wireUp(w, name, true)

      const h = new Host(w, 'host', () => {
        setView(project(h.state, 'host'))
        setMe('host')
        setStage('table')
      })
      host.current = h
      h.seatSelf(name)
    },
    [wireUp],
  )

  const join = useCallback(
    (raw: string, name: string) => {
      const c = cleanCode(raw)
      if (c.length < 4) return
      localStorage.setItem(NAME, name)
      setCode(c)
      setIsHost(false)
      setStage('joining')

      const w = connect(c)
      wire.current = w
      wireUp(w, name, false)
      w.hello.send({ name })
      // The host may not have heard the first hello, so say it a few times.
      const again = setInterval(() => w.hello.send({ name }), 2000)
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

  const leave = useCallback(() => {
    wire.current?.leave()
    wire.current = null
    host.current = null
    setStage('lobby')
    setView(null)
    setMe(null)
    setCode('')
    setIsHost(false)
    setDrags({})
  }, [])

  useEffect(() => () => wire.current?.leave(), [])

  return {
    stage,
    code,
    isHost,
    me,
    view,
    drags,
    peers,
    note,
    create,
    join,
    leave,
    act,
    broadcastDrag,
    host: host.current,
  }
}

export const rememberedName = () => localStorage.getItem(NAME) ?? ''
