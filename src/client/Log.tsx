import { useEffect, useRef, useState } from 'react'
import type { Action, LogEntry, SeatId, TableView } from '../table/model.ts'
import { money } from './Chips.tsx'

const LOG_W = 'suitfold.logw'

/**
 * What has happened, down the side of the table, with somewhere to talk.
 *
 * Around a real table you can see every hand move and hear everyone. Over a
 * link you can see the cards but not the arm that moved them, so an argument
 * about who put what in the pot has nothing to settle it. This is that.
 *
 * The list comes from the host as part of the table, so everyone's is the same
 * list in the same order - it is not each browser guessing from what it saw.
 */
export function Log({
  view,
  me,
  open,
  isHost,
  onClose,
  act,
}: {
  view: TableView
  me: SeatId | null
  open: boolean
  /** Only whoever holds the deck may wipe the history. */
  isHost: boolean
  onClose: () => void
  act: (a: Action) => void
}) {
  const [text, setText] = useState('')
  const list = useRef<HTMLDivElement>(null)
  // Draggable edge, remembered. A log you cannot widen is a log you stop
  // reading once the lines start wrapping three deep.
  const [width, setWidth] = useState(() => Number(localStorage.getItem(LOG_W)) || 264)
  const widthRef = useRef(width)
  widthRef.current = width

  const startResize = (e: React.PointerEvent) => {
    e.preventDefault()
    const from = e.clientX
    const was = width
    const move = (ev: PointerEvent) => setWidth(Math.max(190, Math.min(560, was + (from - ev.clientX))))
    const done = () => {
      removeEventListener('pointermove', move)
      removeEventListener('pointerup', done)
      localStorage.setItem(LOG_W, String(widthRef.current))
    }
    addEventListener('pointermove', move)
    addEventListener('pointerup', done)
  }

  // Follow the bottom, the way any log or chat does.
  useEffect(() => {
    const el = list.current
    if (el) el.scrollTop = el.scrollHeight
  }, [view.log.length, open])

  const send = () => {
    const said = text.trim()
    if (!said || !me) return
    act({ t: 'say', seat: me, text: said })
    setText('')
  }

  return (
    <aside
      className={`log ${open ? 'is-open' : ''}`}
      aria-label="What has happened"
      style={{ width, flexBasis: width }}
    >
      <button className="grip grip--side" aria-label="Drag to resize" title="Drag to resize" onPointerDown={startResize} />
      <div className="log-bar">
        <span className="lbl">TABLE LOG</span>
        <div className="log-acts">
          {isHost && view.log.length > 0 && (
            <button className="mini" onClick={() => act({ t: 'log_clear' })}>
              Clear
            </button>
          )}
          <button className="mini log-x" onClick={onClose} aria-label="Hide the log">
            ✕
          </button>
        </div>
      </div>

      <div className="log-list" ref={list}>
        {view.log.length === 0 && <p className="log-empty">Nothing has happened yet.</p>}
        {view.log.map((e) => (
          <Line key={e.n} e={e} view={view} me={me} />
        ))}
      </div>

      <form
        className="log-say"
        onSubmit={(ev) => {
          ev.preventDefault()
          send()
        }}
      >
        <input
          value={text}
          onChange={(ev) => setText(ev.target.value)}
          placeholder="Say something"
          maxLength={200}
          aria-label="Say something"
        />
        <button className="mini" type="submit" disabled={!text.trim()}>
          Send
        </button>
      </form>
    </aside>
  )
}

/** Half past nine, not a date. Everyone is at the same table on the same night. */
export const clock = (at: number) =>
  new Date(at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })

function Line({ e, view, me }: { e: LogEntry; view: TableView; me: SeatId | null }) {
  const seat = view.seats.find((s) => s.id === e.seat)
  const who = !e.seat ? 'The table' : e.seat === me ? 'You' : (seat?.name ?? 'Someone')
  const atMe = !!me && !!e.to?.includes(me)

  if (e.kind === 'chat') {
    return (
      <p className={`log-line is-chat ${atMe ? 'is-at-me' : ''}`}>
        <span className="log-head">
          <span className="log-who" style={{ color: seat?.colour }}>
            {seat?.emoji} {who}
          </span>
          <time className="log-at">{clock(e.at)}</time>
        </span>
        <span className="log-said">{withNames(e.text)}</span>
      </p>
    )
  }

  return (
    <p className={`log-line is-${e.kind}`}>
      <time className="log-at">{clock(e.at)}</time>
      <span className="log-dot" style={{ background: seat?.colour ?? 'var(--ink-faint)' }} aria-hidden="true" />
      <span className="log-what">
        <b>{who}</b> {e.text}
        {e.amount !== undefined && <em> {money(e.amount)}</em>}
      </span>
    </p>
  )
}

