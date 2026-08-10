import { useCallback, useEffect, useRef, useState } from 'react'
import type { Command, RoomSettings } from '../core/types.ts'
import type { LogEntry } from '../core/narrate.ts'
import type { RoomView } from '../core/project.ts'
import { connect, myPeerId, newRoomCode, normaliseCode, type Wire } from '../net/peers.ts'
import { HostTable } from '../net/table.ts'

export type Stage = 'lobby' | 'connecting' | 'playing'

export interface Room {
  stage: Stage
  isHost: boolean
  code: string
  view: RoomView | null
  log: LogEntry[]
  you: string | null
  reject: string | null
  descriptions: Record<string, string>
  deckCommitment: string
  peerCount: number
  missed: LogEntry[]
  clearMissed: () => void
  send: (cmd: Command) => void
  changeSettings: (s: Partial<RoomSettings>) => void
  deal: () => void
  host: (name: string) => void
  join: (code: string, name: string) => void
  leave: () => void
}

const NAME_KEY = 'suitfold.name'

export function useRoom(): Room {
  const [stage, setStage] = useState<Stage>('lobby')
  const [isHost, setIsHost] = useState(false)
  const [code, setCode] = useState('')
  const [view, setView] = useState<RoomView | null>(null)
  const [log, setLog] = useState<LogEntry[]>([])
  const [you, setYou] = useState<string | null>(null)
  const [reject, setReject] = useState<string | null>(null)
  const [descriptions, setDescriptions] = useState<Record<string, string>>({})
  const [deckCommitment, setDeckCommitment] = useState('')
  const [peerCount, setPeerCount] = useState(0)
  const [missed, setMissed] = useState<LogEntry[]>([])

  const wire = useRef<Wire | null>(null)
  const table = useRef<HostTable | null>(null)
  const hidden = useRef(document.visibilityState === 'hidden')
  const seq = useRef(0)

  const flashReject = useCallback((reason: string) => {
    setReject(reason)
    setTimeout(() => setReject(null), 2600)
  }, [])

  // Phones background constantly — everyone is on a video call in another
  // window. What we collect here is the "what did I miss" summary.
  useEffect(() => {
    const onVisibility = () => {
      const nowHidden = document.visibilityState === 'hidden'
      if (nowHidden) setMissed([])
      hidden.current = nowHidden
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  const wireUp = useCallback(
    (w: Wire, name: string, asHost: boolean) => {
      w.snapshot.on((snap) => {
        setView(snap.view)
        setYou(snap.seatId)
        setDescriptions(snap.descriptions ?? {})
        setDeckCommitment(snap.deckCommitment ?? '')
        seq.current = Math.max(seq.current, snap.seq)
        setStage('playing')
      })

      w.log.on((entries) => {
        setLog((prev) => dedupe([...prev, ...entries]).slice(-160))
        if (hidden.current) setMissed((prev) => dedupe([...prev, ...entries]).slice(-12))
      })

      w.reject.on((r) => flashReject(r.reason))

      w.onPeerJoin((id) => {
        setPeerCount(w.peers().length)
        // Everyone greets the host. The host greets nobody: it seats peers as
        // their hellos arrive, and answers with a snapshot.
        if (!asHost) w.hello.send({ name }, id)
        else setTimeout(() => table.current?.catchUp(id), 400)
      })

      w.onPeerLeave(() => setPeerCount(w.peers().length))
    },
    [flashReject],
  )

  const host = useCallback(
    (name: string) => {
      const roomCode = newRoomCode()
      localStorage.setItem(NAME_KEY, name)
      setCode(roomCode)
      setIsHost(true)
      setStage('connecting')

      const w = connect(roomCode)
      wire.current = w
      wireUp(w, name, true)

      // The host's own seat is created directly; everyone else arrives by hello.
      const mySeat = 'seat1'
      const t = new HostTable(w, mySeat, () => {
        const snap = t.snapshotFor(mySeat)
        setView(snap.view)
        setYou(mySeat)
        setDescriptions(snap.descriptions ?? {})
        setDeckCommitment(snap.deckCommitment ?? '')
        setLog(t.logSince(0).slice(-160))
        setStage('playing')
      })
      t.onLocalReject(flashReject)
      table.current = t
      t.seatSelf(name)
    },
    [wireUp, flashReject],
  )

  const join = useCallback(
    (raw: string, name: string) => {
      const roomCode = normaliseCode(raw)
      if (roomCode.length < 4) return
      localStorage.setItem(NAME_KEY, name)
      setCode(roomCode)
      setIsHost(false)
      setStage('connecting')

      const w = connect(roomCode)
      wire.current = w
      wireUp(w, name, false)
      // Greet whoever is already here; the host is one of them.
      w.hello.send({ name })
      const greet = setInterval(() => w.hello.send({ name }), 2500)
      setTimeout(() => clearInterval(greet), 20_000)
    },
    [wireUp],
  )

  const send = useCallback((cmd: Command) => {
    if (table.current) table.current.local(cmd)
    else wire.current?.command.send(cmd)
  }, [])

  const changeSettings = useCallback((s: Partial<RoomSettings>) => {
    table.current?.changeSettings(s)
  }, [])

  const deal = useCallback(() => {
    table.current?.openTable()
  }, [])

  const leave = useCallback(() => {
    table.current?.stop()
    wire.current?.leave()
    table.current = null
    wire.current = null
    setStage('lobby')
    setView(null)
    setLog([])
    setYou(null)
    setCode('')
    setIsHost(false)
  }, [])

  useEffect(() => () => leave(), [leave])

  return {
    stage,
    isHost,
    code,
    view,
    log,
    you,
    reject,
    descriptions,
    deckCommitment,
    peerCount,
    missed,
    clearMissed: useCallback(() => setMissed([]), []),
    send,
    changeSettings,
    deal,
    host,
    join,
    leave,
  }
}

const dedupe = (entries: LogEntry[]) => {
  const seen = new Set<string>()
  return entries.filter((e) => {
    const key = `${e.seq}:${e.text}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export const rememberedName = () => localStorage.getItem(NAME_KEY) ?? ''
export { myPeerId }
