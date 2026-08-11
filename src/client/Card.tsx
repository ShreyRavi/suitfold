import { UNO_LABEL, isJoker, isRed, isUno, isUnoWild, rankOf, suitOf, unoColour, unoValue } from '../table/deck.ts'
import { Suit } from './Suit.tsx'

const SUIT_NAME: Record<string, string> = { S: 'spades', H: 'hearts', D: 'diamonds', C: 'clubs' }
const UNO_NAME: Record<string, string> = { R: 'red', G: 'green', B: 'blue', Y: 'yellow' }
const UNO_GLYPH: Record<string, string> = { S: '⊘', V: '⇄', T: '+2', W: '', F: '+4' }

/**
 * Where the pips go, as fractions of the pip field: 0, ½ or 1 across, and
 * anywhere from 0 to 1 down. The field itself is inset far enough that nothing
 * can reach the corner indices, so these are the real arrangement off a real
 * deck rather than numbers chosen to dodge a collision.
 *
 * Anything below halfway is drawn upside down, as it is on a printed card.
 */
const T3 = 1 / 3
const PIPS: Record<string, [number, number][]> = {
  '2': [[0.5, 0], [0.5, 1]],
  '3': [[0.5, 0], [0.5, 0.5], [0.5, 1]],
  '4': [[0, 0], [1, 0], [0, 1], [1, 1]],
  '5': [[0, 0], [1, 0], [0.5, 0.5], [0, 1], [1, 1]],
  '6': [[0, 0], [1, 0], [0, 0.5], [1, 0.5], [0, 1], [1, 1]],
  '7': [[0, 0], [1, 0], [0.5, 0.25], [0, 0.5], [1, 0.5], [0, 1], [1, 1]],
  '8': [[0, 0], [1, 0], [0.5, 0.25], [0, 0.5], [1, 0.5], [0.5, 0.75], [0, 1], [1, 1]],
  '9': [[0, 0], [1, 0], [0, T3], [1, T3], [0.5, 0.5], [0, 2 * T3], [1, 2 * T3], [0, 1], [1, 1]],
  T: [
    [0, 0], [1, 0], [0.5, 1 / 6], [0, T3], [1, T3],
    [0, 2 * T3], [1, 2 * T3], [0.5, 5 / 6], [0, 1], [1, 1],
  ],
}

/**
 * One card. `face` is null when the viewer is not entitled to see it - decided
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
        <Index label="J" suit="X" />
        <span className="court">
          <Suit s="X" />
        </span>
        <Index label="J" suit="X" bottom />
      </div>
    )
  }

  const r = rankOf(face)
  const s = suitOf(face)
  const label = r === 'T' ? '10' : r
  const court = r === 'J' || r === 'Q' || r === 'K'
  const spots = PIPS[r]

  return (
    <div
      className={[...base, isRed(face) ? 'is-red' : '', court ? 'is-court' : ''].join(' ')}
      key={key}
      aria-label={`${label} of ${SUIT_NAME[s] ?? s}`}
    >
      <Index label={label} suit={s} />

      {r === 'A' && (
        <span className="ace" aria-hidden="true">
          <Suit s={s} />
        </span>
      )}
      {court && (
        <span className="court" aria-hidden="true">
          <b>{r}</b>
          <em>
            <Suit s={s} />
          </em>
        </span>
      )}
      {spots && (
        <span className="field" aria-hidden="true">
          {spots.map(([col, row], i) => (
            <i
              key={i}
              className={row > 0.5 ? 'flip' : ''}
              style={{ left: `${col * 100}%`, top: `${row * 100}%` }}
            >
              <Suit s={s} />
            </i>
          ))}
        </span>
      )}

      <Index label={label} suit={s} bottom />
    </div>
  )
}

/** Rank over suit in the corner, and the same again upside down. */
function Index({ label, suit, bottom }: { label: string; suit: string; bottom?: boolean }) {
  return (
    <span className={`ix ${bottom ? 'ix--br' : 'ix--tl'}`} aria-hidden="true">
      <b>{label}</b>
      <Suit s={suit} />
    </span>
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
