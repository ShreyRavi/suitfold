import type { CardId } from './model.ts'

/**
 * Decks are just lists of card ids. The renderer knows how to draw an id, so
 * adding a deck is adding a list — no rules, no engine, no new concepts.
 */

export const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K'] as const
export const SUITS = ['S', 'H', 'D', 'C'] as const

export const isJoker = (id: CardId) => id.startsWith('X')
export const rankOf = (id: CardId) => id[0]!
export const suitOf = (id: CardId) => id[1]!
export const isRed = (id: CardId) => id[1] === 'H' || id[1] === 'D'

/**
 * Ids are `<rank><suit>` in the first deck and `<rank><suit>:<n>` after it,
 * because two decks would otherwise put the same id on the table twice.
 */
export function standard(decks = 1, jokers = 0): CardId[] {
  const out: CardId[] = []
  for (let d = 1; d <= decks; d++) {
    const tag = d === 1 ? '' : `:${d}`
    for (const s of SUITS) for (const r of RANKS) out.push(`${r}${s}${tag}`)
  }
  for (let j = 1; j <= jokers; j++) out.push(`X${j}`)
  return out
}

export interface DeckPreset {
  id: string
  name: string
  hint: string
  cards: () => CardId[]
  /** Cards dealt to each player when the table is set up. */
  deal: number
}

/**
 * Presets are furniture, not rules. "Poker" here means a 52-card deck and two
 * cards each — the app will not stop you doing anything else with them.
 */
export const PRESETS: DeckPreset[] = [
  { id: 'deck', name: 'Just a deck', hint: '52 cards, nothing dealt', cards: () => standard(1), deal: 0 },
  { id: 'poker', name: 'Poker', hint: '52 cards, 2 each', cards: () => standard(1), deal: 2 },
  { id: 'rummy', name: 'Rummy', hint: '2 decks + jokers, 13 each', cards: () => standard(2, 2), deal: 13 },
  { id: 'hearts', name: 'Hearts / Spades', hint: '52 cards, 13 each', cards: () => standard(1), deal: 13 },
  { id: 'go-fish', name: 'Go Fish', hint: '52 cards, 7 each', cards: () => standard(1), deal: 7 },
  { id: 'bluff', name: 'Bluff / Cheat', hint: '52 cards, dealt out evenly', cards: () => standard(1), deal: -1 },
  { id: 'double', name: 'Two decks', hint: '104 cards + 2 jokers', cards: () => standard(2, 2), deal: 0 },
]

export const presetById = (id: string) => PRESETS.find((p) => p.id === id) ?? PRESETS[0]!

/** Unbiased shuffle — rejection sampling, never `% n`. */
export function shuffle<T>(input: readonly T[], rng: () => number = Math.random): T[] {
  const a = input.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const ai = a[i]!
    a[i] = a[j]!
    a[j] = ai
  }
  return a
}

export function cryptoShuffle<T>(input: readonly T[]): T[] {
  return shuffle(input, () => {
    const buf = new Uint32Array(1)
    crypto.getRandomValues(buf)
    return buf[0]! / 2 ** 32
  })
}
