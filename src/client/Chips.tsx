import { chipDiscs, chipTray } from '../table/model.ts'

/**
 * A pile of discs, small enough to sit inline beside a number.
 */
export function ChipStack({ amount, big }: { amount: number; big?: boolean }) {
  const discs = chipDiscs(amount, big ? 9 : 6)
  if (amount <= 0) return null
  return (
    <span className={`chips ${big ? 'chips--big' : ''}`} aria-hidden="true">
      {discs.map((colour, i) => (
        <i key={i} style={{ background: colour, bottom: i * (big ? 4 : 3), zIndex: i }} />
      ))}
    </span>
  )
}

/**
 * A real tray of chips, in front of somebody, as tall as they are rich.
 *
 * You should be able to tell who is winning by glancing at the table rather
 * than by reading four numbers, which is how it works with actual chips.
 */
export function ChipTray({ amount, small }: { amount: number; small?: boolean }) {
  const columns = chipTray(amount)
  if (!columns.length) return null
  return (
    <span className={`tray ${small ? 'tray--sm' : ''}`} aria-hidden="true">
      {columns.map((col, c) => (
        <span className="tray-col" key={c}>
          {Array.from({ length: col.count }).map((_, i) => (
            <i key={i} style={{ background: col.colour, bottom: i * (small ? 3 : 4) }} />
          ))}
        </span>
      ))}
    </span>
  )
}

export const money = (n: number) => n.toLocaleString()
