import { useState } from 'react'
import { keyWorks, rememberKey } from '../net/socket.ts'

/**
 * The house key.
 *
 * This table is not a public service. It is a thing somebody built for their
 * family and left running, and this is the door: one phrase, shared by word of
 * mouth, typed once and remembered.
 *
 * It is not a login and there are no accounts. Everybody uses the same phrase,
 * and if it ever gets out you change it and tell people the new one.
 */
export function Gate({ onIn }: { onIn: () => void }) {
  const [key, setKey] = useState('')
  const [wrong, setWrong] = useState(false)
  const [asking, setAsking] = useState(false)

  const tryIt = async () => {
    const said = key.trim()
    if (!said || asking) return
    setAsking(true)
    const ok = await keyWorks(said)
    setAsking(false)
    if (!ok) {
      setWrong(true)
      return
    }
    rememberKey(said)
    onIn()
  }

  return (
    <div className="gate">
      <div className="gate-box">
        <i className="mark">♠</i>
        <h1>suitfold</h1>
        <p className="lede">
          A card table for one family in particular. You need the phrase to come in.
        </p>

        <label className="fld">
          <span>The phrase</span>
          <input
            value={key}
            onChange={(e) => {
              setKey(e.target.value)
              setWrong(false)
            }}
            onKeyDown={(e) => e.key === 'Enter' && void tryIt()}
            placeholder="ask whoever invited you"
            autoFocus
            aria-label="The phrase"
          />
        </label>

        {wrong && <p className="gate-no">That is not it. Ask whoever sent you the link.</p>}

        <button className="btn primary big" disabled={!key.trim() || asking} onClick={() => void tryIt()}>
          {asking ? 'Trying' : 'Come in'}
        </button>

        <p className="fine">
          Typed once and remembered on this device. Nothing is sent anywhere but the table itself.
        </p>
      </div>
    </div>
  )
}
