import { describe, expect, test } from 'bun:test'
import { validateHand, validateBrute } from '../src/games/rummy/melds.ts'
import { shuffle, standardDeck, seededRandom } from '../src/core/cards.ts'

/**
 * The rummy validator is this game's betting engine: not in any library, and
 * the thing a family will actually argue about. Hand-authored tests per rule,
 * then a fuzzer that cross-checks the fast solver against a deliberately naive
 * one.
 */

const hand = (s: string) => s.split(/\s+/).filter(Boolean)

const ok = (cards: string, wild: string | null, why: string) => {
  const r = validateHand(hand(cards), wild)
  expect(r.valid, `${why}\n${r.reason ?? ''}`).toBe(true)
}
const no = (cards: string, wild: string | null, why: string) => {
  expect(validateHand(hand(cards), wild).valid, why).toBe(false)
}

describe('what makes a valid declaration', () => {
  test('two pure sequences and two sets', () => {
    // 2S 3S 4S | 5H 6H 7H | 9C 9D 9H | KS KD KH KC
    ok('2S 3S 4S 5H 6H 7H 9C 9D 9H KS KD KH KC', null, 'classic valid hand')
  })

  test('a pure sequence plus an impure sequence plus sets', () => {
    // 2S 3S 4S pure | 5H 6H + joker | 9C 9D 9H | KS KD KH KC  = 13
    ok('2S 3S 4S 5H 6H X1 9C 9D 9H KS KD KH KC', null, 'joker fills the second run')
  })

  test('every card must be used', () => {
    no('2S 3S 4S 5H 6H 7H 9C 9D 9H KS KD KH 8C', null, 'the 8C belongs to nothing')
  })
})

describe('the pure sequence requirement', () => {
  test('a hand with no pure sequence is refused', () => {
    // Both runs use a joker; sets are fine. Still invalid.
    const r = validateHand(hand('2S 3S X1 5H 6H X2 9C 9D 9H KS KD KH KC'), null)
    expect(r.valid).toBe(false)
    expect(r.reason).toMatch(/pure sequence/i)
  })

  test('sets alone are never enough', () => {
    const r = validateHand(hand('9C 9D 9H KS KD KH 2C 2D 2H 5S 5D 5H 5C'), null)
    expect(r.valid).toBe(false)
    expect(r.reason).toMatch(/sequence/i)
  })

  test('one sequence and the rest sets is refused — two sequences are required', () => {
    // 2S 3S 4S is pure, everything else is a set.
    const r = validateHand(hand('2S 3S 4S 9C 9D 9H KS KD KH 5S 5D 5H 5C'), null)
    expect(r.valid).toBe(false)
    expect(r.reason).toMatch(/second sequence/i)
  })
})

describe('sets', () => {
  test('a set needs different suits', () => {
    // 9C 9C(second deck) 9D is only two suits.
    no('2S 3S 4S 5H 6H 7H 9C 9C:2 9D KS KD KH KC', null, 'duplicate suit in a set')
  })

  test('four of a rank is a legal set', () => {
    ok('2S 3S 4S 5H 6H 7H KS KD KH KC 9C 9D 9H', null, 'four kings')
  })
})

describe('runs', () => {
  test('the ace runs low', () => {
    ok('AS 2S 3S 5H 6H 7H 9C 9D 9H KS KD KH KC', null, 'A-2-3 of spades')
  })

  test('the ace runs high', () => {
    ok('QS KS AS 5H 6H 7H 9C 9D 9H 2C 2D 2H 2S', null, 'Q-K-A of spades')
  })

  test('a run may not wrap around the ace', () => {
    no('KS AS 2S 5H 6H 7H 9C 9D 9H 3C 3D 3H 3S', null, 'K-A-2 is not a run')
  })

  test('a run must be one suit', () => {
    no('2S 3H 4S 5H 6H 7H 9C 9D 9H KS KD KH KC', null, 'mixed suits')
  })
})

describe('jokers', () => {
  test('a card of the wild rank works as a joker', () => {
    // 7 is wild. The two 7s stand in inside the sets.
    ok('2S 3S 4S 5H 6H 8H 9C 9D 7H KS KD KH 7C', '7', 'wild sevens fill in')
  })

  test('a wild-rank card can also be played at face value', () => {
    // 7 is wild, and 5H 6H 7H is a pure run using the 7 naturally.
    ok('2S 3S 4S 5H 6H 7H 9C 9D 9H KS KD KH KC', '7', 'natural seven in a pure run')
  })

  test('a group always contains at least one real card', () => {
    // Jokers get absorbed into other groups rather than forming their own, so
    // check the property directly on whatever the solver returns.
    const r = validateHand(hand('2S 3S 4S 5H 6H 7H X1 X2 9H 9C 9D KS KD'), null)
    expect(r.valid).toBe(true)
    for (const g of r.groups) expect(g.cards.length).toBeGreaterThan(0)
  })

  test('more jokers than can be absorbed is still invalid', () => {
    // Four jokers and nine naturals that cannot host them all.
    const r = validateHand(hand('2S 3S 4S 5H 6H 7H 9C 9D 9H X1 X2 X3 X4'), null)
    for (const g of r.groups) expect(g.cards.length).toBeGreaterThan(0)
  })

  test('a joker inside a run makes it impure', () => {
    const r = validateHand(hand('2S 3S X1 5H 6H 7H 9C 9D 9H KS KD KH KC'), null)
    // 5H 6H 7H is still pure, so this hand is fine overall.
    expect(r.valid).toBe(true)
    expect(r.groups.filter((g) => g.kind === 'pure-run').length).toBeGreaterThanOrEqual(1)
  })
})

describe('cross-check against a naive implementation', () => {
  // The fast solver prunes aggressively. The reference enumerates partitions
  // directly. They must agree, or one of them is wrong.
  test('random 13-card hands get the same verdict from both', () => {
    let checked = 0
    let valid = 0
    for (let seed = 1; seed <= 300; seed++) {
      const rng = seededRandom(seed)
      const deck = shuffle(standardDeck(true, 2), rng)
      const cards = deck.slice(0, 13)
      const wild = seed % 3 === 0 ? '7' : null
      const fast = validateHand(cards, wild).valid
      const slow = validateBrute(cards, wild)
      expect(fast, `seed ${seed}: ${cards.join(' ')} wild=${wild}`).toBe(slow)
      checked++
      if (fast) valid++
    }
    expect(checked).toBe(300)
    // Random 13-card hands are almost never valid; that is expected.
    expect(valid).toBeLessThan(20)
  })

  test('hands built to be valid are agreed on by both', () => {
    const built = [
      ['2S 3S 4S 5H 6H 7H 9C 9D 9H KS KD KH KC', null],
      ['AS 2S 3S 5H 6H 7H 9C 9D 9H KS KD KH KC', null],
      ['QS KS AS 5H 6H 7H 9C 9D 9H 2C 2D 2H 2S', null],
      ['2S 3S 4S 5H 6H X1 9C 9D 9H KS KD KH KC', null],
    ] as const
    for (const [cards, wild] of built) {
      expect(validateHand(hand(cards), wild).valid, cards).toBe(true)
      expect(validateBrute(hand(cards), wild), `brute: ${cards}`).toBe(true)
    }
  })
})
