import type { Puck, Slot } from './model.ts'
import { TABLE_H, TABLE_W } from './model.ts'

/**
 * The Chinese checkers board, which is a six pointed star of 121 holes.
 *
 * The table already knows how to do everything this game needs: it has markers
 * you can drag and it has places on the felt that things snap to. A board is
 * therefore not a new kind of object, it is a hundred and twenty one very small
 * places and sixty markers. The table still enforces nothing, exactly as it
 * enforces nothing about a deck of cards.
 *
 * The star is built row by row, which is how it is actually drawn. Seventeen
 * rows, and each row's holes sit two half steps apart so that consecutive rows
 * interlock into the triangular lattice a real board has.
 */
const ROWS = [1, 2, 3, 4, 13, 12, 11, 10, 9, 10, 11, 12, 13, 4, 3, 2, 1]

/** Half a step across, and one row down. */
const HX = 17
const DY = 30
const MID = 8

export interface Hole {
  /** Row from the top, and position in half steps either side of the middle. */
  row: number
  at: number
  x: number
  y: number
  /** Which point of the star this hole belongs to, if any. */
  home: number | null
}

/**
 * The six homes, in the order the seats go round: bottom first, because seat
 * zero sits at the bottom of the table.
 */
export const HOME_COLOURS = ['#c8412c', '#1f6f3f', '#2f5fa8', '#c9a227', '#6b3fa0', '#2f2a24']
export const HOME_NAMES = ['Red', 'Green', 'Blue', 'Yellow', 'Purple', 'Black']

function homeOf(row: number, at: number, len: number): number | null {
  // The two points on the vertical axis are whole rows of their own.
  if (row <= 3) return 3 // top
  if (row >= 13) return 0 // bottom
  // The four side points are the overhang either side of the central hexagon,
  // which is five holes wide at row four and widens by one each row inward.
  const hex = [5, 6, 7, 8, 9, 8, 7, 6, 5][row - 4]!
  const wing = (len - hex) / 2
  if (wing <= 0) return null
  const from = -(len - 1)
  const leftEnd = from + (wing - 1) * 2
  const rightStart = -leftEnd
  if (at <= leftEnd) return row < 8 ? 2 : 1 // upper left, lower left
  if (at >= rightStart) return row < 8 ? 4 : 5 // upper right, lower right
  return null
}

export function holes(): Hole[] {
  const out: Hole[] = []
  ROWS.forEach((len, row) => {
    for (let k = 0; k < len; k++) {
      const at = -(len - 1) + k * 2
      out.push({
        row,
        at,
        x: TABLE_W / 2 + at * HX,
        y: TABLE_H / 2 + (row - MID) * DY,
        home: homeOf(row, at, len),
      })
    }
  })
  return out
}

/** Every hole, as a place on the felt that a marble snaps into. */
export const starSlots = (): Slot[] =>
  holes().map((h) => ({ id: `h${h.row}-${h.at}`, x: h.x, y: h.y, label: '', dot: true }))

/**
 * Which points of the star are used, for a given number of players. Straight
 * out of the rules on the box: two play across the board from each other, three
 * take alternate points, four take two facing pairs, six take the lot.
 */
export function playing(seats: number): number[] {
  if (seats <= 2) return [0, 3]
  if (seats === 3) return [0, 2, 4]
  if (seats === 4) return [0, 1, 3, 4]
  if (seats === 5) return [0, 1, 2, 3, 4]
  return [0, 1, 2, 3, 4, 5]
}

/**
 * Ten marbles in each point that is being used, and none in the ones that are
 * not. Putting out all sixty regardless meant a two player game began by
 * clearing forty marbles off the board by hand.
 *
 * Nobody is assigned a colour: you take the ones nearest you, the way you would
 * reach for them.
 */
export const marbles = (seats = 6): Puck[] => {
  const inPlay = new Set(playing(seats))
  const out: Puck[] = []
  for (const h of holes()) {
    if (h.home === null || !inPlay.has(h.home)) continue
    out.push({
      id: `m${h.row}-${h.at}`,
      x: h.x,
      y: h.y,
      label: '',
      hint: `${HOME_NAMES[h.home]} marble`,
      colour: HOME_COLOURS[h.home],
    })
  }
  return out
}
