import { useCallback, useEffect, useRef, useState } from 'react'
import type { CardId, SeatId, TableView } from '../table/model.ts'
import { TABLE_H, TABLE_W, seatPlaces } from '../table/model.ts'
import { GROUPS, PRESETS } from '../table/deck.ts'
import { cleanCode } from '../net/peers.ts'
import { rememberedFace, rememberedName, suggestFace, suggestName, useTable } from './useTable.ts'
import { Table, toTableCoords } from './Table.tsx'
import { Home, Invite } from './Home.tsx'
import { Rules } from './Rules.tsx'
import { Card } from './Card.tsx'
import { Toolbar } from './Toolbar.tsx'
import { BetBar } from './BetBar.tsx'
import { Log, Mention, Toasts } from './Log.tsx'
import { Help, SEEN_HELP } from './Help.tsx'

const RAIL_H = 'suitfold.railh'
import { Clock, Pad } from './Pad.tsx'
import { presetById } from '../table/deck.ts'

export function App() {
  const t = useTable()
  const [rules, setRules] = useState<string | null>(null)
  // A link with a code on it means somebody invited you; that gets its own
  // page rather than dropping you on the sales pitch.
  const [invited, setInvited] = useState(() => cleanCode(location.hash.replace('#', '')))
  // Suggested once and kept for the session, so the field does not reshuffle
  // itself underneath somebody who is halfway through reading it.
  const [suggested] = useState(() => ({ name: suggestName(), face: suggestFace() }))
  const name = rememberedName() || suggested.name
  const face = rememberedFace() || suggested.face

  // Pasting a link into an already-open tab only changes the hash, which does
  // not reload anything - so watch for it.
  useEffect(() => {
    const onHash = () => setInvited(cleanCode(location.hash.replace('#', '')))
    addEventListener('hashchange', onHash)
    return () => removeEventListener('hashchange', onHash)
  }, [])

  if (t.stage === 'lobby') {
    return (
      <>
        {invited.length >= 4 ? (
          <Invite
            code={invited}
            initialName={name}
            initialFace={face}
            onJoin={t.join}
            onHome={() => {
              history.replaceState(null, '', location.pathname)
              setInvited('')
            }}
          />
        ) : (
          <Home
            onCreate={t.create}
            onJoin={t.join}
            initialName={name}
            initialFace={face}
            unfinished={t.unfinished}
            onResume={t.resume}
            onDiscard={t.discard}
            onRules={(id) => setRules(id)}
          />
        )}
        {rules && <Rules gameId={rules} onClose={() => setRules(null)} />}
      </>
    )
  }

  if (t.stage === 'joining' || !t.view) return <Joining code={t.code} isHost={t.isHost} />

  return <TableScreen t={t} />
}

// ---------------------------------------------------------------------------

function Joining({ code, isHost }: { code: string; isHost: boolean }) {
  return (
    <div className="lobby">
      <h1>{isHost ? 'Setting the table' : 'Finding the table'}</h1>
      {isHost && <div className="code-big">{code}</div>}
      <p className="lede">
        {isHost
          ? 'Share the code or the link and people can sit down.'
          : `Looking for ${code}. Whoever started it needs their tab open.`}
      </p>
      <p className="fine">Browsers are connecting to each other directly. This can take a few seconds.</p>
    </div>
  )
}

// ---------------------------------------------------------------------------

