import { describe, expect, test } from 'bun:test'
import { showdown, describeHand } from '../src/games/poker/eval.ts'

/**
 * pokersolver is pinned and effectively unmaintained. F4 in the design doc
 * explicitly does NOT validate it (both sides of that invariant call the same
 * library), so it gets validated here instead: every hand class in order, plus
 * the kicker and tie cases that decide real pots.
 */

const beats = (a: string[], b: string[], board: string[], why: string) => {
  const r = showdown(
    [
      { seatId: 'a', hole: a },
      { seatId: 'b', hole: b },
    ],
    board,
  )
  expect(r.winners, why).toEqual(['a'])
}

const ties = (a: string[], b: string[], board: string[], why: string) => {
  const r = showdown(
    [
      { seatId: 'a', hole: a },
      { seatId: 'b', hole: b },
    ],
    board,
  )
  expect(r.winners.sort(), why).toEqual(['a', 'b'])
}

describe('hand class ordering', () => {
  test('every class beats the one below it', () => {
    // straight flush > four of a kind
    beats(['9S', '8S'], ['7D', '7H'], ['7S', '7C', 'TS', 'JS', '2C'], 'straight flush > quads')
    // four of a kind > full house
    beats(['7D', '7H'], ['KS', 'KD'], ['7S', '7C', 'KC', '2H', '3D'], 'quads > full house')
    // full house > flush
    beats(['KS', 'KD'], ['2S', '5S'], ['KC', '9S', '9D', '7S', '3S'], 'full house > flush')
    // flush > straight
    beats(['2S', '5S'], ['TD', '9C'], ['AS', 'KS', '7S', '8H', 'JC'], 'flush > straight')
    // straight > three of a kind
    beats(['TD', '9C'], ['3S', '3D'], ['8H', 'JC', 'QD', '3C', '2H'], 'straight > trips')
    // three of a kind > two pair
    beats(['3S', '3D'], ['AH', 'KH'], ['3C', 'AD', 'KC', '7S', '2H'], 'trips > two pair')
    // two pair > one pair
    beats(['AH', 'KH'], ['QS', 'JD'], ['AD', 'KC', '7S', '2H', '4C'], 'two pair > pair')
    // one pair > high card
    beats(['QS', 'QD'], ['AH', 'KD'], ['2C', '7S', '9H', 'JC', '4D'], 'pair > high card')
    // high card decided by the top card
    beats(['AH', '3D'], ['KH', '4D'], ['2C', '7S', '9H', 'JC', '5D'], 'ace high > king high')
  })

  test('wheel: A-2-3-4-5 is a straight, and the lowest one', () => {
    beats(['AH', '2D'], ['KS', 'QD'], ['3C', '4S', '5H', '9C', 'JD'], 'wheel is a straight')
    beats(['6H', '2D'], ['AH', '2C'], ['3C', '4S', '5H', '9D', 'JS'], '6-high straight > wheel')
  })

  test('kickers decide otherwise identical hands', () => {
    beats(['AH', '9D'], ['KH', '9C'], ['9S', '2C', '5D', '7H', 'JC'], 'ace kicker beats king kicker')
    ties(['AH', 'KD'], ['AC', 'KH'], ['9S', '9C', '5D', '7H', 'JC'], 'same two pair + kicker splits')
  })

  test('the board plays and everyone splits', () => {
    ties(['2C', '3D'], ['4H', '5S'], ['AS', 'KS', 'QS', 'JS', 'TS'], 'royal flush on the board')
  })

  test('flush is compared by every card, not just the top one', () => {
    beats(['AS', '2S'], ['KS', 'QS'], ['9S', '7S', '3S', '2H', '4D'], 'ace-high flush wins')
    beats(['KS', 'JS'], ['KD', 'TS'], ['9S', '7S', '3S', '2H', '4D'], 'jack kicker beats ten in a flush')
  })
})

describe('showdown mechanics', () => {
  test('a single contender wins without evaluation', () => {
    const r = showdown([{ seatId: 'a', hole: ['2C', '3D'] }], ['AS', 'KS', 'QS', 'JS', 'TS'])
    expect(r.winners).toEqual(['a'])
  })

  test('three-way split is reported as three winners', () => {
    const r = showdown(
      [
        { seatId: 'a', hole: ['2C', '3D'] },
        { seatId: 'b', hole: ['4H', '5S'] },
        { seatId: 'c', hole: ['6C', '7D'] },
      ],
      ['AS', 'KS', 'QS', 'JS', 'TS'],
    )
    expect(r.winners.sort()).toEqual(['a', 'b', 'c'])
  })

  test('descriptions are human readable for the reveal screen', () => {
    expect(describeHand(['AS', 'KS'], ['QS', 'JS', 'TS', '2C', '3D'])).toContain('Royal')
    expect(describeHand(['7D', '7H'], ['7S', '7C', 'KC', '2H', '3D'])).toContain('Four')
  })
})