/** Draw the @names in a chat line as names rather than as text. */
function withNames(text: string) {
  return text.split(/(@[\p{L}\p{N}]+)/u).map((bit, i) =>
    bit.startsWith('@') ? (
      <b className="at" key={i}>
        {bit}
      </b>
    ) : (
      <span key={i}>{bit}</span>
    ),
  )
}

/**
 * Somebody said your name. A chat panel you are not looking at is the same as
 * no chat panel at all, so this comes to the front and waits.
 */
export function Mention({
  view,
  me,
  onOpenLog,
}: {
  view: TableView
  me: SeatId | null
  onOpenLog: () => void
}) {
  const [hail, setHail] = useState<LogEntry | null>(null)
  const seen = useRef<number | null>(null)

  useEffect(() => {
    const newest = view.log.length ? view.log[view.log.length - 1]!.n : 0
    if (seen.current === null) {
      seen.current = newest
      return
    }
    const mine = view.log.filter((e) => e.n > seen.current! && me && e.to?.includes(me))
    seen.current = newest
    const last = mine[mine.length - 1]
    if (!last) return
    setHail(last)
  }, [view.log, me])

  if (!hail) return null
  const from = view.seats.find((s) => s.id === hail.seat)

  return (
    <div className="ask" role="dialog" aria-modal="true" aria-label="Somebody said your name">
      <div className="ask-box">
        <span className="hail-who" style={{ color: from?.colour }}>
          {from?.emoji} {from?.name ?? 'Someone'} said
        </span>
        <p className="hail-said">{withNames(hail.text)}</p>
        <time className="fine">{clock(hail.at)}</time>
        <div className="ask-acts">
          <button className="btn" onClick={() => setHail(null)}>
            Dismiss
          </button>
          <button
            className="btn primary"
            onClick={() => {
              onOpenLog()
              setHail(null)
            }}
          >
            Open the log
          </button>
        </div>
      </div>
      <button className="ask-scrim" onClick={() => setHail(null)} aria-label="Dismiss" />
    </div>
  )
}

/**
 * Chips moving is the one thing you cannot afford to miss while you are
 * looking at your own hand, so it also comes past as a toast. Everything else
 * stays in the log.
 */
/** Long enough to catch up after looking away, and gone by itself after that. */
const TOAST_MS = 30_000

export function Toasts({ view, me, logOpen }: { view: TableView; me: SeatId | null; logOpen: boolean }) {
  const [shown, setShown] = useState<LogEntry[]>([])
  // Only lines that arrive after this browser is looking. Joining a table part
  // way through should not replay the whole night at you.
  const seen = useRef<number | null>(null)

  useEffect(() => {
    const newest = view.log.length ? view.log[view.log.length - 1]!.n : 0
    if (seen.current === null) {
      seen.current = newest
      return
    }
    const fresh = view.log.filter(
      (e) => e.n > seen.current! && (e.kind === 'chip' || (e.kind === 'chat' && !logOpen)),
    )
    seen.current = newest
    if (!fresh.length) return
    setShown((prev) => [...prev, ...fresh].slice(-3))
    // Each toast goes on its own timer, so a burst of bets does not take the
    // last one away early.
    const gone = fresh.map((e) =>
      setTimeout(() => setShown((prev) => prev.filter((x) => x.n !== e.n)), TOAST_MS),
    )
    return () => gone.forEach(clearTimeout)
  }, [view.log, logOpen])

  if (!shown.length) return null

  return (
    <div className="toasts" aria-live="polite">
      {shown.map((e) => {
        const seat = view.seats.find((s) => s.id === e.seat)
        const who = e.seat === me ? 'You' : (seat?.name ?? 'The table')
        return (
          <button
            className={`toast is-${e.kind}`}
            key={e.n}
            onClick={() => setShown((prev) => prev.filter((x) => x.n !== e.n))}
            aria-label="Dismiss"
          >
            <span className="toast-dot" style={{ background: seat?.colour ?? 'var(--ink-faint)' }}>
              {seat?.emoji}
            </span>
            <span>
              <b>{who}</b> {e.text}
              {e.amount !== undefined && <em> {money(e.amount)}</em>}
            </span>
          </button>
        )
      })}
    </div>
  )
}