function TableScreen({ t }: { t: ReturnType<typeof useTable> }) {
  const view = t.view!
  const [sheet, setSheet] = useState(false)
  const [rules, setRules] = useState<string | null>(null)
  const [picked, setPicked] = useState<CardId[]>([])
  // Turning your own card face up is the one move nobody else can undo for
  // you, so it asks - until you say not to, for as long as this tab is open.
  const [askFirst, setAskFirst] = useState(true)
  // Shown once per browser, because the table explains none of itself.
  const [help, setHelp] = useState(() => !localStorage.getItem(SEEN_HELP))
  const [showing, setShowing] = useState(false)
  // Some games are played on your own bit of paper. Boggle is, Yahtzee is.
  const padFor = presetById(view.game).pad
  const [pad, setPad] = useState(true)
  // Wide screens get the log beside the table; small ones slide it over.
  const [log, setLog] = useState(() => matchMedia('(min-width: 1080px)').matches)
  const fileRef = useRef<HTMLDivElement>(null)
  // The drawer is draggable, and whatever you set it to is remembered.
  const [railH, setRailH] = useState(() => Number(localStorage.getItem(RAIL_H)) || 206)
  const [dragOut, setDragOut] = useState<CardId | null>(null)

  /**
   * Drag a card out of your hand and onto the table. Pointer events rather
   * than the browser's own drag and drop, which does not fire at all on a
   * touch screen - so on a phone this did nothing whatsoever.
   */
  const carryOut = (e: React.PointerEvent, id: CardId) => {
    const from = { x: e.clientX, y: e.clientY }
    let moved = false
    const move = (ev: PointerEvent) => {
      if (Math.hypot(ev.clientX - from.x, ev.clientY - from.y) > 10) moved = true
    }
    const up = (ev: PointerEvent) => {
      removeEventListener('pointermove', move)
      removeEventListener('pointerup', up)
      if (!moved) return
      const felt = document.querySelector('.felt')
      if (!felt) return
      const r = felt.getBoundingClientRect()
      const onFelt = ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom
      if (!onFelt) return
      const p = toTableCoords(r, ev.clientX, ev.clientY)
      // Face down: putting a card down and showing it are separate decisions.
      t.act({ t: 'play', ids: [id], x: Math.round(p.x), y: Math.round(p.y), faceUp: false })
      setPicked((keep) => keep.filter((x) => x !== id))
      setDragOut(id)
      setTimeout(() => setDragOut(null), 0)
    }
    addEventListener('pointermove', move)
    addEventListener('pointerup', up)
  }

  const startResize = (e: React.PointerEvent) => {
    e.preventDefault()
    const from = e.clientY
    const was = railH
    const move = (ev: PointerEvent) => {
      const next = Math.max(120, Math.min(innerHeight - 220, was + (from - ev.clientY)))
      setRailH(next)
    }
    const done = () => {
      removeEventListener('pointermove', move)
      removeEventListener('pointerup', done)
      localStorage.setItem(RAIL_H, String(railHRef.current))
    }
    addEventListener('pointermove', move)
    addEventListener('pointerup', done)
  }

  const railHRef = useRef(railH)
  railHRef.current = railH

  const myHand = view.cards.filter((c) => c.hand === t.me).sort((a, b) => a.z - b.z)

  const move = useCallback((ids: CardId[], x: number, y: number) => t.act({ t: 'move', ids, x, y }), [t])
  const flip = useCallback((ids: CardId[]) => t.act({ t: 'flip', ids }), [t])
  const take = useCallback(
    (ids: CardId[]) => t.me && t.act({ t: 'take', ids, seat: t.me }),
    [t],
  )
  const shuffleStack = useCallback(
    (ids: CardId[]) => {
      // Shuffling is the host's job: it is the one thing that has to be
      // unguessable, and only the host sees every face.
      if (t.host) t.host.shuffleStack(ids)
      else t.act({ t: 'reorder', ids: [...ids].reverse() })
    },
    [t],
  )

  // Only worth counting while the log is shut; once it is open you can see it.
  const unread = log ? 0 : view.log.filter((e) => e.kind === 'chat').length

  const play = (ids: CardId[], faceUp: boolean) => {
    const at = myPlace(view, t.me)
    t.act({ t: 'play', ids, x: at.x, y: at.y, faceUp })
  }

  return (
    <div className={`app ${log ? 'with-log' : ''}`}>
      <header className="bar">
        <div className="brand">
          <i className="mark">♠</i>
          <b>suitfold</b>
        </div>
        <div className="bar-mid">
          {view.deckName && (
            <button className="bar-game" onClick={() => setRules(view.game)} title="How to play">
              {view.deckName}
              <i aria-hidden="true">?</i>
            </button>
          )}
        </div>
        {padFor && !pad && (
          <button className="bar-log" onClick={() => setPad(true)} title={padFor}>
            Pad
          </button>
        )}
        <button className="bar-help" onClick={() => setHelp(true)} title="How this works" aria-label="How this works">
          ?
        </button>
        <button
          className={`bar-log ${log ? 'on' : ''}`}
          onClick={() => setLog(!log)}
          title="What has happened"
          aria-pressed={log}
        >
          Log
          {unread > 0 && <b>{unread}</b>}
        </button>
        <button className="bar-code" onClick={() => setSheet(true)} title="Share this table">
          {t.code}
          <b>{t.peers + 1}</b>
        </button>
        <button className="menu" onClick={() => setSheet(true)} aria-label="Table menu">
          <i />
          <i />
          <i />
        </button>
      </header>

      <div className="felt-wrap">
        <Table
          view={view}
          me={t.me}
          drags={t.drags}
          onMove={move}
          onFlip={flip}
          onTake={take}
          onDrag={t.broadcastDrag}
          onStack={(ids) => shuffleStack(ids)}
          onPuck={(id, x, y) => t.act({ t: 'puck', id, x, y })}
          onDie={(id, x, y) => t.act({ t: 'die_move', id, x, y })}
          onHold={(id, held) => t.act({ t: 'die_hold', id, held })}
          cursors={t.cursors}
          onCursor={t.broadcastCursor}
        />
        {/* Nothing on the felt at all: no cards, no pieces, no dice, no board. */}
        {view.cards.length === 0 &&
          view.pucks.length === 0 &&
          view.dice.length === 0 &&
          view.slots.length === 0 && (
            <div className="empty-table">
              <div>
                {t.host ? (
                  <>
                    <p>An empty table.</p>
                    <button className="btn primary" onClick={() => setSheet(true)}>
                      Pick a game
                    </button>
                  </>
                ) : (
                  <p>Waiting for {view.seats[0]?.name ?? 'the host'} to pick a game.</p>
                )}
              </div>
            </div>
          )}

        <Clock endsAt={view.timer.endsAt} seconds={view.timer.seconds} />
        {/* Over the table, so it lands wherever the table is rather than
            drifting off-centre when the log takes the right-hand column. */}
        <Toasts view={view} me={t.me} logOpen={log} />
      </div>

      <div className="rail" ref={fileRef} style={{ height: railH }}>
        {/* The dealer's controls used to float over the felt, which cost the
            table a strip of its height and covered whoever sat at the bottom. */}
        <div className="rail-top">
          <button
            className="grip"
            aria-label="Drag to resize"
            title="Drag to resize"
            onPointerDown={startResize}
          />
          <Toolbar host={t.host} view={view} me={t.me} onGames={() => setSheet(true)} act={t.act} />
        </div>

        <div className="rail-body">
          <div className="rail-side">
            <span className="lbl">
              YOUR HAND · {myHand.length}
              {picked.length > 0 && <em> · {picked.length} picked</em>}
            </span>
            <div className="rail-acts">
            {/* Face down first: it is the one you can take back. */}
            <button
              className="mini"
              disabled={!picked.length}
              onClick={() => {
                play(picked, false)
                setPicked([])
              }}
            >
              Play face down
            </button>
            <button
              className="mini"
              disabled={!picked.length}
              onClick={() => {
                // Showing a card cannot be undone by the person who showed it.
                if (askFirst) setShowing(true)
                else {
                  play(picked, true)
                  setPicked([])
                }
              }}
            >
              Play face up
            </button>
              {picked.length > 0 && (
                <button className="mini" onClick={() => setPicked([])}>
                  Clear
                </button>
              )}
            </div>
            {view.chipsOn && t.me && <BetBar view={view} me={t.me} act={t.act} />}
          </div>

          <div className="fan">
          {/* A game with no cards in it has nothing to say here. */}
          {myHand.length === 0 && view.cards.length > 0 && (
            <div className="fan-empty">
              Drag a card down here to pick it up. Only you can see what is here.
            </div>
          )}
          {myHand.map((c, i) => {
            const fan = fanAt(i, myHand.length)
            const chosen = picked.includes(c.id)
            return (
              <button
                key={c.id}
                className={`fan-card ${chosen ? 'is-sel' : ''}`}
                style={{
                  marginLeft: i === 0 ? 0 : fan.overlap,
                  transform: `rotate(${fan.angle}deg) translateY(${fan.lift + (chosen ? -16 : 0)}px)`,
                }}
                onPointerDown={(e) => carryOut(e, c.id)}
                onClick={() => {
                  // A drag that ended on the table has already played the card.
                  if (dragOut === c.id) return
                  setPicked((p) => (p.includes(c.id) ? p.filter((x) => x !== c.id) : [...p, c.id]))
                }}
              >
                <Card face={c.face} small={myHand.length > 9} selected={chosen} />
              </button>
            )
          })}
          </div>
        </div>
      </div>

      {padFor && pad && (
        <Pad code={t.code} game={view.game} title={padFor} onClose={() => setPad(false)} />
      )}

      <Log
        view={view}
        me={t.me}
        open={log}
        isHost={!!t.host}
        onClose={() => setLog(false)}
        act={t.act}
      />
      <Mention view={view} me={t.me} onOpenLog={() => setLog(true)} />

      {showing && (
        <div className="ask" role="dialog" aria-modal="true" aria-label="Show these cards">
          <div className="ask-box">
            <h2>Show {picked.length === 1 ? 'this card' : `these ${picked.length} cards`}?</h2>
            <p>Everyone at the table will see the face. You cannot take that back.</p>
            <label className="ask-again">
              <input type="checkbox" onChange={(e) => setAskFirst(!e.target.checked)} />
              <span>Do not ask again while this tab is open</span>
            </label>
            <div className="ask-acts">
              <button
                className="btn"
                onClick={() => {
                  setShowing(false)
                  setAskFirst(true)
                }}
              >
                Not yet
              </button>
              <button
                className="btn primary"
                onClick={() => {
                  play(picked, true)
                  setPicked([])
                  setShowing(false)
                }}
              >
                Show {picked.length === 1 ? 'it' : 'them'}
              </button>
            </div>
          </div>
          <button className="ask-scrim" onClick={() => setShowing(false)} aria-label="Cancel" />
        </div>
      )}

      {help && (
        <Help
          onClose={() => {
            localStorage.setItem(SEEN_HELP, '1')
            setHelp(false)
          }}
        />
      )}

      {sheet && <Sheet t={t} onClose={() => setSheet(false)} onRules={(id) => setRules(id)} />}
      {rules && <Rules gameId={rules} onClose={() => setRules(null)} />}
      {t.note && <div className="note">{t.note}</div>}
    </div>
  )
}

