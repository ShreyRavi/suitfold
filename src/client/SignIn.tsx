import { useEffect, useState } from 'react'
import { signIn } from '../net/account.ts'

/**
 * The door, where there is a server holding a list of who may open a table.
 *
 * Asked of whoever is starting a table, and of nobody else. Sitting down at
 * one somebody else is holding needs no account at all: the code gets you as
 * far as knocking, and a person actually at the table decides the rest. That
 * is deliberate and it is the point - you can invite people who will never
 * make an account anywhere.
 *
 * Every refusal reads the same, whether the address is unknown or the password
 * is wrong, because the difference between those two is a list of which
 * addresses are real.
 */
export function SignIn({ onIn, onGiveUp }: { onIn: () => void; onGiveUp?: () => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [wrong, setWrong] = useState(false)
  const [offline, setOffline] = useState(false)
  const [wait, setWait] = useState(0)

  // Count down while they are held, so the button comes back on its own.
  useEffect(() => {
    if (!wait) return
    const tick = setInterval(() => setWait((w) => Math.max(0, w - 1)), 1000)
    return () => clearInterval(tick)
  }, [wait])

  const tryIt = async () => {
    if (busy || wait) return
    if (!email.trim() || !password) return
    setBusy(true)
    setWrong(false)
    setOffline(false)
    const tried = await signIn(email, password)
    setBusy(false)
    if (tried.ok) {
      onIn()
      return
    }
    if (tried.offline) {
      setOffline(true)
      return
    }
    if (tried.wait) {
      setWait(tried.wait)
      return
    }
    setWrong(true)
  }

  return (
    <div className="gate">
      <form
        className="gate-box"
        onSubmit={(e) => {
          e.preventDefault()
          void tryIt()
        }}
      >
        <i className="mark">♠</i>
        <h1>suitfold</h1>
        <p className="lede">
          A card table for one family in particular. If somebody sent you a link, use that
          instead - it will let you straight in.
        </p>

        <label className="fld">
          <span>Email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value)
              setWrong(false)
            }}
            autoComplete="username"
            autoFocus
            aria-label="Email"
          />
        </label>

        <label className="fld">
          <span>Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value)
              setWrong(false)
            }}
            autoComplete="current-password"
            aria-label="Password"
          />
        </label>

        {offline ? (
          <p className="gate-no">
            Could not reach the table. That is the connection, not you - try again in a moment.
          </p>
        ) : wait > 0 ? (
          <p className="gate-no">
            Too many tries. {wait > 60 ? `About ${Math.ceil(wait / 60)} minutes.` : `${wait} seconds.`}
          </p>
        ) : (
          wrong && <p className="gate-no">That is not it. Check both, and mind the capitals.</p>
        )}

        <button
          className="btn primary big"
          type="submit"
          disabled={busy || !email.trim() || !password || wait > 0}
        >
          {busy ? 'One moment' : 'Come in'}
        </button>

        <p className="fine">Stays signed in on this device.</p>
        {onGiveUp && (
          <button className="linkish" type="button" onClick={onGiveUp}>
            Never mind
          </button>
        )}
      </form>
    </div>
  )
}
