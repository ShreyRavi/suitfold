import { useEffect, useMemo, useState } from 'react'
import type { Command, PokerActionKind } from '../core/types.ts'
import type { RoomView, ZoneView } from '../core/project.ts'
import type { LogEntry } from '../core/narrate.ts'
import {
  ActionLog,
  AwayNote,
  Card,
  Hand,
  Pot,
  RaiseControl,
  Seat,
  TurnIndicator,
  Zone,
  cardLabel,
  chips,
} from './components.tsx'
import { normaliseCode } from '../net/peers.ts'

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------

export function Nav({
  view,
  onMenu,
  isHost,
  code,
  peers,
}: {
  view: RoomView | null
  onMenu: () => void
  isHost: boolean
  code: string
  peers: number
}) {
  return (
    <nav className="nav">
      <div className="brand">
        <div className="brand-mark" aria-hidden="true">
          ♠
        </div>
        <div className="brand-word">suitfold</div>
      </div>
      <div className="nav-meta">
        {(view?.mode ?? 'poker').toUpperCase()}
        <br />
        {code} · {peers + 1} HERE
      </div>
      <button className="nav-menu" onClick={onMenu} aria-label={isHost ? 'Host menu' : 'Menu'} type="button">
        <i />
        <i />
        <i />
      </button>
    </nav>
  )
}

// ---------------------------------------------------------------------------
// Lobby — start a table or join one with a code
// ---------------------------------------------------------------------------

export function Lobby({
  onHost,
  onJoin,
  initialName,
  initialCode,
}: {
  onHost: (name: string) => void
  onJoin: (code: string, name: string) => void
  initialName: string
  initialCode: string
}) {
  const [name, setName] = useState(initialName)
  const [code, setCode] = useState(initialCode)
  const ready = name.trim().length > 0

  return (
    <div className="centre">
      <h1>suitfold</h1>
      <p>
        Cards for people who already know each other. Someone starts a table, everyone else types
        the code. No accounts, no install, no money.
      </p>

      <div className="field">
        <label htmlFor="name">YOUR NAME</label>
        <input
          id="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Dad"
          autoComplete="off"
          maxLength={16}
        />
      </div>

      <div className="field">
        <label htmlFor="code">JOIN A TABLE</label>
        <div style={{ display: 'flex', gap: 'var(--s-4)' }}>
          <input
            id="code"
            value={code}
            onChange={(e) => setCode(normaliseCode(e.target.value))}
            placeholder="ABC123"
            autoComplete="off"
            inputMode="text"
            style={{ flex: 1, fontFamily: 'var(--font-mono)', letterSpacing: '.18em' }}
          />
          <button
            className="btn btn--primary"
            type="button"
            style={{ flex: 'none', padding: '0 var(--s-8)' }}
            disabled={!ready || code.length < 4}
            onClick={() => onJoin(code, name.trim())}
          >
            Join
          </button>
        </div>
      </div>

      <div className="lobby-or">or</div>

      <button className="btn" type="button" disabled={!ready} onClick={() => onHost(name.trim())}>
        Start a new table
      </button>

      <p className="ledger-sub">
        Whoever starts the table deals. Keep that tab open — it is the game.
      </p>
    </div>
  )
}

