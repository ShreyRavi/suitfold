import { useState } from 'react'
import type { Action, SeatId, TableView } from '../table/model.ts'
import { ChipStack, money } from './Chips.tsx'

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

  // The useful amounts depend on the stack you are holding: the same four
  // buttons are no good whether you have 80 or 8,000.
  const unit = mine >= 4000 ? 100 : mine >= 1000 ? 25 : mine >= 300 ? 10 : 5
  const quick = [unit, unit * 2, unit * 4, unit * 10].filter((n) => n < mine)
  const bet = (amount: number) => {
    if (amount <= 0) return
    act({ t: 'bet', seat: me, amount: Math.min(amount, mine) })
    setCustom(0)
    setOpen(false)
  }

  return (
    <div className="betbar">
      <span className="betbar-mine" title="Your chips">
        <ChipStack amount={mine} />
        {money(mine)}
      </span>

      <div className="betbar-amounts">
        {quick.map((n) => (
          <button key={n} className="betbar-chip" onClick={() => bet(n)}>
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
        <div className="ask" role="dialog" aria-modal="true" aria-label="Take the pot">
          <div className="ask-box">
            <div className="ask-chips">
              <ChipStack amount={view.pot} big />
            </div>
            <h2>Take the pot?</h2>
            <p>
              <b>{money(view.pot)}</b> goes to you, and the middle is cleared.
            </p>
            <div className="ask-acts">
              <button className="btn" onClick={() => setConfirming(false)}>
                Not yet
              </button>
              <button
                className="btn primary"
                onClick={() => {
                  act({ t: 'take_pot', seat: me })
                  setConfirming(false)
                }}
              >
                Take {money(view.pot)}
              </button>
            </div>
          </div>
          <button className="ask-scrim" onClick={() => setConfirming(false)} aria-label="Cancel" />
        </div>
      )}

      {open && (
        <div className="betbar-custom">
          <button className="seg" onClick={() => setCustom(Math.max(0, custom - unit))} aria-label="less">
            −
          </button>
          <span className="betbar-custom-val">{money(custom)}</span>
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
