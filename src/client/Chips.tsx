import { chipDiscs } from '../table/model.ts'

/**
 * A pile of discs. The amount is the truth; this is what it looks like.
 * Denominations are implied by colour, largest at the bottom, exactly as a
 * real stack sorts itself.
 */
export function ChipStack({ amount, big }: { amount: number; big?: boolean }) {
  const discs = chipDiscs(amount, big ? 9 : 6)
  if (amount <= 0) return null
  return (
    <span className={`chips ${big ? 'chips--big' : ''}`} aria-hidden="true">
      {discs.map((colour, i) => (
        <i
          key={i}
          style={{ background: colour, bottom: i * (big ? 4 : 3), zIndex: i }}
        />
      ))}
    </span>
  )
}

export const money = (n: number) => n.toLocaleString()
