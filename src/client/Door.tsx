import type { Knock } from '../net/host.ts'

/**
 * Somebody is at the door.
 *
 * This is the whole of the second factor, and it is a person rather than a
 * secret: knowing the code gets you as far as this list, and whoever is
 * actually at the table decides. A stranger with a forwarded link gets no
 * further, because you can see them asking and say no.
 *
 * Nobody waiting sees anything of the game while they wait - no seat, no
 * snapshots, no cards.
 */
export function Door({
  knocking,
  onLetIn,
  onTurnAway,
}: {
  knocking: Knock[]
  onLetIn: (peer: string) => void
  onTurnAway: (peer: string) => void
}) {
  if (!knocking.length) return null

  return (
    <div className="door" role="dialog" aria-label="Somebody wants to join">
      {knocking.map((k) => (
        <div className="knock" key={k.peer}>
          <span className="knock-face" aria-hidden="true">
            {k.emoji}
          </span>
          <span className="knock-who">
            <b>{k.name}</b>
            <i>wants to sit down</i>
          </span>
          <button className="mini knock-no" onClick={() => onTurnAway(k.peer)}>
            No
          </button>
          <button className="mini knock-yes" onClick={() => onLetIn(k.peer)}>
            Let in
          </button>
        </div>
      ))}
    </div>
  )
}
