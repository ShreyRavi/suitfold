/**
 * Gate 1. `bun run fuzz` — no table UI until this is green.
 *
 * Budget it: a fuzzer that takes longer than a coffee is a fuzzer you stop
 * running. Pass a hand count as argv[2] to shrink or grow the run.
 */
import { fuzz, type Violation } from './fuzzcore.ts'

const TARGET = Number(process.argv[2] ?? 100_000)
const HANDS_PER_TABLE = 40
const TABLES = Math.ceil(TARGET / HANDS_PER_TABLE)

const started = performance.now()
const totals = { hands: 0, showdowns: 0, sidePots: 0, splitPots: 0, allIns: 0 }
const violations: Violation[] = []

for (let seed = 1; seed <= TABLES; seed++) {
  const r = fuzz({ seed, hands: HANDS_PER_TABLE, aggression: 0.2 + (seed % 5) * 0.12 })
  totals.hands += r.hands
  totals.showdowns += r.showdowns
  totals.sidePots += r.sidePots
  totals.splitPots += r.splitPots
  totals.allIns += r.allIns
  violations.push(...r.violations)
  if (violations.length > 50) break
  if (seed % 250 === 0) {
    const pct = ((totals.hands / TARGET) * 100).toFixed(0)
    process.stdout.write(`\r  ${totals.hands} hands (${pct}%) — ${violations.length} violations`)
  }
}

const secs = (performance.now() - started) / 1000
process.stdout.write('\r' + ' '.repeat(60) + '\r')

console.log(`suitfold engine fuzz`)
console.log(`  hands        ${totals.hands.toLocaleString()}`)
console.log(`  showdowns    ${totals.showdowns.toLocaleString()}`)
console.log(`  all-ins      ${totals.allIns.toLocaleString()}`)
console.log(`  side pots    ${totals.sidePots.toLocaleString()}`)
console.log(`  split pots   ${totals.splitPots.toLocaleString()}`)
console.log(`  time         ${secs.toFixed(1)}s (${Math.round(totals.hands / secs).toLocaleString()} hands/s)`)

if (violations.length) {
  console.log(`\n  ${violations.length} VIOLATIONS`)
  const byInvariant = new Map<string, Violation[]>()
  for (const v of violations) {
    const list = byInvariant.get(v.invariant) ?? []
    list.push(v)
    byInvariant.set(v.invariant, list)
  }
  for (const [name, list] of byInvariant) {
    console.log(`\n  ${name} — ${list.length}`)
    for (const v of list.slice(0, 3)) console.log(`    seed ${v.seed} hand ${v.hand}: ${v.detail}`)
  }
  process.exit(1)
}

console.log(`\n  GATE 1 PASS — F1-F7 held across every hand.`)
