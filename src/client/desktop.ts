/**
 * The few things the Mac app can do that a browser tab cannot.
 *
 * The page is the same page either way. When it happens to be running inside
 * the app there is a bridge to talk to, and these say something through it;
 * everywhere else they do nothing at all, which is the point. Nothing in the
 * game is allowed to depend on the app being there.
 */

interface Bridge {
  postMessage(message: unknown): void
}

const bridge = (): Bridge | null => {
  const w = window as unknown as { webkit?: { messageHandlers?: { suitfold?: Bridge } } }
  return w.webkit?.messageHandlers?.suitfold ?? null
}

/** True when this is the Mac app rather than a browser. */
export const isDesktop = () => (window as unknown as { __suitfoldDesktop?: boolean }).__suitfoldDesktop === true

/**
 * A notification, for the things you would want to know while looking at
 * something else. The app decides whether to show it: it stays quiet when the
 * window is already in front of you.
 */
export function notify(title: string, body: string) {
  bridge()?.postMessage({ kind: 'notify', title, body })
}

/** The number on the dock icon. Zero clears it. */
export function badge(count: number) {
  bridge()?.postMessage({ kind: 'badge', count })
}
