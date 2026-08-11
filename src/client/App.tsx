import { useCallback, useEffect, useRef, useState } from 'react'
import type { CardId } from '../table/model.ts'
import { TABLE_H, TABLE_W } from '../table/model.ts'
import { GROUPS, PRESETS } from '../table/deck.ts'
import { cleanCode } from '../net/peers.ts'
import { rememberedName, useTable } from './useTable.ts'
import { Table } from './Table.tsx'
import { Home, Invite } from './Home.tsx'
import { Rules } from './Rules.tsx'
import { Card } from './Card.tsx'
import { Toolbar } from './Toolbar.tsx'
import { BetBar } from './BetBar.tsx'
import { Log, Toasts } from './Log.tsx'

export function App() {
  const t = useTable()
  const [rules, setRules] = useState<string | null>(null)
  // A link with a code on it means somebody invited you; that gets its own
  // page rather than dropping you on the sales pitch.
  const [invited, setInvited] = useState(() => cleanCode(location.hash.replace('#', '')))

  // Pasting a link into an already-open tab only changes the hash, which does
  // not reload anything — so watch for it.
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
            initialName={rememberedName()}
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
            initialName={rememberedName()}
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
  // Wide screens get the log beside the table; small ones slide it over.
  const [log, setLog] = useState(() => matchMedia('(min-width: 1080px)').matches)
  const fileRef = useRef<HTMLDivElement>(null)

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

  const play = (ids: CardId[], faceUp: boolean) =>
    t.act({ t: 'play', ids, x: TABLE_W / 2, y: TABLE_H / 2 - 60, faceUp })

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
        />
        {view.cards.length === 0 && (
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

        <Toolbar host={t.host} view={view} me={t.me} onGames={() => setSheet(true)} act={t.act} />
        {/* Over the table, so it lands wherever the table is rather than
            drifting off-centre when the log takes the right-hand column. */}
        <Toasts view={view} me={t.me} logOpen={log} />
      </div>

      <div className="rail" ref={fileRef}>
        <div className="rail-head">
          <span className="lbl">
            YOUR HAND · {myHand.length}
            {picked.length > 0 && <em> · {picked.length} picked</em>}
            {/* Chips are shown once, on the bet bar just below. */}
          </span>
          <div className="rail-acts">
            <button
              className="mini"
              disabled={!picked.length}
              onClick={() => {
                play(picked, true)
                setPicked([])
              }}
            >
              Play face up
            </button>
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
            {picked.length > 0 && (
              <button className="mini" onClick={() => setPicked([])}>
                Clear
              </button>
            )}
          </div>
        </div>

        {view.chipsOn && t.me && <BetBar view={view} me={t.me} act={t.act} />}

        <div className="fan">
          {myHand.length === 0 && (
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
                onClick={() =>
                  setPicked((p) => (p.includes(c.id) ? p.filter((x) => x !== c.id) : [...p, c.id]))
                }
              >
                <Card face={c.face} small={myHand.length > 9} selected={chosen} />
              </button>
            )
          })}
        </div>
      </div>

      <Log view={view} me={t.me} open={log} onClose={() => setLog(false)} act={t.act} />

      {sheet && <Sheet t={t} onClose={() => setSheet(false)} onRules={(id) => setRules(id)} />}
      {rules && <Rules gameId={rules} onClose={() => setRules(null)} />}
      {t.note && <div className="note">{t.note}</div>}
    </div>
  )
}

/**
 * A held hand is an arc, not a row. Cards tilt away from the middle and dip at
 * the edges, and they overlap only as much as the count demands — enough that
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
                they start. Nothing is enforced — you play it the way your family plays it.
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
