import { useEffect, useState } from 'react'
import { canCheck, noteMiss, opens, remember, waitLeft } from '../net/lock.ts'

/**
 * The door.
 *
 * Asked of whoever is starting a table, and of nobody else. Sitting down at
 * one somebody else is holding needs no phrase: the code gets you as far as
 * knocking, and a person who is actually at the table decides the rest.
 */
export function Gate({ onIn, onGiveUp }: { onIn: () => void; onGiveUp?: () => void }) {
  const [phrase, setPhrase] = useState('')
  const [wrong, setWrong] = useState(false)
  const [wait, setWait] = useState(() => waitLeft())

  // Count down while they are shut out, so the button comes back on its own.
  useEffect(() => {
    if (!wait) return
    const tick = setInterval(() => setWait(waitLeft()), 1000)
    return () => clearInterval(tick)
  }, [wait])

  const tryIt = async () => {
    if (wait) return
    const said = phrase.trim()
    if (!said) return
    if (await opens(said)) {
      remember(said)
      onIn()
      return
    }
    noteMiss()
    setWrong(true)
    setWait(waitLeft())
  }

  return (
    <div className="gate">
      <div className="gate-box">
        <i className="mark">♠</i>
        <h1>suitfold</h1>
        <p className="lede">
          A card table for one family in particular. If somebody sent you a
          link, use that instead - it will let you straight in.
        </p>

        <label className="fld">
          <span>The phrase</span>
          <input
            type="password"
            autoComplete="current-password"
            value={phrase}
            disabled={wait > 0}
            onChange={(e) => {
              setPhrase(e.target.value)
              setWrong(false)
            }}
            onKeyDown={(e) => e.key === 'Enter' && void tryIt()}
            placeholder="ask whoever invited you"
            autoFocus
            aria-label="The phrase"
          />
        </label>

        {!canCheck() ? (
          <p className="gate-no">
            This page is on <b>http</b>, and a browser will not do the sums that check a phrase
            unless it is on <b>https</b>. Nothing you type here can work until whoever set this up
            turns on a certificate.
          </p>
        ) : wait > 0 ? (
          <p className="gate-no">
            Too many tries. {wait > 60 ? `About ${Math.ceil(wait / 60)} minutes.` : `${wait} seconds.`}
          </p>
        ) : (
          wrong && <p className="gate-no">That is not it. Ask whoever sent you the link.</p>
        )}

        <button
          className="btn primary big"
          disabled={!phrase.trim() || wait > 0 || !canCheck()}
          onClick={() => void tryIt()}
        >
          Come in
        </button>

        <p className="fine">Asked once and remembered on this device.</p>
        {onGiveUp && (
          <button className="linkish" onClick={onGiveUp}>
            Never mind
          </button>
        )}
      </div>
    </div>
  )
}
