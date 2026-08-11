import { presetById } from '../table/deck.ts'
import { rulesFor } from '../table/rules.ts'

/**
 * How to play, in plain words. suitfold enforces none of it - which is exactly
 * why it is written down. If the app will not settle an argument, the least it
 * can do is remind everyone what the argument is about.
 */
export function Rules({ gameId, onClose }: { gameId: string; onClose: () => void }) {
  const preset = presetById(gameId)
  const r = rulesFor(gameId)

  return (
    <div className="sheet rules" role="dialog" aria-modal="true" aria-label={`How to play ${preset.name}`}>
      <div className="sheet-bar">
        <h2>{preset.name}</h2>
        <button className="btn" onClick={onClose}>
          Close
        </button>
      </div>

      <div className="sheet-body rules-body">
        <p className="rules-goal">{r.goal}</p>
        <p className="rules-players">{r.players} players</p>

        <Block title="Setting up" items={r.setup} />
        <Block title="Playing" items={r.play} ordered />

        <div className="rules-win">
          <span className="rules-h">How you win</span>
          <p>{r.winning}</p>
        </div>

        {r.sections?.map((s) => (
          <Block key={s.title} title={s.title} items={s.items} />
        ))}

        <p className="fine rules-note">
          suitfold does not enforce any of this. It deals and it moves cards; the rest is up to the
          people at the table, exactly like a real deck.
        </p>
      </div>
    </div>
  )
}

function Block({ title, items, ordered }: { title: string; items: string[]; ordered?: boolean }) {
  const List = ordered ? 'ol' : 'ul'
  return (
    <div className="rules-block">
      <span className="rules-h">{title}</span>
      <List className={ordered ? 'rules-steps' : 'rules-list'}>
        {items.map((t, i) => (
          <li key={i}>{t}</li>
        ))}
      </List>
    </div>
  )
}
