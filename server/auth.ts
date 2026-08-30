import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Who is allowed to open a table, when there is a server to ask.
 *
 * Accounts live in one environment variable and nowhere else. There is no
 * database, no signup, no password reset: this is a card table for a family,
 * and the list of people in that family changes about once a decade. Adding
 * somebody is editing a line in Coolify and redeploying.
 *
 * None of this touches guests. Somebody following a link still types a name
 * and knocks, exactly as before, and always will - the whole point of the
 * thing is that you can invite people who will never make an account.
 */

/** `me@example.com:my password;mum@example.com:hers` */
const RAW = process.env.SUITFOLD_USERS ?? ''

/**
 * Split on the first colon only.
 *
 * An email cannot contain one and a password very much can, so anything after
 * the first is part of the password. Semicolons separate people, which means a
 * password cannot contain a semicolon - the one character this format spends.
 */
function parse(raw: string): Map<string, string> {
  const users = new Map<string, string>()
  for (const entry of raw.split(';')) {
    const line = entry.trim()
    if (!line) continue
    const at = line.indexOf(':')
    if (at < 1) continue
    const email = line.slice(0, at).trim().toLowerCase()
    const secret = line.slice(at + 1)
    // An address, or it is not an entry. Without this a password containing a
    // semicolon does not fail loudly - it quietly becomes a second account
    // whose name is the tail of somebody else's password.
    if (!email.includes('@') || !secret) continue
    users.set(email, secret)
  }
  return users
}

const USERS = parse(RAW)

/** Are we doing accounts at all? Without any, the phrase stays in charge. */
export const accounts = () => USERS.size > 0
export const howMany = () => USERS.size

/**
 * Compare without leaking how far the comparison got.
 *
 * Both sides are hashed first so the lengths always match, which means this
 * says nothing about how long the real password is either.
 */
function same(a: string, b: string): boolean {
  const digest = (s: string) => createHash('sha256').update(s).digest()
  return timingSafeEqual(digest(a), digest(b))
}

/**
 * A bcrypt hash is accepted in place of a password, so the same variable can
 * hold either and moving to hashes later is a change of value, not of code.
 * Recognising one and being unable to check it is worse than saying so.
 */
const looksHashed = (secret: string) => /^\$2[aby]?\$\d{2}\$/.test(secret)

export interface Attempt {
  ok: boolean
  /** Seconds to wait, when there have been too many tries. */
  wait?: number
}

/**
 * Every wrong answer is the same wrong answer.
 *
 * Saying "no such account" tells whoever is asking which addresses are real,
 * which is a list worth having if you intend to come back and guess at one.
 */
export async function signIn(email: string, password: string, from: string): Promise<Attempt> {
  const who = email.trim().toLowerCase()
  const held = tooMany(who, from)
  if (held) return { ok: false, wait: held }

  const secret = USERS.get(who)
  // Checked even when there is no such account, so that a wrong address and a
  // wrong password take the same time to answer.
  const against = secret ?? 'no account with this address exists at all'
  const right = secret
    ? looksHashed(secret)
      ? await Bun.password.verify(password, secret).catch(() => false)
      : same(password, secret)
    : (same(password, against), false)

  if (!right) {
    missed(who, from)
    return { ok: false }
  }
  clear(who, from)
  return { ok: true }
}

// -- too many tries ---------------------------------------------------------

/**
 * Counted here, on the server, because that is the only place counting means
 * anything. The front end can hold somebody up politely; it cannot hold up a
 * script that never loads the front end.
 *
 * Counted per address and per caller, so that guessing at one account does not
 * lock out the rest of the family, and one machine working through a list is
 * still stopped.
 */
/**
 * A household is one address as far as the internet is concerned, so the count
 * per caller has to have room for a family fumbling their passwords at the
 * same time. It is there to stop somebody working through a list, not to
 * ration ordinary mistyping. The count per account is the tight one.
 */
const ALLOWED = 8
const ALLOWED_FROM = 40
const WITHIN = 10 * 60 * 1000
const tries = new Map<string, number[]>()

const recent = (key: string, now: number) => (tries.get(key) ?? []).filter((t) => t > now - WITHIN)

function tooMany(email: string, from: string): number | null {
  const now = Date.now()
  for (const [key, allowed] of [
    [`e:${email}`, ALLOWED],
    [`i:${from}`, ALLOWED_FROM],
  ] as const) {
    const hits = recent(key, now)
    tries.set(key, hits)
    if (hits.length >= allowed) {
      const oldest = hits[0]!
      return Math.max(1, Math.ceil((oldest + WITHIN - now) / 1000))
    }
  }
  return null
}

function missed(email: string, from: string) {
  const now = Date.now()
  for (const key of [`e:${email}`, `i:${from}`]) tries.set(key, [...recent(key, now), now])
}

function clear(email: string, from: string) {
  tries.delete(`e:${email}`)
  tries.delete(`i:${from}`)
}

// -- staying signed in ------------------------------------------------------

/**
 * Sessions are signed rather than stored.
 *
 * Nothing is kept, so a redeploy does not sign the whole family out mid-hand -
 * which, given that a redeploy is how you add somebody, would happen at exactly
 * the wrong moment.
 *
 * The key comes from the accounts themselves unless one is given, so changing
 * somebody's password invalidates every session signed under the old list.
 * That is the behaviour you want from a password change.
 */
const KEY = process.env.SUITFOLD_SECRET || createHash('sha256').update(`suitfold:${RAW}`).digest('hex')
const LIFE = 90 * 24 * 60 * 60 * 1000

const sign = (body: string) => createHmac('sha256', KEY).update(body).digest('hex')

export function issue(email: string): string {
  const body = Buffer.from(JSON.stringify({ e: email.trim().toLowerCase(), x: Date.now() + LIFE })).toString('base64url')
  return `${body}.${sign(body)}`
}

/**
 * Who this session belongs to, or nobody.
 *
 * The address is looked up again every time rather than trusted because it was
 * signed once. Taking somebody out of the environment and redeploying has to
 * actually take them out, and a session they are still carrying is exactly the
 * thing that would otherwise let them back in.
 */
export function whose(session: string | null): string | null {
  if (!session) return null
  const [body, mac] = session.split('.')
  if (!body || !mac) return null
  const want = sign(body)
  if (mac.length !== want.length || !timingSafeEqual(Buffer.from(mac), Buffer.from(want))) return null
  try {
    const { e, x } = JSON.parse(Buffer.from(body, 'base64url').toString()) as { e?: string; x?: number }
    if (!e || !x || Date.now() > x) return null
    return USERS.has(e) ? e : null
  } catch {
    return null
  }
}

/** The session out of a Cookie header, without pulling in a cookie library. */
export function cookie(header: string | null, name: string): string | null {
  if (!header) return null
  for (const bit of header.split(';')) {
    const at = bit.indexOf('=')
    if (at < 0) continue
    if (bit.slice(0, at).trim() !== name) continue
    return decodeURIComponent(bit.slice(at + 1).trim())
  }
  return null
}
