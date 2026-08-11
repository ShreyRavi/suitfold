import { useEffect, useRef, useState } from 'react'

/**
 * Somewhere private to write.
 *
 * Boggle is played by writing your own list and not showing anyone until the
 * clock runs out; Yahtzee is played on a scorecard nobody else fills in. Both
 * are private by nature, so this never goes near the wire. It is kept in your
 * own browser against the table's code, so a reload does not lose it.
 */
export function Pad({ code, game, title, onClose }: { code: string; game: string; title: string; onClose: () => void }) {
  const key = `suitfold.pad.${code}.${game}`
  const [text, setText] = useState(() => localStorage.getItem(key) ?? '')
  const box = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    box.current?.focus()
  }, [])

  useEffect(() => {
    const save = setTimeout(() => localStorage.setItem(key, text), 300)
    return () => clearTimeout(save)
  }, [key, text])

  return (
    <aside className="pad">
      <div className="pad-bar">
        <span className="lbl">{title.toUpperCase()}</span>
        <div className="log-acts">
          <button className="mini" onClick={() => setText('')}>
            Clear
          </button>
          <button className="mini" onClick={onClose} aria-label="Hide">
            ✕
          </button>
        </div>
      </div>
      <textarea
        ref={box}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Only you can see this."
        aria-label={title}
      />
      <p className="fine">Kept in your own browser. Nobody else can see it, not even the dealer.</p>
    </aside>
  )
}

/** The shared clock, counting down from whatever the host started it at. */
export function Clock({ endsAt, seconds }: { endsAt: number | null; seconds: number }) {
  const [, tick] = useState(0)

  useEffect(() => {
    if (!endsAt) return
    const id = setInterval(() => tick((n) => n + 1), 250)
    return () => clearInterval(id)
  }, [endsAt])

  if (!endsAt) return null
  const left = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000))
  const mm = Math.floor(left / 60)
  const ss = String(left % 60).padStart(2, '0')

  return (
    <div className={`clock ${left === 0 ? 'is-out' : left <= 10 ? 'is-close' : ''}`} aria-live="off">
      <b>
        {mm}:{ss}
      </b>
      <i>{left === 0 ? 'time' : `of ${Math.round(seconds / 60) || 1} min`}</i>
    </div>
  )
}
