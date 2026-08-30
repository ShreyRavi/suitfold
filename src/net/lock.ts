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

/**
 * Can this browser check a phrase at all?
 *
 * SubtleCrypto only exists on a secure origin - https, or localhost. Served
 * over plain http from a domain, it is simply missing, and every phrase in the
 * world reads as the wrong one. That is a page nobody can get into and no way
 * to tell why, so it is worth saying out loud rather than letting it look like
 * a typo.
 */
export const canCheck = () => !!globalThis.crypto?.subtle

export async function sha(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Does this phrase open it? */
export async function opens(phrase: string): Promise<boolean> {
  if (!locked()) return true
  if (!canCheck()) return false
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

/**
 * Links deliberately do not carry the phrase.
 *
 * An invite is a way in to one table: it gets you as far as knocking, and
 * somebody at the table decides the rest. If it carried the phrase then
 * anybody it was ever forwarded to could start tables of their own, and a link
 * gets forwarded - that is what links are for.
 */
