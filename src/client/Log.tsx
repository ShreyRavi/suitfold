import { useEffect, useRef, useState } from 'react'
import type { Action, LogEntry, SeatId, TableView } from '../table/model.ts'
import { money } from './Chips.tsx'

/**
 * What has happened, down the side of the table, with somewhere to talk.
 *
 * Around a real table you can see every hand move and hear everyone. Over a
 * link you can see the cards but not the arm that moved them, so an argument
 * about who put what in the pot has nothing to settle it. This is that.
 *
 * The list comes from the host as part of the table, so everyone's is the same
 * list in the same order — it is not each browser guessing from what it saw.
 */
export function Log({
  view,
  me,
  open,
  onClose,
  act,
}: {
  view: TableView
  me: SeatId | null
  open: boolean
  onClose: () => void
  act: (a: Action) => void
}) {
  const [text, setText] = useState('')
  const list = useRef<HTMLDivElement>(null)

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
    <aside className={`log ${open ? 'is-open' : ''}`} aria-label="What has happened">
      <div className="log-bar">
        <span className="lbl">TABLE LOG</span>
        <button className="mini log-x" onClick={onClose} aria-label="Hide the log">
          ✕
        </button>
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

function Line({ e, view, me }: { e: LogEntry; view: TableView; me: SeatId | null }) {
  const seat = view.seats.find((s) => s.id === e.seat)
  const who = !e.seat ? 'The table' : e.seat === me ? 'You' : (seat?.name ?? 'Someone')

  if (e.kind === 'chat') {
    return (
      <p className="log-line is-chat">
        <span className="log-who" style={{ color: seat?.colour }}>
          {who}
        </span>
        <span className="log-said">{e.text}</span>
      </p>
    )
  }

  return (
    <p className={`log-line is-${e.kind}`}>
      <span className="log-dot" style={{ background: seat?.colour ?? 'var(--ink-faint)' }} aria-hidden="true" />
      <span className="log-what">
        <b>{who}</b> {e.text}
        {e.amount !== undefined && <em> {money(e.amount)}</em>}
      </span>
    </p>
  )
}

/**
 * Chips moving is the one thing you cannot afford to miss while you are
 * looking at your own hand, so it also comes past as a toast. Everything else
 * stays in the log.
 */
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
      setTimeout(() => setShown((prev) => prev.filter((x) => x.n !== e.n)), 3600),
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
          <div className={`toast is-${e.kind}`} key={e.n}>
            <span className="toast-dot" style={{ background: seat?.colour ?? 'var(--ink-faint)' }} />
            <span>
              <b>{who}</b> {e.text}
              {e.amount !== undefined && <em> {money(e.amount)}</em>}
            </span>
          </div>
        )
      })}
    </div>
  )
}
