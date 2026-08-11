import type { Die } from '../table/model.ts'

/** Where the pips sit on a face, which is the same on every die ever made. */
const PIPS: Record<number, [number, number][]> = {
  1: [[50, 50]],
  2: [[28, 28], [72, 72]],
  3: [[28, 28], [50, 50], [72, 72]],
  4: [[28, 28], [72, 28], [28, 72], [72, 72]],
  5: [[28, 28], [72, 28], [50, 50], [28, 72], [72, 72]],
  6: [[28, 24], [72, 24], [28, 50], [72, 50], [28, 76], [72, 76]],
}

/**
 * A die. The lettered ones are Boggle's, and they show a letter rather than
 * pips; everything else shows what a die shows.
 *
 * `Qu` is drawn on the real Boggle die as one face, because a Q without a U is
 * no use to anybody.
 */
export function DieFace({ die }: { die: Die }) {
  if (die.letters) {
    const letter = die.letters[die.value % die.letters.length] ?? '?'
    return <span className="die-letter">{letter === 'Q' ? 'Qu' : letter}</span>
  }
  return (
    <span className="die-pips" aria-hidden="true">
      {(PIPS[die.value] ?? []).map(([x, y], i) => (
        <i key={i} style={{ left: `${x}%`, top: `${y}%` }} />
      ))}
    </span>
  )
}

export const dieLabel = (die: Die) =>
  die.letters ? `letter die showing ${die.letters[die.value % die.letters.length]}` : `die showing ${die.value}`
