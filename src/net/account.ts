import { whereTheTableIs } from './socket.ts'
import { locked } from './lock.ts'

/**
 * The door, from the browser's side.
 *
 * There are two of them and which one you meet depends on where the page came
 * from, not on anything you chose. Served by a table server with accounts on
 * it, you sign in. Served from anywhere else - GitHub Pages, most obviously,
 * where there is no server to ask - the phrase is still the door, because a
 * static page cannot check a password against anything.
 *
 * Guests meet neither. A link with a code on it gets you as far as knocking.
 */
export type DoorKind = 'accounts' | 'phrase' | 'open'

let asked: Promise<DoorKind> | null = null

export function theDoor(): Promise<DoorKind> {
  return (asked ??= (async () => {
    const server = await whereTheTableIs()
    if (!server) return locked() ? 'phrase' : 'open'
    try {
      const res = await fetch(`${server.replace(/\/$/, '')}/door`, {
        credentials: 'include',
        signal: AbortSignal.timeout(4000),
      })
      if (res.ok) {
        const { door } = (await res.json()) as { door?: DoorKind }
        if (door === 'accounts' || door === 'phrase' || door === 'open') return door
      }
    } catch {
      /* a server that will not say has no accounts we can use */
    }
    return locked() ? 'phrase' : 'open'
  })())
}

/** Are we already signed in on this device? */
export async function signedIn(): Promise<boolean> {
  const server = await whereTheTableIs()
  if (!server) return false
  try {
    const res = await fetch(`${server.replace(/\/$/, '')}/me`, {
      credentials: 'include',
      signal: AbortSignal.timeout(4000),
    })
    if (!res.ok) return false
    const { in: yes } = (await res.json()) as { in?: boolean }
    return !!yes
  } catch {
    return false
  }
}

export interface Tried {
  ok: boolean
  /** Seconds to wait, when there have been too many tries. */
  wait?: number
  /** The server could not be reached at all, which is not a wrong password. */
  offline?: boolean
}

/**
 * Sign in.
 *
 * The session comes back as a cookie the browser will not let us read, which
 * is the point: a script that gets onto this page cannot take it and use it
 * somewhere else. Nothing here has to remember anything.
 */
export async function signIn(email: string, password: string): Promise<Tried> {
  const server = await whereTheTableIs()
  if (!server) return { ok: false, offline: true }
  try {
    const res = await fetch(`${server.replace(/\/$/, '')}/login`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
      signal: AbortSignal.timeout(10000),
    })
    if (res.ok) return { ok: true }
    const body = (await res.json().catch(() => ({}))) as { wait?: number }
    return { ok: false, ...(body.wait ? { wait: body.wait } : {}) }
  } catch {
    return { ok: false, offline: true }
  }
}

export async function signOut(): Promise<void> {
  const server = await whereTheTableIs()
  if (!server) return
  try {
    await fetch(`${server.replace(/\/$/, '')}/logout`, { method: 'POST', credentials: 'include' })
  } catch {
    /* signing out of a server that is not there is already done */
  }
}
