import { UNO_LABEL, isJoker, isRed, isUno, isUnoWild, rankOf, suitOf, unoColour, unoValue } from '../table/deck.ts'

const PIP: Record<string, string> = { S: '♠', H: '♥', D: '♦', C: '♣' }
const SUIT_NAME: Record<string, string> = { S: 'spades', H: 'hearts', D: 'diamonds', C: 'clubs' }
const UNO_NAME: Record<string, string> = { R: 'red', G: 'green', B: 'blue', Y: 'yellow' }
const UNO_GLYPH: Record<string, string> = { S: '⊘', V: '⇄', T: '+2', W: '', F: '+4' }

/**
 * The classic pip arrangement, as a 3-column by 7-row grid. Real cards put the
 * lower half upside down, which is the detail that makes a drawn card read as a
 * playing card rather than a rank in a box.
 */
const PIPS: Record<string, [number, number][]> = {
  '2': [[1, 0], [1, 6]],
  '3': [[1, 0], [1, 3], [1, 6]],
  '4': [[0, 0], [2, 0], [0, 6], [2, 6]],
  '5': [[0, 0], [2, 0], [1, 3], [0, 6], [2, 6]],
  '6': [[0, 0], [2, 0], [0, 3], [2, 3], [0, 6], [2, 6]],
  '7': [[0, 0], [2, 0], [1, 1.5], [0, 3], [2, 3], [0, 6], [2, 6]],
  '8': [[0, 0], [2, 0], [1, 1.5], [0, 3], [2, 3], [1, 4.5], [0, 6], [2, 6]],
  '9': [[0, 0], [2, 0], [0, 2], [2, 2], [1, 3], [0, 4], [2, 4], [0, 6], [2, 6]],
  T: [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2], [0, 4], [2, 4], [1, 5], [0, 6], [2, 6]],
}

/**
 * One card. `face` is null when the viewer is not entitled to see it — decided
 * where the deck lives, so a hidden card genuinely has no face in this browser.
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

  // Re-keying on the face makes the turn animation play when a card is flipped
  // or revealed, without tracking previous state anywhere.
  const key = face ?? 'back'

  if (!face) {
    return (
      <div className={[...base, 'pc--back'].join(' ')} key={key} aria-label="face down card">
        <span className="back-art" aria-hidden="true" />
      </div>
    )
  }

  if (isUno(face)) return <UnoFace face={face} base={base} cardKey={key} />

  if (isJoker(face)) {
    return (
      <div className={[...base, 'pc--joker'].join(' ')} key={key} aria-label="joker">
        <span className="ix ix--tl">
          <b>J</b>
          <i>★</i>
        </span>
        <span className="court">★</span>
        <span className="ix ix--br">
          <b>J</b>
          <i>★</i>
        </span>
      </div>
    )
  }

  const r = rankOf(face)
  const s = suitOf(face)
  const pip = PIP[s]!
  const label = r === 'T' ? '10' : r
  const court = r === 'J' || r === 'Q' || r === 'K'
  const spots = PIPS[r]

  return (
    <div
      className={[...base, isRed(face) ? 'is-red' : '', court ? 'is-court' : ''].join(' ')}
      key={key}
      aria-label={`${label} of ${SUIT_NAME[s] ?? s}`}
    >
      <span className="ix ix--tl">
        <b>{label}</b>
        <i>{pip}</i>
      </span>

      {r === 'A' && <span className="ace">{pip}</span>}
      {court && (
        <span className="court">
          {r}
          <em>{pip}</em>
        </span>
      )}
      {spots && (
        <span className="field" aria-hidden="true">
          {spots.map(([col, row], i) => (
            <i
              key={i}
              className={row > 3 ? 'flip' : ''}
              style={{ left: `${[22, 50, 78][col]}%`, top: `${14 + row * 12}%` }}
            >
              {pip}
            </i>
          ))}
        </span>
      )}

      <span className="ix ix--br">
        <b>{label}</b>
        <i>{pip}</i>
      </span>
    </div>
  )
}

/** Uno cards are a colour and a symbol, so they get their own face. */
function UnoFace({ face, base, cardKey }: { face: string; base: string[]; cardKey: string }) {
  const colour = unoColour(face)
  const value = unoValue(face)
  const wild = isUnoWild(face)
  const label = wild ? (colour === 'F' ? 'wild draw four' : 'wild') : `${UNO_NAME[colour] ?? colour} ${UNO_LABEL[value] ?? value}`
  const glyph = wild ? (colour === 'F' ? '+4' : '') : (UNO_GLYPH[value] ?? value)

  return (
    <div
      className={[...base, 'pc--uno', wild ? 'pc--wild' : `uno-${colour.toLowerCase()}`].join(' ')}
      key={cardKey}
      aria-label={label}
    >
      {wild && (
        <span className="uno-wheel" aria-hidden="true">
          <i /><i /><i /><i />
        </span>
      )}
      <span className="uno-oval">
        <span className={`uno-val ${glyph.length > 1 ? 'is-wide' : ''}`}>{glyph}</span>
      </span>
      <span className="uno-corner tl">{glyph || '★'}</span>
      <span className="uno-corner br">{glyph || '★'}</span>
    </div>
  )
}
