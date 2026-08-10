import type { CardId } from '../../core/types.ts'
import { isJoker, rankOf, suitOf, type Suit } from '../../core/cards.ts'

/**
 * Indian Rummy hand validation. This is rummy's betting engine: the part that
 * is not in any library and the part a family will actually argue about.
 *
 * A hand of 13 is valid when every card belongs to a group, and:
 *   - at least ONE group is a PURE sequence (3+ consecutive, same suit, no joker)
 *   - at least TWO groups are sequences
 *   - sets are 3-4 cards of one rank in DIFFERENT suits
 *   - jokers substitute for any card except inside a pure sequence
 *   - a group may not be made of jokers alone
 *   - the ace runs low (A-2-3) or high (Q-K-A) but never wraps (K-A-2)
 *
 * A card of the wild rank may be played as a joker OR at its face value, so a
 * hand is tried both ways.
 */

export const RANK_ORDER = ['A', '2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K'] as const
const rankIndex = (r: string) => RANK_ORDER.indexOf(r as (typeof RANK_ORDER)[number]) + 1 // A=1..K=13

export interface Card {
  id: CardId
  /** 1 = ace low. High-ace runs are handled by the run generator. */
  rank: number
  suit: Suit
  /** A printed joker, or a card of the wild rank being used as one. */
  wild: boolean
}

export type GroupKind = 'pure-run' | 'run' | 'set'

export interface Group {
  kind: GroupKind
  cards: CardId[]
  /** Jokers standing in for missing cards. */
  jokers: CardId[]
}

export interface Validation {
  valid: boolean
  groups: Group[]
  /** Plain English, shown to the player before a declaration costs them. */
  reason?: string
}

export const parse = (id: CardId, wildRank: string | null): Card => ({
  id,
  rank: isJoker(id) ? 0 : rankIndex(rankOf(id)),
  suit: (isJoker(id) ? 'S' : suitOf(id)) as Suit,
  wild: isJoker(id) || (wildRank !== null && !isJoker(id) && rankOf(id) === wildRank),
})

/**
 * Validate a 13-card hand. `wildRank` is the rank of the turned joker card, or
 * null when playing without one.
 */
export function validateHand(ids: CardId[], wildRank: string | null): Validation {
  if (ids.length === 0) return { valid: false, groups: [], reason: 'No cards.' }

  const parsed = ids.map((id) => parse(id, wildRank))
  // Cards of the wild rank can be played either way, so try every combination
  // of natural-or-joker for them. There are rarely more than two or three.
  const flexible = parsed.filter((c) => c.wild && !isJoker(c.id))
  const combos = Math.min(1 << flexible.length, 64)

  let best: Validation = {
    valid: false,
    groups: [],
    reason: 'These cards do not all fit into sets and sequences.',
  }

  for (let mask = 0; mask < combos; mask++) {
    const cards = parsed.map((c) => ({ ...c }))
    flexible.forEach((f, i) => {
      const target = cards.find((c) => c.id === f.id)!
      // bit set = play it as a joker, bit clear = play it at face value
      target.wild = (mask & (1 << i)) !== 0
    })

    const solved = solve(cards)
    if (!solved) continue

    const sequences = solved.filter((g) => g.kind === 'run' || g.kind === 'pure-run')
    const pure = solved.filter((g) => g.kind === 'pure-run')
    if (pure.length >= 1 && sequences.length >= 2) return { valid: true, groups: solved }

    // Remember the most complete near-miss so the message can be specific.
    if (!best.groups.length || solved.length < best.groups.length) {
      best = {
        valid: false,
        groups: solved,
        reason:
          pure.length === 0
            ? 'You need at least one pure sequence — three or more running cards in the same suit, with no joker in it.'
            : 'You need a second sequence. Sets alone are not enough.',
      }
    }
  }

  return best
}

/** Exact cover: every card must land in exactly one group. */
function solve(cards: Card[]): Group[] | null {
  const naturals = cards.filter((c) => !c.wild).sort((a, b) => a.suit.localeCompare(b.suit) || a.rank - b.rank)
  const jokers = cards.filter((c) => c.wild)
  const seen = new Set<string>()

  const search = (remaining: Card[], jokerPool: Card[], acc: Group[]): Group[] | null => {
    if (remaining.length === 0) {
      // Leftover jokers have nowhere to go, so the hand is not complete.
      return jokerPool.length === 0 ? acc : null
    }

    const key = `${remaining.map((c) => c.id).join(',')}|${jokerPool.length}`
    if (seen.has(key)) return null
    seen.add(key)

    const head = remaining[0]!
    for (const g of candidates(head, remaining, jokerPool)) {
      const usedNatural = new Set(g.group.cards)
      const nextRemaining = remaining.filter((c) => !usedNatural.has(c.id))
      const nextJokers = jokerPool.slice(g.jokersUsed)
      const found = search(nextRemaining, nextJokers, [...acc, g.group])
      if (found) return found
    }
    return null
  }

  return search(naturals, jokers, [])
}

interface Candidate {
  group: Group
  jokersUsed: number
}

/** Every group that could contain `head`, largest first so jokers get absorbed. */
function candidates(head: Card, pool: Card[], jokers: Card[]): Candidate[] {
  return [...runsFor(head, pool, jokers), ...setsFor(head, pool, jokers)].sort(
    (a, b) => b.group.cards.length + b.group.jokers.length - (a.group.cards.length + a.group.jokers.length),
  )
}

