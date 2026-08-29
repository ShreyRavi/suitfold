/**
 * The front door.
 *
 * One shared phrase, learned by word of mouth, typed once and remembered. Not
 * a login and not an account system: everybody uses the same one, and if it
 * ever gets out you change it and tell people the new one.
 *
 * The phrase is also the key the peering layer encrypts its handshake with, so
 * it is a requirement for reaching anybody rather than only a screen to get
 * past. It is not in the source: only a sha256 of it, injected at build time.
 *
 * It is kept in this browser afterwards, because the peering layer needs it
 * every time it connects. On a shared computer that is worth knowing.
 */

const LOCK = (import.meta.env.VITE_LOCK ?? '').trim().toLowerCase()

const SAID = 'suitfold.said'
const TRIES = 'suitfold.tries'
/** A few goes a minute. Enough for a typo, not enough for a word list. */
const ALLOWED = 6
const WITHIN = 5 * 60 * 1000

/** Is there a phrase at all? Without one this is an open house, as in dev. */
export const locked = () => LOCK.length === 64

export async function sha(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Does this phrase open it? */
export async function opens(phrase: string): Promise<boolean> {
  if (!locked()) return true
  const said = phrase.trim()
  if (!said) return false
  return (await sha(said)) === LOCK
}

/**
 * Keep the phrase. Not just a note that we got in: the peering layer needs the
 * phrase itself to encrypt its handshake, every time it connects.
 */
export function remember(phrase: string) {
  try {
    localStorage.setItem(SAID, phrase.trim())
    localStorage.removeItem(TRIES)
  } catch {
    /* a browser refusing storage still gets to play, it just asks again */
  }
}

/** The phrase, for the peering layer. Empty when there is no lock. */
export function phrase(): string {
  try {
    return localStorage.getItem(SAID) ?? ''
  } catch {
    return ''
  }
}

/**
 * Have we been let in before?
 *
 * Checked against the current phrase, so changing it asks everybody again
 * rather than leaving them with a key to a lock that has been replaced.
 */
export async function alreadyIn(): Promise<boolean> {
  if (!locked()) return true
  const said = phrase()
  return said ? await opens(said) : false
}

export function forget() {
  try {
    localStorage.removeItem(SAID)
  } catch {
    /* nothing to do */
  }
}

// ---------------------------------------------------------------------------
// Slowing down guessing
// ---------------------------------------------------------------------------

function misses(): number[] {
  try {
    const raw = JSON.parse(localStorage.getItem(TRIES) ?? '[]') as unknown
    if (!Array.isArray(raw)) return []
    return raw.filter((n): n is number => typeof n === 'number')
  } catch {
    return []
  }
}

/** How many seconds until they may try again. Zero means now. */
export function waitLeft(now = Date.now()): number {
  const recent = misses().filter((at) => now - at < WITHIN)
  if (recent.length < ALLOWED) return 0
  const oldest = Math.min(...recent)
  return Math.max(0, Math.ceil((WITHIN - (now - oldest)) / 1000))
}

export function noteMiss(now = Date.now()) {
  const recent = misses().filter((at) => now - at < WITHIN)
  recent.push(now)
  try {
    localStorage.setItem(TRIES, JSON.stringify(recent))
  } catch {
    /* nothing to do */
  }
}

// ---------------------------------------------------------------------------
// Links that carry the phrase
// ---------------------------------------------------------------------------

/**
 * The phrase out of the address, if whoever sent the link put it there.
 *
 * Family click a link and are in without typing anything; somebody who finds
 * the bare address gets the door and nothing else.
 */
export function phraseFromLink(): string | null {
  try {
    const fromQuery = new URLSearchParams(location.search).get('k')
    if (fromQuery) return fromQuery
    // Also accept it in the hash, since that is where the table code lives and
    // people paste whole hashes around.
    const hash = location.hash.replace('#', '')
    const inHash = new URLSearchParams(hash.includes('&') ? hash.split('&').slice(1).join('&') : '').get('k')
    return inHash
  } catch {
    return null
  }
}

/** Take it back out of the address bar once it has been used. */
export function scrubLink() {
  try {
    const url = new URL(location.href)
    if (!url.searchParams.has('k')) return
    url.searchParams.delete('k')
    history.replaceState(null, '', url.pathname + (url.search || '') + url.hash)
  } catch {
    /* an address we cannot rewrite is not worth failing over */
  }
}

/** The phrase to hang on an invite link, so family never type anything. */
export const phraseForLink = phrase
