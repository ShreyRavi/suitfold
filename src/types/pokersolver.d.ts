declare module 'pokersolver' {
  export interface SolvedHand {
    descr: string
    name: string
    rank: number
    cards: unknown[]
  }
  export const Hand: {
    solve(cards: string[], game?: string, canDisqualify?: boolean): SolvedHand
    winners(hands: SolvedHand[]): SolvedHand[]
  }
  const _default: { Hand: typeof Hand }
  export default _default
}
