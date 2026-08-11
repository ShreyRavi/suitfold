import { useEffect, useRef, useState } from 'react'
import type { Action, SeatId, TableView } from '../table/model.ts'
import type { Host } from '../net/host.ts'
import { money } from './Chips.tsx'

/**
 * The things you reach for constantly live on the table, not behind a menu.
 * Dealing in particular used to cover the table you were dealing to.
 */
export function Toolbar({
  host,
  view,
  me,
  onGames,
  act,
}: {
  host: Host | null
  view: TableView
  me: SeatId | null
  onGames: () => void
  /** Betting is something every player does, not only whoever holds the deck. */
  act: (a: Action) => void
}) {
  const [open, setOpen] = useState<'deal' | 'score' | null>(null)
  const wrap = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const away = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(null)
    }
    document.addEventListener('pointerdown', away)
    return () => document.removeEventListener('pointerdown', away)
  }, [open])

  // Guests get no toolbar actions — the table belongs to whoever holds the
  // deck. Their betting lives with their hand, at the bottom.
  if (!host) {
    return (
      <div className="tools" ref={wrap}>
        <span className="tools-note">{view.deckName || 'Waiting for the host'}</span>
      </div>
    )
  }

  return (
    <div className="tools" ref={wrap}>
      {host.canDealHand && (
        <button className="tool tool--go" onClick={() => host.dealHand()}>
          <Icon d="M3 6h11v12H3zM8 4h11v12" /> New hand
        </button>
      )}
      <button className="tool" onClick={() => setOpen(open === 'deal' ? null : 'deal')} aria-expanded={open === 'deal'}>
        <Icon d="M12 5v14M5 12h14" /> Deal
      </button>
      <button
        className="tool"
        onClick={() => {
          const biggest = host.sources()[0]
          const pile = biggest && view.cards.filter((c) => c.hand === null && c.x === biggest.x && c.y === biggest.y)
          if (pile?.length) host.shuffleStack(pile.map((c) => c.id))
        }}
        disabled={!host.sources().length}
      >
        <Icon d="M4 7h5l7 10h4M4 17h5l7-10h4M18 4l3 3-3 3M18 14l3 3-3 3" /> Shuffle
      </button>
      <button className="tool" onClick={() => host.gather()}>
        <Icon d="M4 8h16v11H4zM7 5h13v3" /> Gather
      </button>
      <button className="tool" onClick={() => host.undo()} disabled={!host.canUndo}>
        <Icon d="M4 9h11a5 5 0 010 10H9M4 9l4-4M4 9l4 4" /> Undo
      </button>
      <button className="tool" onClick={() => setOpen(open === 'score' ? null : 'score')} aria-expanded={open === 'score'}>
        <Icon d="M5 20V9M12 20V4M19 20v-7" /> Score
      </button>
      <button className="tool" onClick={onGames}>
        <Icon d="M5 4h9l5 5v11H5zM14 4v5h5" /> Game
      </button>

      {open === 'deal' && <DealPanel host={host} view={view} me={me} onDone={() => setOpen(null)} />}
      {open === 'score' && <ScorePanel host={host} view={view} me={me} />}
    </div>
  )
}

