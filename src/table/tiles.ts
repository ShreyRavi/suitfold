import type { CardId } from './model.ts'

/**
 * Tiles are cards.
 *
 * A Scrabble tile and a domino behave exactly like a playing card on this
 * table: they come off a pile, they sit in a hand only you can see, and they
 * get put down somewhere. So they are cards, with a different face drawn on
 * them, and every single thing the table already does works on them unchanged.
 *
 *   L-A-1   the letter A, worth one
 *   L-_-0   a blank
 *   D-3-5   the domino with three pips and five pips
 */
export const isLetter = (id: CardId) => id.startsWith('L-')
export const isDomino = (id: CardId) => id.startsWith('D-')

export const letterOf = (id: CardId) => id.split('-')[1] ?? '?'
export const letterScore = (id: CardId) => Number(id.split('-')[2] ?? 0)
export const dominoPips = (id: CardId): [number, number] => {
  const [, a, b] = id.split('-')
  return [Number(a ?? 0), Number(b ?? 0)]
}

/** How many of each letter, and what each is worth. The English set. */
const SCRABBLE: [string, number, number][] = [
  ['A', 9, 1], ['B', 2, 3], ['C', 2, 3], ['D', 4, 2], ['E', 12, 1], ['F', 2, 4],
  ['G', 3, 2], ['H', 2, 4], ['I', 9, 1], ['J', 1, 8], ['K', 1, 5], ['L', 4, 1],
  ['M', 2, 3], ['N', 6, 1], ['O', 8, 1], ['P', 2, 3], ['Q', 1, 10], ['R', 6, 1],
  ['S', 4, 1], ['T', 6, 1], ['U', 4, 1], ['V', 2, 4], ['W', 2, 4], ['X', 1, 8],
  ['Y', 2, 4], ['Z', 1, 10], ['_', 2, 0],
]

/** Bananagrams has no scores and a different, larger spread. */
const BANANA: [string, number][] = [
  ['A', 13], ['B', 3], ['C', 3], ['D', 6], ['E', 18], ['F', 3], ['G', 4],
  ['H', 3], ['I', 12], ['J', 2], ['K', 2], ['L', 5], ['M', 3], ['N', 8],
  ['O', 11], ['P', 3], ['Q', 2], ['R', 9], ['S', 6], ['T', 9], ['U', 6],
  ['V', 3], ['W', 3], ['X', 2], ['Y', 3], ['Z', 2],
]

export function scrabbleTiles(): CardId[] {
  const out: CardId[] = []
  for (const [letter, count, score] of SCRABBLE) {
    for (let i = 0; i < count; i++) out.push(`L-${letter}-${score}:${i}`)
  }
  return out
}

export function bananaTiles(): CardId[] {
  const out: CardId[] = []
  for (const [letter, count] of BANANA) {
    for (let i = 0; i < count; i++) out.push(`L-${letter}-0:${i}`)
  }
  return out
}

/** Double six: every unordered pair from 0 to 6, which is twenty eight bones. */
export function dominoTiles(): CardId[] {
  const out: CardId[] = []
  for (let a = 0; a <= 6; a++) for (let b = a; b <= 6; b++) out.push(`D-${a}-${b}`)
  return out
}