/**
 * Where a card played out of your hand should land: the space in front of you.
 *
 * It used to be the middle of the table, which is where the board, the pot and
 * the deck already are, so playing a card buried whatever the hand was about.
 * Then it was a free corner, which was better, but it meant your cards and
 * everybody else's ended up in one heap nobody could read.
 */
function myPlace(view: TableView, me: SeatId | null) {
  const mine = seatPlaces(view.seats).find((p) => p.seat.id === me)
  return mine ? mine.drop : freeSpot(view)
}

/** Nobody is sitting anywhere, so anywhere clear will do. */
function freeSpot(view: TableView) {
  const spots = [
    { x: 150, y: TABLE_H - 130 },
    { x: TABLE_W - 150, y: TABLE_H - 130 },
    { x: 150, y: 130 },
    { x: TABLE_W - 150, y: 130 },
    { x: 150, y: TABLE_H / 2 },
    { x: TABLE_W - 150, y: TABLE_H / 2 },
    { x: TABLE_W / 2, y: TABLE_H - 130 },
  ]
  const busy = (p: { x: number; y: number }) =>
    view.cards.some((c) => c.hand === null && Math.hypot(c.x - p.x, c.y - p.y) < 96) ||
    view.slots.some((sl) => Math.hypot(sl.x - p.x, sl.y - p.y) < 96) ||
    // The blinds live in a corner too, and a card dropped on top of the dealer
    // button hides the one thing on the felt that says whose deal it is.
    view.pucks.some((pk) => Math.hypot(pk.x - p.x, pk.y - p.y) < 80)
  // Somewhere free, or failing that the first corner - stacking on your own
  // previous card is better than landing on the board.
  return spots.find((p) => !busy(p)) ?? spots[0]!
}

