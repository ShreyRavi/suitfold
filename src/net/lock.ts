/**
 * The front door of a static site.
 *
 * Be clear about what this is, because it would be easy to mistake it for
 * security. There is no server here. Everything the browser needs to decide
 * whether to let you in is in the browser, which means somebody who opens the
 * developer tools can walk straight past it. It is a door on a garden shed:
 * it stops people wandering in, and stops nobody who is trying.
 *
 * The door itself is only a door: somebody who opens the developer tools can
 * walk past it, and no amount of care here changes that.
 *
 * The phrase is not only a door, though. It is also the key the peering layer
 * uses to encrypt the handshake between browsers, and trystero will not
 * introduce two peers whose keys disagree. So getting past this screen buys
 * nothing on its own - without the actual phrase you cannot reach anybody,
 * because the encryption is done by the peers rather than by a server that
 * could be argued with. That part is real.
 *
 * The rest is hygiene:
 *
 *   - the phrase is not in the source, only a sha256 of it, injected at build
 *     time, so a public repository gives nothing away
 *   - guessing is slowed down, so a bored person cannot sit and try words
 *   - an invite link carries it, so family click once and are in, and a bare
 *     visit to the address shows nothing but this door
 *
 * The phrase itself is kept in this browser, because the peering layer needs
 * it every time it connects. On a shared computer that is worth knowing.
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
