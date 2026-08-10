import { describe, expect, test } from 'bun:test'
import { fuzz } from './fuzzcore.ts'

// A fast slice of the fuzzer runs on every `bun test`. The full 100k-hand pass
// is `bun run fuzz`. Gate 1 is the full pass; this keeps the loop honest.

describe('invariants over random play', () => {
  const seeds = Array.from({ length: 40 }, (_, i) => i + 1)

  test('F1-F7 hold across 40 random tables', () => {
    const all = seeds.map((seed) => fuzz({ seed, hands: 25, aggression: 0.4 }))
    const violations = all.flatMap((r) => r.violations)
    if (violations.length) {
      console.error(violations.slice(0, 10))
    }
    expect(violations).toEqual([])
  })

  test('the fuzzer actually reaches the hard cases', () => {
    // An invariant suite that never builds a side pot proves nothing.
    const all = seeds.map((seed) => fuzz({ seed, hands: 25, aggression: 0.5 }))
    const totals = all.reduce(
      (a, r) => ({
        hands: a.hands + r.hands,
        sidePots: a.sidePots + r.sidePots,
        showdowns: a.showdowns + r.showdowns,
        splits: a.splits + r.splitPots,
        allIns: a.allIns + r.allIns,
      }),
      { hands: 0, sidePots: 0, showdowns: 0, splits: 0, allIns: 0 },
    )
    expect(totals.hands).toBeGreaterThan(500)
    expect(totals.allIns).toBeGreaterThan(50)
    expect(totals.sidePots).toBeGreaterThan(10)
    expect(totals.showdowns).toBeGreaterThan(50)
  })
})
