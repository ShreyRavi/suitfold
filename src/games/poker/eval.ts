import pokersolver from 'pokersolver'
import type { CardId, SeatId } from '../../core/types.ts'

const { Hand } = pokersolver as unknown as { Hand: PokerSolverHand }

interface SolvedHand {
  descr: string
  cards: unknown[]
}
interface PokerSolverHand {
  solve(cards: string[]): SolvedHand
  winners(hands: SolvedHand[]): SolvedHand[]
}

/**
 * Our card ids are "AS" / "TD"; pokersolver wants "As" / "Td".
 * Jokers never reach here — poker runs on a 52-card deck.
 */
export const toSolver = (id: CardId): string => `${id[0]}${id[1]!.toLowerCase()}`

export interface Showdown {
  winners: SeatId[]
  description: string
}

/**
 * Best hand among `contenders`, each holding 2 hole cards, sharing `board`.
 * Returns every winner when there is a tie.
 *
 * pokersolver is a pinned, unmaintained, pure-JS leaf dependency. It is
 * validated separately by tests/eval.test.ts, which enumerates hand classes and
 * checks the ordering rather than trusting it.
 */
export function showdown(
  contenders: { seatId: SeatId; hole: CardId[] }[],
  board: CardId[],
): Showdown {
  if (contenders.length === 0) return { winners: [], description: '' }
  if (contenders.length === 1) {
    return { winners: [contenders[0]!.seatId], description: 'uncontested' }
  }

  const solved = contenders.map((c) => ({
    seatId: c.seatId,
    hand: Hand.solve([...c.hole, ...board].map(toSolver)),
  }))
  const winning = Hand.winners(solved.map((s) => s.hand))
  const winners = solved.filter((s) => winning.includes(s.hand)).map((s) => s.seatId)
  const description = winning[0]?.descr ?? ''
  return { winners, description }
}

/** Description of one player's best five-card hand, for the reveal screen. */
export function describeHand(hole: CardId[], board: CardId[]): string {
  if (hole.length + board.length < 5) return ''
  return Hand.solve([...hole, ...board].map(toSolver)).descr
}