function DealPanel({
  host,
  view,
  me,
  onDone,
}: {
  host: Host
  view: TableView
  me: SeatId | null
  onDone: () => void
}) {
  const sources = host.sources()
  const [count, setCount] = useState(1)
  const [source, setSource] = useState(0)
  const [who, setWho] = useState<'all' | SeatId>('all')
  const [faceUp, setFaceUp] = useState(false)

  const from = sources[source] ?? sources[0]
  const seats = who === 'all' ? view.seats.map((s) => s.id) : [who]
  const everything = count === -1
  const wanted = everything ? (from?.count ?? 0) : count * seats.length
  const going = Math.min(wanted, from?.count ?? 0)
  const short = !everything && going < wanted

  if (!from) {
    return (
      <div className="pop">
        <p className="pop-empty">
          Nothing face down to deal from. Pick a game, or gather the cards back up.
        </p>
      </div>
    )
  }

  const whoLabel = who === 'all' ? 'everyone' : (view.seats.find((s) => s.id === who)?.name ?? 'them')

  return (
    <div className="pop">
      <div className="pop-row">
        <span className="pop-lbl">How many each</span>
        <div className="segs wrap">
          {[1, 2, 3, 5, 7, 13].map((n) => (
            <button key={n} className={`seg ${count === n ? 'on' : ''}`} onClick={() => setCount(n)}>
              {n}
            </button>
          ))}
          {/* How Bluff, War and Old Maid start: the whole pile goes out. */}
          <button className={`seg ${everything ? 'on' : ''}`} onClick={() => setCount(-1)}>
            All of them
          </button>
        </div>
      </div>

      <div className="pop-row">
        <span className="pop-lbl">To</span>
        <div className="segs wrap">
          <button className={`seg ${who === 'all' ? 'on' : ''}`} onClick={() => setWho('all')}>
            Everyone
          </button>
          {view.seats.map((s) => (
            <button key={s.id} className={`seg ${who === s.id ? 'on' : ''}`} onClick={() => setWho(s.id)}>
              {s.id === me ? 'Me' : s.name}
            </button>
          ))}
        </div>
      </div>

      {sources.length > 1 && (
        <div className="pop-row">
          <span className="pop-lbl">From</span>
          <div className="segs wrap">
            {sources.slice(0, 4).map((p, i) => (
              <button key={i} className={`seg ${source === i ? 'on' : ''}`} onClick={() => setSource(i)}>
                {p.count} cards
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="pop-row">
        <span className="pop-lbl">Face</span>
        <div className="segs">
          <button className={`seg ${!faceUp ? 'on' : ''}`} onClick={() => setFaceUp(false)}>
            Down
          </button>
          <button className={`seg ${faceUp ? 'on' : ''}`} onClick={() => setFaceUp(true)}>
            Up
          </button>
        </div>
      </div>

      {/* Say what will happen before it happens. */}
      <p className="pop-say">
        {going === 0 ? (
          'That pile is empty.'
        ) : (
          <>
            <b>
              {everything ? `${Math.floor(going / seats.length)} or so` : count} to {whoLabel}
            </b>{' '}
            · {from.count} → {from.count - going}
            {short && <span className="pop-warn"> · not enough to go round</span>}
          </>
        )}
      </p>

      <button
        className="btn primary"
        disabled={going === 0}
        onClick={() => {
          host.deal({ count, seats, from, faceUp })
          onDone()
        }}
      >
        Deal
      </button>
    </div>
  )
}

/**
 * Betting moves an amount from your stack to the pot. The table never decides
 * whether the bet is legal — only that you have the chips.
 */
/** Tricks, points, lives — whatever this table is counting. */
function ScorePanel({ host, view, me }: { host: Host; view: TableView; me: SeatId | null }) {
  return (
    <div className="pop">
      <div className="pop-row">
        <span className="pop-lbl">Keeping score</span>
        <div className="scores">
          {view.seats.map((s) => (
            <div className="score-row" key={s.id}>
              <span className="score-dot" style={{ background: s.colour }} />
              <span className="score-name">
                {s.name}
                {s.id === me && ' (you)'}
              </span>
              <button className="seg" onClick={() => host.score(s.id, -1)} aria-label={`minus one for ${s.name}`}>
                −
              </button>
              <b className="score-val">{view.scores[s.id] ?? 0}</b>
              <button className="seg" onClick={() => host.score(s.id, 1)} aria-label={`plus one for ${s.name}`}>
                +
              </button>
            </div>
          ))}
        </div>
      </div>
      <button className="btn" onClick={() => host.clearScores()}>
        Reset to zero
      </button>
    </div>
  )
}

const Icon = ({ d }: { d: string }) => (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
)