/**
 * A held hand is an arc, not a row. Cards tilt away from the middle and dip at
 * the edges, and they overlap only as much as the count demands - enough that
 * thirteen cards still show their corner index.
 */
function fanAt(i: number, n: number) {
  const mid = (n - 1) / 2
  const off = i - mid
  const spread = n > 13 ? 1.9 : n > 9 ? 2.4 : n > 5 ? 3.4 : 4.5
  const width = n > 13 ? -26 : n > 9 ? -20 : n > 5 ? -12 : -4
  // Rotating about a point below the card already produces the arc, so the
  // only vertical nudge needed is a small one to keep the tops even.
  return {
    angle: off * spread,
    lift: -Math.abs(off) * 0.6,
    overlap: width,
  }
}

// ---------------------------------------------------------------------------

function Sheet({
  t,
  onClose,
  onRules,
}: {
  t: ReturnType<typeof useTable>
  onClose: () => void
  onRules: (id: string) => void
}) {
  const [copied, setCopied] = useState(false)
  const link = `${location.origin}${location.pathname}#${t.code}`

  const share = async () => {
    try {
      if (navigator.share) await navigator.share({ title: 'suitfold', url: link })
      else await navigator.clipboard.writeText(link)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      /* dismissed */
    }
  }

  return (
    <div className="sheet">
      <div className="sheet-bar">
        <h2>Table</h2>
        <button className="btn" onClick={onClose}>
          Done
        </button>
      </div>

      <div className="sheet-body">
        <div className="fld">
          <span>Code</span>
          <div className="code-big">{t.code}</div>
          <button className="btn" onClick={share}>
            {copied ? 'Link copied' : 'Share the link'}
          </button>
          <p className="fine">{t.peers + 1} here.</p>
        </div>

        {t.host ? (
          <>
            <div className="fld">
              <span>Pick a game</span>
              <div className="picker">
                {GROUPS.map((group) => (
                  <div className="pick-group" key={group}>
                    <h3>{group.toUpperCase()}</h3>
                    <div className="pick-grid">
                      {PRESETS.filter((p) => p.group === group).map((p) => (
                        <div className="pick-wrap" key={p.id}>
                          <button
                            className="pick"
                            onClick={() => {
                              t.host!.setup(p.id)
                              onClose()
                            }}
                          >
                            <b>{p.name}</b>
                            <span className="who">{p.players} players</span>
                            <i>{p.hint}</i>
                          </button>
                          <button
                            className="pick-info"
                            onClick={() => onRules(p.id)}
                            aria-label={`How to play ${p.name}`}
                            title={`How to play ${p.name}`}
                          >
                            ?
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <p className="fine">
                A game here only decides which cards come out, how many each person gets, and where
                they start. Nothing is enforced - you play it the way your family plays it.
              </p>
            </div>

          </>
        ) : (
          <p className="fine">
            Whoever started the table sets it up and deals. You can move any card that is on the
            table or in your hand.
          </p>
        )}

        <div className="fld">
          <button className="btn danger" onClick={t.leave}>
            {t.host ? 'Close the table' : 'Leave'}
          </button>
          {t.host && <p className="fine">Closing your tab ends the game for everyone.</p>}
        </div>
      </div>
    </div>
  )
}