export function Connecting({ code, isHost }: { code: string; isHost: boolean }) {
  return (
    <div className="centre">
      <h1>{isHost ? 'Setting the table…' : 'Looking for the table…'}</h1>
      <p>
        {isHost
          ? 'Give everyone this code.'
          : `Finding whoever is hosting ${code}. They need to have the tab open.`}
      </p>
      {isHost && <div className="code-big">{code}</div>}
      <p className="ledger-sub">
        Connecting phone to phone. On a stubborn network this can take a few seconds.
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Poker table
// ---------------------------------------------------------------------------

export function PokerTable({
  view,
  log,
  you,
  isHost,
  missed,
  clearMissed,
  send,
  descriptions,
}: {
  view: RoomView
  log: LogEntry[]
  you: string | null
  isHost: boolean
  missed: LogEntry[]
  clearMissed: () => void
  send: (c: Command) => void
  descriptions: Record<string, string>
}) {
  const p = view.poker
  const me = view.seats.find((s) => s.isYou)
  const [raising, setRaising] = useState(false)
  const [raiseTo, setRaiseTo] = useState(p.minRaiseTo)

  useEffect(() => {
    if (!p.canAct) setRaising(false)
    setRaiseTo(Math.min(p.minRaiseTo, p.maxRaiseTo))
  }, [p.canAct, p.minRaiseTo, p.maxRaiseTo, p.handNumber, view.turn])

  const board = view.zones.find((z) => z.id === 'board')
  const hand = view.zones.find((z) => z.owner === you && z.kind === 'hand')
  const rows = seatRows(view)
  const showReveal = p.result?.showdown && Object.keys(p.result.reveal).length > 0

  const act = (action: PokerActionKind, amount?: number) => {
    if (!you) return
    send({ c: 'poker_action', seatId: you, action, amount })
    setRaising(false)
  }

  return (
    <>
      <AwayNote entries={missed} onDismiss={clearMissed} />

      <div className="table">
        {rows.top.map((row, i) => (
          <div className="seat-row" key={`t${i}`}>
            {row.map((s) => (
              <Seat key={s.id} seat={s} view={view} showChips />
            ))}
          </div>
        ))}

        <div className="zones">
          <Pot view={view} />
          {board && board.count > 0 ? (
            <div className="board">
              {board.cards.map((c, i) => (
                <Card key={i} card={c} size="md" />
              ))}
            </div>
          ) : (
            <div className="board-empty">
              {p.phase === 'idle' ? 'waiting for the next hand' : 'preflop — no board yet'}
            </div>
          )}
        </div>

        {rows.bottom.map((row, i) => (
          <div className="seat-row" key={`b${i}`}>
            {row.map((s) => (
              <Seat key={s.id} seat={s} view={view} showChips />
            ))}
          </div>
        ))}
      </div>

      {showReveal && <Reveal view={view} descriptions={descriptions} />}

      <ActionLog log={log} you={you} />

      {isHost && <HostStrip view={view} send={send} />}

      <div className="rail">
        <div className="rail-head">
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-5)' }}>
            <div>
              <div className="rail-label">YOUR CHIPS</div>
              <div className="rail-value">{chips(me?.stack ?? 0)}</div>
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            {p.canAct ? (
              <TurnIndicator text="YOUR TURN" />
            ) : (
              <>
                <div className="rail-label">WAITING ON</div>
                <div className="rail-note">
                  {view.seats.find((s) => s.id === view.turn)?.name ?? 'the deal'}
                </div>
              </>
            )}
          </div>
        </div>

        {hand && hand.count > 0 && <Hand cards={hand.cards} selected={null} />}

        {raising && p.canAct ? (
          <>
            <RaiseControl view={view} value={raiseTo} onChange={setRaiseTo} />
            <div className="actions">
              <button className="btn" type="button" onClick={() => setRaising(false)}>
                Back
              </button>
              <button
                className="btn btn--primary"
                type="button"
                onClick={() => act(p.legal.includes('bet') ? 'bet' : 'raise', raiseTo)}
              >
                {raiseTo >= p.maxRaiseTo
                  ? `All-in ${chips(raiseTo)}`
                  : p.legal.includes('bet')
                    ? `Bet ${chips(raiseTo)}`
                    : `Raise to ${chips(raiseTo)}`}
              </button>
            </div>
          </>
        ) : (
          <div className="actions">
            <Actions view={view} onAct={act} onRaise={() => setRaising(true)} />
          </div>
        )}
      </div>
    </>
  )
}

/** The primary button always names the actual pending act, in words. */
function Actions({
  view,
  onAct,
  onRaise,
}: {
  view: RoomView
  onAct: (a: PokerActionKind, amount?: number) => void
  onRaise: () => void
}) {
  const p = view.poker
  if (!p.canAct) {
    const phase = p.phase === 'complete' ? 'Next hand in a moment' : 'Not your turn'
    return (
      <button className="btn" type="button" disabled>
        {phase}
      </button>
    )
  }

  return (
    <>
      {p.legal.includes('fold') && (
        <button className="btn" type="button" onClick={() => onAct('fold')}>
          Fold
        </button>
      )}
      {p.legal.includes('check') && (
        <button className="btn" type="button" onClick={() => onAct('check')}>
          Check
        </button>
      )}
      {p.legal.includes('call') && (
        <button className="btn btn--primary" type="button" onClick={() => onAct('call')}>
          Call {chips(p.toCall)}
        </button>
      )}
      {(p.legal.includes('raise') || p.legal.includes('bet')) && (
        <button
          className={`btn ${p.legal.includes('call') ? '' : 'btn--primary'}`}
          type="button"
          onClick={onRaise}
        >
          {p.legal.includes('bet') ? 'Bet' : 'Raise'}
        </button>
      )}
    </>
  )
}

/** Host controls that must be reachable DURING a hand without covering the table. */
function HostStrip({ view, send }: { view: RoomView; send: (c: Command) => void }) {
  const stuck = view.seats.find((s) => s.id === view.turn && !s.connected)
  const busted = view.seats.filter((s) => s.stack === 0 && !s.away)
  const handLive = view.poker.phase !== 'complete' && view.poker.phase !== 'idle'

  if (!stuck && busted.length === 0) return null

  return (
    <div className="host-strip">
      {stuck && (
        <button type="button" onClick={() => send({ c: 'force_fold', seatId: stuck.id, target: stuck.id })}>
          Fold for {stuck.name} (offline)
        </button>
      )}
      {!handLive &&
        busted.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() =>
              send({ c: 'restack', seatId: s.id, target: s.id, amount: view.settings.startingStack })
            }
          >
            Re-stack {s.name}
          </button>
        ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Mucked reveal — showdown only
// ---------------------------------------------------------------------------

function Reveal({ view, descriptions }: { view: RoomView; descriptions: Record<string, string> }) {
  const p = view.poker
  if (!p.result) return null
  const winners = new Set(p.result.awards.flatMap((a) => a.seatIds))

  return (
    <div className="reveal">
      {view.seats
        .filter((s) => (p.result?.reveal[s.id] ?? []).length > 0)
        .map((s) => {
          const cards = p.result!.reveal[s.id] ?? []
          const folded = p.folded.includes(s.id)
          return (
            <div
              key={s.id}
              className={`reveal-row ${winners.has(s.id) ? 'is-winner' : ''} ${folded ? 'is-folded' : ''}`}
            >
              <div className="reveal-cards">
                {cards.map((id) => (
                  <Card key={id} card={{ id, faceUp: true }} size="sm" />
                ))}
              </div>
              <div className="reveal-who">
                <b>{s.name}</b>
                <span>{folded ? 'folded' : (descriptions[s.id] ?? '')}</span>
              </div>
            </div>
          )
        })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sandbox table — tap to select, tap to move
// ---------------------------------------------------------------------------

export function SandboxTable({
  view,
  log,
  you,
  isHost,
  missed,
  clearMissed,
  send,
}: {
  view: RoomView
  log: LogEntry[]
  you: string | null
  isHost: boolean
  missed: LogEntry[]
  clearMissed: () => void
  send: (c: Command) => void
}) {
  const [picked, setPicked] = useState<{ zone: string; index: number } | null>(null)
  const [menu, setMenu] = useState<ZoneView | null>(null)

  const hand = view.zones.find((z) => z.owner === you && z.kind === 'hand')
  const shared = view.zones.filter((z) => z.kind !== 'hand')
  const rows = seatRows(view)

  const pickedCard =
    picked && view.zones.find((z) => z.id === picked.zone)?.cards[picked.index]

  const move = (to: string) => {
    if (!picked || !you || !pickedCard?.id) return
    send({ c: 'move', seatId: you, cardIds: [pickedCard.id], from: picked.zone, to })
    setPicked(null)
  }

  return (
    <>
      <AwayNote entries={missed} onDismiss={clearMissed} />

      <div className="table">
        {rows.top.map((row, i) => (
          <div className="seat-row" key={`t${i}`}>
            {row.map((s) => (
              <Seat key={s.id} seat={s} view={view} showChips={view.settings.counters} />
            ))}
          </div>
        ))}

        <div className="zones">
          <div className="zone-grid">
            {shared.map((z) => (
              <Zone
                key={z.id}
                zone={z}
                target={picked !== null && picked.zone !== z.id}
                onZone={picked && picked.zone !== z.id ? () => move(z.id) : undefined}
                onMenu={() => setMenu(z)}
              />
            ))}
          </div>
        </div>

        {rows.bottom.map((row, i) => (
          <div className="seat-row" key={`b${i}`}>
            {row.map((s) => (
              <Seat key={s.id} seat={s} view={view} showChips={view.settings.counters} />
            ))}
          </div>
        ))}
      </div>

      <ActionLog log={log} you={you} />

      <div className="rail">
        <div className="rail-head">
          <div>
            <div className="rail-label">YOUR HAND · {hand?.count ?? 0}</div>
            <div className="rail-note">
              {pickedCard?.id
                ? `${cardLabel(pickedCard.id)} selected`
                : 'tap a card, then tap where it goes'}
            </div>
          </div>
          {view.settings.counters && (
            <div style={{ textAlign: 'right' }}>
              <div className="rail-label">YOUR CHIPS</div>
              <div className="rail-value">{chips(view.seats.find((s) => s.isYou)?.stack ?? 0)}</div>
            </div>
          )}
        </div>

        {hand && (
          <Hand
            cards={hand.cards}
            selected={picked?.zone === hand.id ? picked.index : null}
            onSelect={(i) =>
              setPicked((prev) =>
                prev?.zone === hand.id && prev.index === i ? null : { zone: hand.id, index: i },
              )
            }
          />
        )}

        <div className="actions">
          {picked ? (
            <button className="btn" type="button" onClick={() => setPicked(null)}>
              Deselect
            </button>
          ) : (
            <button className="btn" type="button" disabled>
              Nothing selected
            </button>
          )}
          {isHost && (
            <button
              className="btn btn--primary"
              type="button"
              onClick={() => you && send({ c: 'reset_table', seatId: you })}
            >
              Reshuffle &amp; deal
            </button>
          )}
        </div>
      </div>

      {menu && (
        <>
          <div className="scrim" onClick={() => setMenu(null)} />
          <div className="zone-menu">
            <h3>{menu.label}</h3>
            {picked && picked.zone !== menu.id && (
              <button type="button" onClick={() => { move(menu.id); setMenu(null) }}>
                Move the selected card here
              </button>
            )}
            {isHost && (
              <>
                <button
                  type="button"
                  onClick={() => { you && send({ c: 'shuffle', seatId: you, zoneId: menu.id }); setMenu(null) }}
                >
                  Shuffle this pile
                </button>
                {menu.kind === 'deck' && (
                  <>
                    <button
                      type="button"
                      onClick={() => { you && send({ c: 'deal', seatId: you, from: menu.id, count: 1, faceUp: false }); setMenu(null) }}
                    >
                      Deal 1 to everyone
                    </button>
                    <button
                      type="button"
                      onClick={() => { you && send({ c: 'deal', seatId: you, from: menu.id, count: 5, faceUp: false }); setMenu(null) }}
                    >
                      Deal 5 to everyone
                    </button>
                  </>
                )}
                <button
                  type="button"
                  onClick={() => { you && send({ c: 'gather', seatId: you, to: menu.id }); setMenu(null) }}
                >
                  Gather every card here
                </button>
              </>
            )}
            <button type="button" onClick={() => setMenu(null)}>
              Close
            </button>
          </div>
        </>
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Offline
// ---------------------------------------------------------------------------

export function Offline({ connection }: { connection: string }) {
  return (
    <div className="centre">
      <h1>{connection === 'connecting' ? 'Finding the table…' : 'The table is closed'}</h1>
      <p>
        suitfold runs on someone&rsquo;s laptop. If it&rsquo;s shut, the link goes quiet until they open
        it again — nothing is lost, the whole night is saved.
      </p>
      <p className="ledger-sub">Reconnecting automatically.</p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Seat layout: even rows on the rim, not an oval
// ---------------------------------------------------------------------------

function seatRows(view: RoomView) {
  // At 390px an oval squeezes the side seats to ~60px and names wrap. Rows of
  // two ride the rim instead, and going from four seats to eight is adding
  // rows rather than redesigning.
  const others = view.seats.filter((s) => !s.isYou)
  const half = Math.ceil(others.length / 2)
  const chunk = (xs: typeof others) => {
    const out: (typeof others)[] = []
    for (let i = 0; i < xs.length; i += 2) out.push(xs.slice(i, i + 2))
    return out
  }
  return { top: chunk(others.slice(0, half)), bottom: chunk(others.slice(half)) }
}

