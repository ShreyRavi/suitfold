import { useState } from 'react'
import type { Action, SeatId, TableView } from '../table/model.ts'
import { ChipStack, ChipTray, money } from './Chips.tsx'

/**
 * Betting lives with your hand, at the bottom, because your chips are yours in
 * the same way your cards are. It used to be a popover over the middle of the
 * table, which covered the thing you were betting on.
 *
 * Every amount is one tap. There is no select-then-confirm.
 */
export function BetBar({
  view,
  me,
  act,
}: {
  view: TableView
  me: SeatId
  act: (a: Action) => void
}) {
  const mine = view.chips[me] ?? 0
  const [custom, setCustom] = useState(0)
  const [open, setOpen] = useState(false)
  // Taking the pot is the one move that cannot be argued back into place by
  // whoever it happened to, so it asks first.
  const [confirming, setConfirming] = useState(false)
  // Split pots and side pots are ordinary. Taking a named amount is how you
  // settle one without the table doing arithmetic it has no business doing.
  const [want, setWant] = useState('')

  // Always the same four, in the same places, whether you are holding eighty
  // or eight thousand. They used to rescale with your stack and drop out when
  // you were low, so the button under your thumb was a different bet every
  // time you looked down.
  const unit = 25
  const quick = [25, 50, 100, 250]
  const bet = (amount: number) => {
    if (amount <= 0) return
    act({ t: 'bet', seat: me, amount: Math.min(amount, mine) })
    setCustom(0)
    setOpen(false)
  }

  return (
    <div className="betbar">
      <span className="betbar-mine" title="Your chips">
        <ChipTray amount={mine} small />
        <b>{money(mine)}</b>
      </span>

      <div className="betbar-amounts">
        {quick.map((n) => (
          <button key={n} className="betbar-chip" disabled={n > mine} onClick={() => bet(n)}>
            {money(n)}
          </button>
        ))}
        <button className="betbar-chip is-all" disabled={mine === 0} onClick={() => bet(mine)}>
          All in
        </button>
        <button
          className={`betbar-chip is-more ${open ? 'on' : ''}`}
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          aria-label="another amount"
        >
          ⋯
        </button>
      </div>

      {view.pot > 0 && (
        <button className="betbar-pot" onClick={() => setConfirming(true)}>
          Take pot <b>{money(view.pot)}</b>
        </button>
      )}

      {confirming && (
        <TakePot
          pot={view.pot}
          want={want}
          setWant={setWant}
          onClose={() => {
            setConfirming(false)
            setWant('')
          }}
          onTake={(amount) => {
            act({ t: 'take_pot', seat: me, ...(amount === undefined ? {} : { amount }) })
            setConfirming(false)
            setWant('')
          }}
        />
      )}

      {open && (
        <div className="betbar-custom">
          <button className="seg" onClick={() => setCustom(Math.max(0, custom - unit))} aria-label="less">
            −
          </button>
          {/* Typing the number is faster than pressing + eleven times. */}
          <input
            className="betbar-custom-val"
            type="number"
            inputMode="numeric"
            min={0}
            max={mine}
            value={custom || ''}
            placeholder="0"
            aria-label="How much"
            onChange={(e) => setCustom(clampTo(e.target.value, mine))}
            onKeyDown={(e) => e.key === 'Enter' && bet(custom)}
          />
          <button className="seg" onClick={() => setCustom(Math.min(mine, custom + unit))} aria-label="more">
            +
          </button>
          <button className="btn primary" disabled={custom <= 0} onClick={() => bet(custom)}>
            Bet {money(custom)}
          </button>
        </div>
      )}
    </div>
  )
}

/** Whole chips, never more than there are, never less than none. */
function clampTo(raw: string, most: number) {
  const n = Math.floor(Number(raw))
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.min(n, most)
}

/**
 * The pot, or a named part of it. Splitting one is ordinary - two people tie,
 * or somebody was short and can only win what they covered - and the table
 * cannot work out which, so it lets you say.
 */
function TakePot({
  pot,
  want,
  setWant,
  onClose,
  onTake,
}: {
  pot: number
  want: string
  setWant: (v: string) => void
  onClose: () => void
  onTake: (amount?: number) => void
}) {
  const part = clampTo(want, pot)
  const some = want.trim().length > 0 && part > 0 && part < pot

  return (
    <div className="ask" role="dialog" aria-modal="true" aria-label="Take the pot">
      <div className="ask-box">
        <div className="ask-chips">
          <ChipStack amount={some ? part : pot} big />
        </div>
        <h2>{some ? 'Take part of the pot?' : 'Take the pot?'}</h2>
        <p>
          <b>{money(some ? part : pot)}</b> goes to you
          {some ? `, and ${money(pot - part)} stays in the middle.` : ', and the middle is cleared.'}
        </p>

        <label className="ask-some">
          <span>Only part of it?</span>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            max={pot}
            value={want}
            placeholder={String(pot)}
            aria-label="How much of the pot"
            onChange={(e) => setWant(e.target.value)}
          />
          <button className="seg" type="button" onClick={() => setWant(String(Math.floor(pot / 2)))}>
            Half
          </button>
        </label>

        <div className="ask-acts">
          <button className="btn" onClick={onClose}>
            Not yet
          </button>
          <button className="btn primary" onClick={() => onTake(some ? part : undefined)}>
            Take {money(some ? part : pot)}
          </button>
        </div>
      </div>
      <button className="ask-scrim" onClick={onClose} aria-label="Cancel" />
    </div>
  )
}
