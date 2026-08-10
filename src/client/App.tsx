import { useCallback, useRef, useState } from 'react'
import type { CardId } from '../table/model.ts'
import { TABLE_H, TABLE_W } from '../table/model.ts'
import { PRESETS } from '../table/deck.ts'
import { cleanCode } from '../net/peers.ts'
import { rememberedName, useTable } from './useTable.ts'
import { Table } from './Table.tsx'
import { Card } from './Card.tsx'

export function App() {
  const t = useTable()
  const hashCode = cleanCode(location.hash.replace('#', ''))

  if (t.stage === 'lobby') return <Lobby onCreate={t.create} onJoin={t.join} code={hashCode} />
  if (t.stage === 'joining' || !t.view) return <Joining code={t.code} isHost={t.isHost} />

  return <TableScreen t={t} />
}

// ---------------------------------------------------------------------------

function Lobby({
  onCreate,
  onJoin,
  code,
}: {
  onCreate: (n: string) => void
  onJoin: (c: string, n: string) => void
  code: string
}) {
  const [name, setName] = useState(rememberedName())
  const [join, setJoin] = useState(code)
  const ready = name.trim().length > 0

  return (
    <div className="lobby">
      <h1>suitfold</h1>
      <p className="lede">
        A table, a deck, and whoever you invite. Move the cards around like you would at a kitchen
        table — the app does not know what game you are playing, and does not need to.
      </p>

      <label className="fld">
        <span>Your name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Dad" maxLength={14} />
      </label>

      <label className="fld">
        <span>Table code</span>
        <div className="row">
          <input
            className="code-in"
            value={join}
            onChange={(e) => setJoin(cleanCode(e.target.value))}
            placeholder="ABC23"
          />
          <button className="btn primary" disabled={!ready || join.length < 4} onClick={() => onJoin(join, name.trim())}>
            Join
          </button>
        </div>
      </label>

      <div className="or">or</div>

      <button className="btn" disabled={!ready} onClick={() => onCreate(name.trim())}>
        Start a new table
      </button>

      <p className="fine">
        Whoever starts the table holds the deck, so keep that tab open. Nothing is saved anywhere.
      </p>
    </div>
  )
}

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
  const [picked, setPicked] = useState<CardId[]>([])
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

  const play = (ids: CardId[], faceUp: boolean) =>
    t.act({ t: 'play', ids, x: TABLE_W / 2, y: TABLE_H / 2 - 60, faceUp })

  return (
    <div className="app">
      <header className="bar">
        <div className="brand">
          <i className="mark">♠</i>
          <b>suitfold</b>
        </div>
        <div className="seats">
          {view.seats.map((s) => (
            <span key={s.id} className={`chip ${s.connected ? '' : 'off'}`} style={{ borderColor: s.colour }}>
              <i style={{ background: s.colour }} />
              {s.name}
              <b>{view.handCounts[s.id] ?? 0}</b>
            </span>
          ))}
        </div>
        <button className="menu" onClick={() => setSheet(true)} aria-label="Table menu">
          <i />
          <i />
          <i />
        </button>
      </header>

      <Table
        view={view}
        me={t.me}
        drags={t.drags}
        onMove={move}
        onFlip={flip}
        onTake={take}
        onDrag={t.broadcastDrag}
        onStack={(ids) => shuffleStack(ids)}
      />

      <div className="rail" ref={fileRef}>
        <div className="rail-head">
          <span className="lbl">YOUR HAND · {myHand.length}</span>
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
          </div>
        </div>

        <div className="fan">
          {myHand.length === 0 && <div className="fan-empty">Drag a card down here to pick it up</div>}
          {myHand.map((c, i) => (
            <button
              key={c.id}
              className={`fan-card ${picked.includes(c.id) ? 'is-sel' : ''}`}
              style={{ marginLeft: i === 0 ? 0 : handOverlap(myHand.length) }}
              onClick={() =>
                setPicked((p) => (p.includes(c.id) ? p.filter((x) => x !== c.id) : [...p, c.id]))
              }
            >
              <Card face={c.face} selected={picked.includes(c.id)} />
            </button>
          ))}
        </div>
      </div>

      {sheet && <Sheet t={t} onClose={() => setSheet(false)} />}
      {t.note && <div className="note">{t.note}</div>}
    </div>
  )
}

const handOverlap = (n: number) => (n > 13 ? -30 : n > 9 ? -24 : n > 6 ? -16 : -8)

// ---------------------------------------------------------------------------

function Sheet({ t, onClose }: { t: ReturnType<typeof useTable>; onClose: () => void }) {
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
              <span>Set the table</span>
              <div className="presets">
                {PRESETS.map((p) => (
                  <button
                    key={p.id}
                    className="preset"
                    onClick={() => {
                      t.host!.setup(p.id)
                      onClose()
                    }}
                  >
                    <b>{p.name}</b>
                    <i>{p.hint}</i>
                  </button>
                ))}
              </div>
              <p className="fine">
                These only decide which cards come out and how many each person gets. No rules are
                enforced — that is the point.
              </p>
            </div>

            <div className="fld">
              <span>Deal from the biggest face-down pile</span>
              <div className="row">
                {[1, 2, 5, 7, 13].map((n) => (
                  <button key={n} className="btn" onClick={() => t.host!.deal(n)}>
                    {n}
                  </button>
                ))}
              </div>
            </div>

            <div className="fld">
              <span>Everything</span>
              <button className="btn" onClick={() => t.host!.gather()}>
                Gather and shuffle
              </button>
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
