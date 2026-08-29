import { Component, type ErrorInfo, type ReactNode } from 'react'

/**
 * The thing that stops a bug being a white screen.
 *
 * Nobody playing this has a support channel. If something throws mid-hand the
 * choice is between a blank page, which reads as "the whole thing is broken
 * and my evening is over", and a page that says what happened and offers the
 * one button that fixes almost everything. The second is worth a few lines.
 *
 * The table itself lives in whoever is holding it, so reloading loses nothing
 * for a guest. For the host it comes back from the crash net.
 */
interface State {
  broke: boolean
  what: string
}

export class Boundary extends Component<{ children: ReactNode }, State> {
  override state: State = { broke: false, what: '' }

  static getDerivedStateFromError(err: unknown): State {
    return { broke: true, what: err instanceof Error ? err.message : String(err) }
  }

  override componentDidCatch(err: Error, info: ErrorInfo) {
    // Nowhere to send it, so leave it where somebody can find it.
    console.error('suitfold fell over:', err, info.componentStack)
  }

  override render() {
    if (!this.state.broke) return this.props.children

    return (
      <div className="gate">
        <div className="gate-box">
          <i className="mark">♠</i>
          <h1>That went wrong</h1>
          <p className="lede">
            Something in the table broke. Reloading usually fixes it, and you will not lose your
            seat.
          </p>
          <button className="btn primary big" onClick={() => location.reload()}>
            Reload
          </button>
          <p className="fine">
            If it keeps happening, whoever set the table up can start a fresh one.
          </p>
          <details className="broke-why">
            <summary>What happened</summary>
            <code>{this.state.what}</code>
          </details>
        </div>
      </div>
    )
  }
}
