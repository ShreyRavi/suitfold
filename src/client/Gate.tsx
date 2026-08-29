import { useEffect, useState } from 'react'
import { noteMiss, opens, remember, waitLeft } from '../net/lock.ts'

/**
 * The door.
 *
 * One phrase, shared by word of mouth, typed once. Not a login, no accounts,
 * and deliberately not pretending to be more than it is: see src/net/lock.ts
 * for what it does and does not do.
 */
export function Gate({ onIn }: { onIn: () => void }) {
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
        <p className="lede">A card table for one family in particular.</p>

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

        {wait > 0 ? (
          <p className="gate-no">
            Too many tries. {wait > 60 ? `About ${Math.ceil(wait / 60)} minutes.` : `${wait} seconds.`}
          </p>
        ) : (
          wrong && <p className="gate-no">That is not it. Ask whoever sent you the link.</p>
        )}

        <button className="btn primary big" disabled={!phrase.trim() || wait > 0} onClick={() => void tryIt()}>
          Come in
        </button>

        <p className="fine">Asked once and remembered on this device.</p>
      </div>
    </div>
  )
}
