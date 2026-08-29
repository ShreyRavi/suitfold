import { useCallback, useEffect, useRef, useState } from 'react'
import type { CardId, SeatId, TableView } from '../table/model.ts'
import { SNAP, TABLE_H, TABLE_W, seatPlaces } from '../table/model.ts'
import { GROUPS, PRESETS } from '../table/deck.ts'
import { cleanCode } from '../net/peers.ts'
import { forgetKey, houseKey, inviteLink, isLocked, keyWorks } from '../net/socket.ts'
import { rememberedFace, rememberedName, suggestFace, suggestName, useTable } from './useTable.ts'
import { Table, toTableCoords } from './Table.tsx'
import { Home, Invite } from './Home.tsx'
import { Rules } from './Rules.tsx'
import { Card } from './Card.tsx'
import { Toolbar } from './Toolbar.tsx'
import { BetBar } from './BetBar.tsx'
import { Log, Mention, Toasts } from './Log.tsx'
import { Help, SEEN_HELP } from './Help.tsx'
import { badge } from './desktop.ts'
import { Gate } from './Gate.tsx'

const RAIL_H = 'suitfold.railh'
import { Clock, Pad } from './Pad.tsx'
import { presetById } from '../table/deck.ts'

export function App() {
  const t = useTable()
  // Does this table want a phrase, and do we have one? Asked once, on the way
  // in, so nobody is stopped halfway through sitting down.
  const [locked, setLocked] = useState<boolean | null>(null)
  const [key, setKey] = useState(houseKey())

  useEffect(() => {
    let alive = true
    void (async () => {
      const wants = await isLocked()
      if (!alive) return
      if (!wants) {
        setLocked(false)
        return
      }
      // A phrase that used to work and does not any more should send you back
      // to the door. Without this the socket is simply refused and you sit on
      // "finding the table" forever, being told the host needs their tab open
      // when the host is right there and it is the phrase that is wrong.
      const mine = houseKey()
      if (mine && !(await keyWorks(mine))) {
        forgetKey()
        if (alive) setKey('')
      }
      if (alive) setLocked(true)
    })()
    return () => {
      alive = false
    }
  }, [])
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

  // Waiting on the table to say whether it is locked. It is one request to
  // something on the same machine, so this is a blink.
  if (locked === null) return <div className="gate" />
  if (locked && !key) {
    return (
      <Gate
        onIn={() => {
          setKey(houseKey())
        }}
      />
    )
  }

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
  const [copiedCode, setCopiedCode] = useState(false)

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
      // Let go anywhere near the pile and it joins the pile, the same as
      // dragging a card that is already on the table.
      const at = snapNear(view, p.x, p.y, id)
      // Face down: putting a card down and showing it are separate decisions.
      t.act({ t: 'play', ids: [id], x: Math.round(at.x), y: Math.round(at.y), faceUp: false })
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
      if (t.dealer) t.dealer.shuffleStack(ids)
      else t.act({ t: 'reorder', ids: [...ids].reverse() })
    },
    [t],
  )

  // Only worth counting while the log is shut; once it is open you can see it.
  const unread = log ? 0 : view.log.filter((e) => e.kind === 'chat').length

  // The same number, on the dock icon, when this is the Mac app.
  useEffect(() => badge(unread), [unread])
  const deck = drawPile(view)
  const trick = faceUpOnTable(view)
  // The heap in the middle, and anything that has wandered off it.
  const middle = view.slots.find((sl) => sl.play)
  const pile = middle
    ? view.cards.filter((c) => c.hand === null && c.x === middle.x && c.y === middle.y).map((c) => c.id)
    : []
  const loose = middle
    ? view.cards.filter((c) => c.hand === null && !(c.x === middle.x && c.y === middle.y)).map((c) => c.id)
    : []

  const play = (ids: CardId[], faceUp: boolean) => {
    // Sevens is built in four rows, one per suit, running out from the seven.
    // Sending every card to one spot, or to the space in front of you, means
    // dragging each one to its row - which is the entire game.
    if (presetById(view.game).bySuit) {
      for (const id of ids) {
        const card = view.cards.find((c) => c.id === id)
        const at = suitRow(view, card?.face ?? id)
        if (at) t.act({ t: 'play', ids: [id], x: at.x, y: at.y, faceUp: true })
      }
      return
    }
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
        <button
          className={`bar-code ${copiedCode ? 'is-copied' : ''}`}
          onClick={async () => {
            await copyLink(inviteLink(t.code))
            setCopiedCode(true)
            setTimeout(() => setCopiedCode(false), 1600)
          }}
          title="Copy the link to this table"
        >
          {copiedCode ? 'Copied' : t.code}
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
                {t.dealer ? (
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
          <Toolbar host={t.dealer} view={view} me={t.me} onGames={() => setSheet(true)} act={t.act} />
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

          {/* The moves that happen over and over. Drawing a card was a drag
              from the deck to the rail every single turn; taking a trick was
              four separate picks, thirteen times a hand. */}
          <div className="rail-acts">
            {deck.length > 0 && (
              <button
                className="mini is-go"
                onClick={() => {
                  const top = topOf(view, deck)
                  if (top && t.me) t.act({ t: 'take', ids: [top], seat: t.me })
                }}
              >
                Draw
              </button>
            )}
            {presetById(view.game).trick && trick.length > 0 && (
              <button
                className="mini is-go"
                onClick={() => t.me && t.act({ t: 'take', ids: trick, seat: t.me })}
              >
                Take the pile · {trick.length}
              </button>
            )}
            {myHand.length > 1 && (
              <button className="mini" onClick={() => t.act({ t: 'reorder', ids: tidy(myHand) })}>
                Sort
              </button>
            )}
          </div>

          {/* In a game where you announce what you are putting down - and are
              allowed to be lying about it - the announcement should not cost
              more than the move. One tap plays the cards and says what they
              are, truthfully or otherwise. */}
          {presetById(view.game).claim === 'rank' && (
            <div className={`claim ${picked.length ? 'is-ready' : ''}`}>
              <span className="claim-lbl">
                {picked.length ? `Put ${picked.length} down as` : 'Pick your cards, then say what they are'}
              </span>
              <div className="claim-ranks">
                {RANKS.map((r) => (
                  <button
                    key={r}
                    className="claim-rank"
                    disabled={!picked.length}
                    onClick={() => {
                      const n = picked.length
                      play(picked, false)
                      if (t.me) t.act({ t: 'say', seat: t.me, text: `${n} × ${r === 'T' ? '10' : r}` })
                      setPicked([])
                    }}
                  >
                    {r === 'T' ? '10' : r}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Calling a liar, and clearing up afterwards. Every one of these was
              a hold, a menu and a guess about which cards were the ones in
              question. */}
          {presetById(view.game).claim === 'rank' && (
            <div className="rail-acts">
              {pile.length > 0 && (
                <button
                  className="mini"
                  onClick={() => t.me && t.act({ t: 'take', ids: pile, seat: t.me })}
                >
                  Take the pile · {pile.length}
                </button>
              )}
              {(view.lastPlay?.length ?? 0) > 0 && (
                <button
                  className="mini is-go"
                  onClick={() => {
                    // Lay the set out in a row where everybody can count it,
                    // rather than turning over a heap and arguing.
                    const shown = view.lastPlay ?? []
                    const middle = view.slots.find((sl) => sl.play)
                    const y = (middle?.y ?? TABLE_H / 2) - 170
                    const left = (middle?.x ?? TABLE_W / 2) - ((shown.length - 1) * 104) / 2
                    shown.forEach((id, i) => {
                      t.act({ t: 'move', ids: [id], x: Math.round(left + i * 104), y: Math.round(y) })
                    })
                    t.act({ t: 'flip', ids: shown, faceUp: true })
                  }}
                >
                  Check the bluff · {view.lastPlay?.length ?? 0}
                </button>
              )}
              {loose.length > 0 && (
                <button
                  className="mini"
                  onClick={() => {
                    const middle = view.slots.find((sl) => sl.play)
                    if (!middle) return
                    t.act({ t: 'flip', ids: loose, faceUp: false })
                    t.act({ t: 'play', ids: loose, x: middle.x, y: middle.y, faceUp: false })
                  }}
                >
                  Back on the pile · {loose.length}
                </button>
              )}
            </div>
          )}

          {/* Judgement is won and lost on the bid, and saying it out loud was
              a sentence typed into chat before every single round. */}
          {presetById(view.game).claim === 'bid' && (
            <div className="claim is-ready">
              <span className="claim-lbl">How many tricks are you taking?</span>
              <div className="claim-ranks">
                {Array.from({ length: Math.min(myHand.length, 13) + 1 }, (_, n) => (
                  <button
                    key={n}
                    className="claim-rank"
                    onClick={() => t.me && t.act({ t: 'say', seat: t.me, text: `bids ${n}` })}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
          )}

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
        isHost={!!t.dealer}
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
      {t.oldTable && (
        <div className="stale">
          This table is being held by an older version of suitfold. Most things will work; some
          newer bits will not. Update the app that is holding it.
        </div>
      )}
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
  // Some games are played into a shared heap in the middle: the pile in Bluff
  // and Snap, the discard in Uno, the pairs in Old Maid. In those, the space in
  // front of you is exactly the wrong place, and putting cards there meant
  // dragging them to the middle afterwards on every single turn.
  const shared = view.slots.find((s) => s.play)
  if (shared) return { x: shared.x, y: shared.y }

  const mine = seatPlaces(view.seats).find((p) => p.seat.id === me)
  return mine ? mine.drop : freeSpot(view)
}

/**
 * The pile you draw from: the one the game marked out, or failing that the
 * biggest face-down heap on the table.
 */
function drawPile(view: TableView) {
  const marked = view.slots.find((s) => ['draw', 'deck', 'stock'].includes(s.id))
  const piles = new Map<string, CardId[]>()
  for (const c of view.cards) {
    if (c.hand !== null || c.faceUp) continue
    const key = `${c.x},${c.y}`
    piles.set(key, [...(piles.get(key) ?? []), c.id])
  }
  if (marked) {
    const there = piles.get(`${marked.x},${marked.y}`)
    if (there?.length) return there
  }
  return [...piles.values()].sort((a, b) => b.length - a.length)[0] ?? []
}

/** The top card of a pile is the one drawn highest. */
const topOf = (view: TableView, ids: CardId[]) => {
  const byZ = view.cards.filter((c) => ids.includes(c.id)).sort((a, b) => b.z - a.z)
  return byZ[0]?.id
}

/** Everything face up on the table, which in a trick game is the trick. */
const faceUpOnTable = (view: TableView) =>
  view.cards.filter((c) => c.hand === null && c.faceUp).map((c) => c.id)

const SUIT_ORDER = ['S', 'H', 'C', 'D']
const RANK_ORDER = ['A', '2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K']

/**
 * A hand, in the order you would arrange it yourself: suits together, running
 * up in rank. Thirteen cards dealt in random order is otherwise a minute of
 * dragging before every single hand.
 */
function tidy(cards: { id: CardId; face: string | null }[]): CardId[] {
  const key = (c: { id: CardId; face: string | null }) => {
    const f = c.face ?? c.id
    // Uno by colour then value, tiles by letter, cards by suit then rank.
    if (f.startsWith('U-')) return `1${f.slice(2)}`
    if (f.startsWith('L-') || f.startsWith('D-')) return `2${f}`
    const rank = f[0] ?? ''
    const suit = f[1] ?? ''
    const si = SUIT_ORDER.indexOf(suit)
    const ri = RANK_ORDER.indexOf(rank)
    if (si < 0 || ri < 0) return `3${f}`
    return `0${si}${String(ri).padStart(2, '0')}`
  }
  return [...cards].sort((a, b) => key(a).localeCompare(key(b))).map((c) => c.id)
}

/**
 * Where a card belongs in a game built out from the sevens: its own suit's row,
 * placed above or below the seven by how far from it the rank is.
 */
const SUIT_SLOT: Record<string, string> = { S: 'sp', H: 'he', D: 'di', C: 'cl' }

/** In this one the ace is high, above the king, which the rules also say. */
const SEVENS_ORDER = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A']

function suitRow(view: TableView, face: string) {
  const rank = face[0] ?? ''
  const suit = face[1] ?? ''
  const slot = view.slots.find((s) => s.id === SUIT_SLOT[suit])
  if (!slot) return null
  const away = SEVENS_ORDER.indexOf(rank) - SEVENS_ORDER.indexOf('7')
  // Fanned out from the seven, leaning a little so the row reads as a run
  // without the far ends wandering into the next suit along.
  return { x: slot.x + away * 8, y: slot.y + away * 30 }
}

/** What you can claim to be putting down, which need not be true. */
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K']

/**
 * Where a card let go here belongs: on a pile it landed on, or in a marked
 * spot it was aimed at. The same pull the table itself uses, so dragging out
 * of your hand behaves like dragging anything else.
 */
function snapNear(view: TableView, x: number, y: number, ignore: CardId) {
  let best: { x: number; y: number } | null = null
  let near = SNAP
  for (const c of view.cards) {
    if (c.hand !== null || c.id === ignore) continue
    const d = Math.hypot(c.x - x, c.y - y)
    if (d < near) {
      near = d
      best = { x: c.x, y: c.y }
    }
  }
  for (const slot of view.slots) {
    if (slot.dot) continue
    const d = Math.hypot(slot.x - x, slot.y - y)
    if (d < Math.max(near, SNAP * 1.7)) {
      near = d
      best = { x: slot.x, y: slot.y }
    }
  }
  return best ?? { x, y }
}

/**
 * Put the link on the clipboard. The modern way needs a secure context and
 * permission; the old way needs neither and has never once failed, so it is
 * the fallback rather than the other way round.
 */
async function copyLink(link: string) {
  try {
    await navigator.clipboard.writeText(link)
    return
  } catch {
    /* not allowed here */
  }
  const box = document.createElement('textarea')
  box.value = link
  box.style.position = 'fixed'
  box.style.opacity = '0'
  document.body.appendChild(box)
  box.select()
  try {
    document.execCommand('copy')
  } catch {
    /* nothing left to try */
  }
  box.remove()
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
  const link = inviteLink(t.code)

  // Copy it, always. The share sheet was a second decision on top of the one
  // you had already made, and half the time it offered to post it somewhere.
  const share = async () => {
    await copyLink(link)
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
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
            {copied ? 'Link copied' : 'Copy the link'}
          </button>
          <p className="fine">{t.peers + 1} here.</p>
        </div>

        {t.dealer ? (
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
                              t.dealer!.setup(p.id)
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
