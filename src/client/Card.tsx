import { isJoker, isRed, rankOf, suitOf } from '../table/deck.ts'

const PIP: Record<string, string> = { S: '♠', H: '♥', D: '♦', C: '♣' }
const LABEL: Record<string, string> = { S: 'spades', H: 'hearts', D: 'diamonds', C: 'clubs' }

/**
 * One card. `face` is null when the viewer is not entitled to see it — that
 * decision is made on the host, never here, so a hidden card genuinely has no
 * face in this browser to inspect.
 */
export function Card({
  face,
  small,
  held,
  selected,
}: {
  face: string | null
  small?: boolean
  held?: boolean
  selected?: boolean
}) {
  const cls = ['pc', small ? 'pc--sm' : '', held ? 'is-held' : '', selected ? 'is-sel' : ''].filter(Boolean)

  if (!face) return <div className={[...cls, 'pc--back'].join(' ')} aria-label="face down card" />

  if (isJoker(face)) {
    return (
      <div className={[...cls, 'pc--joker'].join(' ')} aria-label="joker">
        <span className="pc-rank">J</span>
        <span className="pc-pip">★</span>
      </div>
    )
  }

  const r = rankOf(face)
  const s = suitOf(face)
  return (
    <div
      className={[...cls, isRed(face) ? 'is-red' : ''].join(' ')}
      aria-label={`${r === 'T' ? '10' : r} of ${LABEL[s] ?? s}`}
    >
      <span className="pc-rank">{r === 'T' ? '10' : r}</span>
      <span className="pc-pip">{PIP[s]}</span>
      <span className="pc-big">{PIP[s]}</span>
    </div>
  )
}
