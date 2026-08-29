import { useState } from 'react'
import { useState as useLocal } from 'react'
import { ALL_FACES, FACES } from '../table/model.ts'
import { GROUPS, PRESETS } from '../table/deck.ts'
import { cleanCode } from '../net/peers.ts'
import { rememberServer, tableServer } from '../net/socket.ts'
import { Card } from './Card.tsx'
import { Small } from './Terms.tsx'

/**
 * Pick a face. Names collide at a family table - two people will type "Dad" -
 * and while the host makes the second one "Dad 2", a face tells them apart at
 * a glance in a way a suffix never does.
 */
export function FacePicker({ value, onPick }: { value: string; onPick: (e: string) => void }) {
  const [all, setAll] = useLocal(false)
  const list = all ? ALL_FACES : FACES

  return (
    <div className="faces-wrap">
      <div className={`faces ${all ? 'is-all' : ''}`} role="radiogroup" aria-label="Pick your face">
        {list.map((f) => (
          <button
            key={f}
            type="button"
            role="radio"
            aria-checked={f === value}
            aria-label={`face ${f}`}
            className={`face ${f === value ? 'on' : ''}`}
            onClick={() => onPick(f)}
          >
            {f}
          </button>
        ))}
      </div>
      <button type="button" className="linkish" onClick={() => setAll(!all)}>
        {all ? 'Show fewer' : `All ${ALL_FACES.length} faces`}
      </button>
    </div>
  )
}

/**
 * The front page. It has one job: make it obvious what this is in about three
 * seconds, and get you to a table in one press.
 */
export function Home({
  onCreate,
  onJoin,
  initialName,
  initialFace,
  unfinished,
  onResume,
  onDiscard,
  onRules,
  onTerms,
}: {
  onCreate: (name: string, emoji: string) => void
  onJoin: (code: string, name: string, emoji: string) => void
  initialName: string
  initialFace: string
  /** A table this tab was holding when it went away. */
  unfinished: { code: string; at: number } | null
  onResume: (name: string, emoji: string) => void
  onDiscard: () => void
  onRules: (gameId: string) => void
  onTerms: () => void
}) {
  const [name, setName] = useState(initialName)
  const [face, setFace] = useState(initialFace)
  const [code, setCode] = useState('')
  const ready = name.trim().length > 0

  return (
    <div className="home">
      <header className="home-bar">
        <div className="brand">
          <i className="mark">♠</i>
          <b>suitfold</b>
        </div>
        <span className="home-tag">no accounts · no install · nothing saved</span>
      </header>

      {unfinished && (
        <div className="carry">
          <span>
            Your table <b>{unfinished.code}</b> is still here. This tab was holding it when it
            closed.
          </span>
          <div className="carry-acts">
            <button className="btn primary" disabled={!ready} onClick={() => onResume(name.trim(), face)}>
              Carry on
            </button>
            <button className="btn" onClick={onDiscard}>
              Throw it away
            </button>
          </div>
        </div>
      )}

      <section className="hero">
        <div className="hero-words">
          <h1>
            A card table you
            <br />
            share with a link.
          </h1>
          <p className="hero-sub">
            A deck, a table, your hand, and whoever you invite. Drag the cards around like you would
            at a kitchen table. Everyone sees every card move, the moment it moves.
          </p>

          <div className="hero-go">
            <span className="hero-face" aria-hidden="true">
              {face}
            </span>
            <input
              className="hero-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              maxLength={14}
              aria-label="Your name"
            />
            <button className="btn primary big" disabled={!ready} onClick={() => onCreate(name.trim(), face)}>
              Start a table
            </button>
          </div>

          <FacePicker value={face} onPick={setFace} />

          <div className="hero-join">
            <span>Been given a code?</span>
            <input
              className="code-in small"
              value={code}
              onChange={(e) => setCode(cleanCode(e.target.value))}
              placeholder="ABC23"
              aria-label="Table code"
            />
            <button
              className="btn"
              disabled={!ready || code.length < 4}
              onClick={() => onJoin(code, name.trim(), face)}
            >
              Join
            </button>
          </div>
        </div>

        {/* A hand of cards, fanned, doing nothing but looking like the product. */}
        <div className="hero-art" aria-hidden="true">
          {['AS', 'KH', 'QD', 'JC', 'TS'].map((id, i) => (
            <span key={id} className="hero-card" style={{ '--i': i - 2 } as React.CSSProperties}>
              <Card face={id} />
            </span>
          ))}
        </div>
      </section>

      <section className="strip">
        <Point
          title="Everyone sees it move"
          body="Pick a card up and it slides across every other screen at the same time. Piles form when you drop one card on another."
        />
        <Point
          title="Your hand is yours"
          body="Cards in your hand are never sent to anyone else's browser. A face-down card genuinely has no face in their copy of the table."
        />
        <Point
          title="No rules in the way"
          body="The table deals and moves cards. It never tells you what you may do - so you can play house rules, or a game it has never heard of."
        />
      </section>

      <section className="games">
        <h2>Twenty-one games ready to deal</h2>
        <p className="games-sub">
          Pick one and the right cards come out, dealt the right way, with the table marked out.
          Tap any game to read how it is played.
        </p>
        {GROUPS.map((group) => (
          <div className="games-group" key={group}>
            <h3>{group}</h3>
            <div className="games-row">
              {PRESETS.filter((p) => p.group === group).map((p) => (
                <button key={p.id} className="game-pill" onClick={() => onRules(p.id)}>
                  {p.name}
                  <i>{p.players}</i>
                </button>
              ))}
            </div>
          </div>
        ))}
      </section>

      <section className="how">
        <h2>How it works</h2>
        <ol className="how-steps">
          <li>
            <b>Start a table.</b> You get a five-letter code and a link.
          </li>
          <li>
            <b>Send it round.</b> Anyone who opens it types their name and sits down.
          </li>
          <li>
            <b>Pick a game and deal.</b> One press lays the whole table out.
          </li>
        </ol>
        <div className="fld how-server">
          <span>Your own table server (optional)</span>
          <ServerBox />
          <p className="fine">
            Leave this empty and browsers talk to each other directly, which needs nothing and
            works. Point it at a box you run and everything goes over one socket instead: messages
            arrive in order, reconnecting takes a second, and no public relay is involved. The
            server forwards sealed messages and never sees a card.
          </p>
        </div>

        <p className="how-note">
          There is no server. The browsers talk to each other directly, so nothing you do here is
          stored anywhere - close the tab and the game is over. Whoever starts the table is holding
          the deck, so keep that tab open.
        </p>
      </section>

      <footer className="home-foot">
        <div className="home-foot-row">
          <span>suitfold</span>
          <span>free, and always will be - there is nothing to charge for</span>
        </div>
        <Small onOpen={onTerms} />
      </footer>
    </div>
  )
}

