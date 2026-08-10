import { UNO_LABEL, isJoker, isRed, isUno, isUnoWild, rankOf, suitOf, unoColour, unoValue } from '../table/deck.ts'

const PIP: Record<string, string> = { S: '♠', H: '♥', D: '♦', C: '♣' }
const SUIT_NAME: Record<string, string> = { S: 'spades', H: 'hearts', D: 'diamonds', C: 'clubs' }
const UNO_NAME: Record<string, string> = { R: 'red', G: 'green', B: 'blue', Y: 'yellow' }
const UNO_GLYPH: Record<string, string> = { S: '⊘', V: '⇄', T: '+2', W: '', F: '+4' }

/**
 * One card. `face` is null when the viewer is not entitled to see it — that
 * decision is made where the deck lives, so a hidden card genuinely has no
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
  const base = ['pc', small ? 'pc--sm' : '', held ? 'is-held' : '', selected ? 'is-sel' : ''].filter(Boolean)

  if (!face) return <div className={[...base, 'pc--back'].join(' ')} aria-label="face down card" />

  if (isUno(face)) return <UnoFace face={face} base={base} />

  if (isJoker(face)) {
    return (
      <div className={[...base, 'pc--joker'].join(' ')} aria-label="joker">
        <span className="pc-rank">J</span>
        <span className="pc-pip">★</span>
      </div>
    )
  }

  const r = rankOf(face)
  const s = suitOf(face)
  return (
    <div
      className={[...base, isRed(face) ? 'is-red' : ''].join(' ')}
      aria-label={`${r === 'T' ? '10' : r} of ${SUIT_NAME[s] ?? s}`}
    >
      <span className="pc-rank">{r === 'T' ? '10' : r}</span>
      <span className="pc-pip">{PIP[s]}</span>
      <span className="pc-big">{PIP[s]}</span>
    </div>
  )
}

/** Uno cards are a colour and a symbol, so they get their own face. */
function UnoFace({ face, base }: { face: string; base: string[] }) {
  const colour = unoColour(face)
  const value = unoValue(face)
  const wild = isUnoWild(face)
  const label = wild
    ? colour === 'F'
      ? 'wild draw four'
      : 'wild'
    : `${UNO_NAME[colour] ?? colour} ${UNO_LABEL[value] ?? value}`
  const glyph = wild ? (colour === 'F' ? '+4' : '') : (UNO_GLYPH[value] ?? value)

  return (
    <div className={[...base, 'pc--uno', wild ? 'pc--wild' : `uno-${colour.toLowerCase()}`].join(' ')} aria-label={label}>
      {wild && (
        <span className="uno-wheel" aria-hidden="true">
          <i /><i /><i /><i />
        </span>
      )}
      <span className="uno-oval">
        {/* "+2" and "+4" need to be smaller than a single digit to fit. */}
        <span className={`uno-val ${glyph.length > 1 ? 'is-wide' : ''}`}>{glyph}</span>
      </span>
      <span className="uno-corner tl">{glyph || '★'}</span>
      <span className="uno-corner br">{glyph || '★'}</span>
    </div>
  )
}