function runsFor(head: Card, pool: Card[], jokers: Card[]): Candidate[] {
  const out: Candidate[] = []
  const suited = pool.filter((c) => c.suit === head.suit)

  // At most one natural per rank in a run — two decks can supply duplicates.
  const at = new Map<number, Card>()
  for (const c of suited) if (!at.has(c.rank)) at.set(c.rank, c)
  // The ace also plays high, above the king.
  const highAce = suited.find((c) => c.rank === 1)
  if (highAce && !at.has(14)) at.set(14, highAce)

  const positions = head.rank === 1 ? [1, 14] : [head.rank]

  for (const headPos of positions) {
    if (at.get(headPos)?.id !== head.id && !(headPos === 14 && head.rank === 1)) continue
    for (let start = Math.max(1, headPos - 13); start <= headPos; start++) {
      for (let end = headPos; end <= 14; end++) {
        if (end - start + 1 < 3) continue
        if (start < 1 || end > 14) continue

        const cards: CardId[] = []
        const used: CardId[] = []
        let need = 0
        let ok = true
        let coversHead = false

        for (let r = start; r <= end; r++) {
          const nat = at.get(r)
          if (nat && !used.includes(nat.id)) {
            used.push(nat.id)
            cards.push(nat.id)
            if (nat.id === head.id) coversHead = true
          } else {
            need++
          }
        }
        if (!ok || !coversHead) continue
        if (need > jokers.length) continue
        if (cards.length === 0) continue // a run of only jokers is not a group

        out.push({
          group: {
            kind: need === 0 ? 'pure-run' : 'run',
            cards,
            jokers: jokers.slice(0, need).map((j) => j.id),
          },
          jokersUsed: need,
        })
      }
    }
  }
  return out
}

function setsFor(head: Card, pool: Card[], jokers: Card[]): Candidate[] {
  const out: Candidate[] = []
  // Same rank, distinct suits. Two decks can deal the same card twice, and a
  // set may not contain the same suit twice.
  const bySuit = new Map<Suit, Card>()
  for (const c of pool) {
    if (c.rank !== head.rank) continue
    if (!bySuit.has(c.suit)) bySuit.set(c.suit, c)
  }
  bySuit.set(head.suit, head)

  const mates = [...bySuit.values()]
  for (let take = 1; take <= mates.length; take++) {
    const chosen = [head, ...mates.filter((c) => c.id !== head.id).slice(0, take - 1)]
    if (chosen.length !== take) continue
    for (const size of [3, 4]) {
      const need = size - take
      if (need < 0 || need > jokers.length) continue
      if (size > 4) continue
      out.push({
        group: {
          kind: 'set',
          cards: chosen.map((c) => c.id),
          jokers: jokers.slice(0, need).map((j) => j.id),
        },
        jokersUsed: need,
      })
    }
  }
  return out
}

/**
 * Deliberately naive reference implementation: enumerate every partition into
 * groups of size 3-5 and check each one directly. Far too slow for play, which
 * is the point — the fuzzer cross-checks the fast solver against it.
 */
export function validateBrute(ids: CardId[], wildRank: string | null): boolean {
  const cards = ids.map((id) => parse(id, wildRank))
  if (cards.length > 13) return false

  const isSet = (g: Card[]) => {
    const nat = g.filter((c) => !c.wild)
    if (nat.length === 0) return false
    if (g.length < 3 || g.length > 4) return false
    const r = nat[0]!.rank
    if (!nat.every((c) => c.rank === r)) return false
    const suits = new Set(nat.map((c) => c.suit))
    return suits.size === nat.length
  }

  const isRun = (g: Card[]) => {
    const nat = g.filter((c) => !c.wild)
    if (nat.length === 0 || g.length < 3) return false
    const s = nat[0]!.suit
    if (!nat.every((c) => c.suit === s)) return false
    for (const aceHigh of [false, true]) {
      const ranks = nat.map((c) => (aceHigh && c.rank === 1 ? 14 : c.rank)).sort((a, b) => a - b)
      if (new Set(ranks).size !== ranks.length) continue
      const lo = ranks[0]!
      const hi = ranks[ranks.length - 1]!
      // Jokers can extend the run PAST the naturals, not just fill holes
      // between them: 5H 6H + joker is the run 5-6-7 (or 4-5-6). So ask whether
      // a window of the group's length fits inside A..K and covers every
      // natural, rather than measuring the naturals' own span.
      if (hi - lo + 1 > g.length) continue
      const startMin = Math.max(1, hi - g.length + 1)
      const startMax = Math.min(lo, 14 - g.length + 1)
      if (startMin <= startMax) return true
    }
    return false
  }

  const pure = (g: Card[]) => isRun(g) && g.every((c) => !c.wild)

  const partition = (rest: Card[], acc: Card[][]): boolean => {
    if (rest.length === 0) {
      const runs = acc.filter(isRun)
      return acc.every((g) => isSet(g) || isRun(g)) && runs.length >= 2 && acc.some(pure)
    }
    const head = rest[0]!
    const others = rest.slice(1)
    for (const size of [3, 4, 5]) {
      if (others.length < size - 1) continue
      for (const combo of combinations(others, size - 1)) {
        const g = [head, ...combo]
        if (!isSet(g) && !isRun(g)) continue
        const used = new Set(g.map((c) => c.id))
        if (partition(rest.filter((c) => !used.has(c.id)), [...acc, g])) return true
      }
    }
    return false
  }

  return partition(cards, [])
}

function* combinations<T>(xs: T[], k: number): Generator<T[]> {
  if (k === 0) return yield []
  for (let i = 0; i <= xs.length - k; i++) {
    for (const rest of combinations(xs.slice(i + 1), k - 1)) yield [xs[i]!, ...rest]
  }
}