/** Where the table server is, if you run one. Kept in this browser. */
function ServerBox() {
  const [url, setUrl] = useState(tableServer())
  const [saved, setSaved] = useState(false)
  return (
    <div className="row">
      <input
        className="code-in"
        style={{ textTransform: 'none', letterSpacing: 0 }}
        value={url}
        onChange={(e) => {
          setUrl(e.target.value)
          setSaved(false)
        }}
        placeholder="wss://table.example.com"
        aria-label="Table server address"
      />
      <button
        className="btn"
        onClick={() => {
          rememberServer(url.trim())
          setSaved(true)
        }}
      >
        {saved ? 'Saved' : 'Use this'}
      </button>
    </div>
  )
}

function Point({ title, body }: { title: string; body: string }) {
  return (
    <div className="point">
      <h3>{title}</h3>
      <p>{body}</p>
    </div>
  )
}

/**
 * Somebody sent you a link. This is the whole of what you have to do: say who
 * you are.
 */
export function Invite({
  code,
  initialName,
  initialFace,
  onJoin,
  onHome,
}: {
  code: string
  initialName: string
  initialFace: string
  onJoin: (code: string, name: string, emoji: string) => void
  onHome: () => void
}) {
  const [name, setName] = useState(initialName)
  const [face, setFace] = useState(initialFace)
  const ready = name.trim().length > 0

  return (
    <div className="invite">
      <div className="invite-art" aria-hidden="true">
        {['AS', 'KH', 'QD'].map((id, i) => (
          <span key={id} className="hero-card" style={{ '--i': i - 1 } as React.CSSProperties}>
            <Card face={id} />
          </span>
        ))}
      </div>

      <div className="invite-box">
        <div className="brand">
          <i className="mark">♠</i>
          <b>suitfold</b>
        </div>

        <h1>You’re invited to a table.</h1>
        <p className="invite-code">
          Table <b>{code}</b>
        </p>

        <label className="fld">
          <span>What should we call you?</span>
          <div className="named">
            <span className="named-face" aria-hidden="true">
              {face}
            </span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Dad"
              maxLength={14}
              autoFocus
              onKeyDown={(e) => e.key === 'Enter' && ready && onJoin(code, name.trim(), face)}
            />
          </div>
        </label>

        <FacePicker value={face} onPick={setFace} />

        <button className="btn primary big" disabled={!ready} onClick={() => onJoin(code, name.trim(), face)}>
          Sit down
        </button>

        <p className="fine">
          No account, nothing to install. Whoever set the table up needs their tab open.
        </p>
        <button className="linkish" onClick={onHome}>
          What is suitfold?
        </button>
      </div>
    </div>
  )
}
