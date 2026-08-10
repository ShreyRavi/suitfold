import type { CardId } from './types.ts'

export const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'] as const
export const SUITS = ['S', 'H', 'D', 'C'] as const

export type Rank = (typeof RANKS)[number]
export type Suit = (typeof SUITS)[number]

/** A printed joker. The wild RANK is a rummy concept and lives there. */
export const isJoker = (id: CardId) => id.startsWith('X')
export const rankOf = (id: CardId) => id[0] as Rank
export const suitOf = (id: CardId) => id[1] as Suit
export const isRed = (id: CardId) => id[1] === 'H' || id[1] === 'D'

/**
 * Card ids are `<rank><suit>` for the first deck and `<rank><suit>:<n>` for
 * every deck after it, because a card must live in exactly one zone and two
 * decks would otherwise put the same id in two places. Rank and suit are still
 * index 0 and 1, so nothing downstream had to change.
 *
 * Rummy needs two decks; poker uses one.
 */
export function standardDeck(jokers = false, decks = 1): CardId[] {
  const out: CardId[] = []
  for (let d = 1; d <= decks; d++) {
    const tag = d === 1 ? '' : `:${d}`
    for (const s of SUITS) for (const r of RANKS) out.push(`${r}${s}${tag}`)
    if (jokers) out.push(`X${d}`)
  }
  return out
}

/**
 * Unbiased shuffle. Rejection sampling on crypto randomness, never `% n` —
 * this is a dealer a family has to trust, and modulo bias is a real skew.
 */
export function shuffle<T>(input: readonly T[], rng: RandomSource = cryptoRandom): T[] {
  const a = input.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng(i + 1)
    const ai = a[i]!
    a[i] = a[j]!
    a[j] = ai
  }
  return a
}

/** Returns a uniformly distributed integer in [0, max). */
export type RandomSource = (max: number) => number

export const cryptoRandom: RandomSource = (max) => {
  if (max <= 0) throw new Error('max must be positive')
  if (max === 1) return 0
  // Smallest byte count that can hold max-1, then reject any draw that would
  // land in the biased tail.
  const bytes = Math.ceil(Math.log2(max) / 8) || 1
  const limit = Math.floor(256 ** bytes / max) * max
  const buf = new Uint8Array(bytes)
  for (;;) {
    crypto.getRandomValues(buf)
    let v = 0
    for (const b of buf) v = v * 256 + b
    if (v < limit) return v % max
  }
}

/**
 * Deterministic source for tests and the fuzzer. mulberry32 — small, fast, and
 * good enough for shuffling in a test harness. Never used in production.
 */
export function seededRandom(seed: number): RandomSource {
  let s = seed >>> 0
  return (max) => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    const r = ((t ^ (t >>> 14)) >>> 0) / 4294967296
    return Math.floor(r * max)
  }
}
