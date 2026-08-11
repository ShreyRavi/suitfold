import type { Die, Line, Puck, Slot } from './model.ts'
import { TABLE_H, TABLE_W } from './model.ts'

const CX = TABLE_W / 2
const CY = TABLE_H / 2

// ---------------------------------------------------------------------------
// Chess
// ---------------------------------------------------------------------------

const SQ = 62
const BACK = ['R', 'N', 'B', 'Q', 'K', 'B', 'N', 'R']

/** Eight by eight, chequered, with the files and ranks written on the edge. */
export function chessBoard(): Slot[] {
  const out: Slot[] = []
  const left = CX - 3.5 * SQ
  const top = CY - 3.5 * SQ
  for (let rank = 0; rank < 8; rank++) {
    for (let file = 0; file < 8; file++) {
      const dark = (rank + file) % 2 === 1
      out.push({
        id: `sq-${'abcdefgh'[file]}${8 - rank}`,
        x: left + file * SQ,
        y: top + rank * SQ,
        label: '',
        cell: SQ,
        ...(dark ? { shade: 'rgba(42,29,18,.30)' } : {}),
        ...(file === 0 ? { note: String(8 - rank) } : {}),
      })
    }
  }
  return out
}

export function chessPieces(): Puck[] {
  const out: Puck[] = []
  const left = CX - 3.5 * SQ
  const top = CY - 3.5 * SQ
  const put = (file: number, rank: number, kind: string, white: boolean) =>
    out.push({
      id: `cp-${white ? 'w' : 'b'}${kind}-${file}${rank}`,
      x: left + file * SQ,
      y: top + rank * SQ,
      label: (white ? 'w' : 'b') + kind,
      hint: `${white ? 'White' : 'Black'} ${NAMES[kind] ?? kind}`,
      colour: white ? '#f4efe2' : '#2a2118',
    })
  for (let f = 0; f < 8; f++) {
    put(f, 0, BACK[f]!, false)
    put(f, 1, 'P', false)
    put(f, 6, 'P', true)
    put(f, 7, BACK[f]!, true)
  }
  return out
}

const NAMES: Record<string, string> = { K: 'king', Q: 'queen', R: 'rook', B: 'bishop', N: 'knight', P: 'pawn' }

// ---------------------------------------------------------------------------
// Snakes and ladders
// ---------------------------------------------------------------------------

const SL = 58
/** Where they start and where they end up. The classic board's set. */
const SNAKES: [number, number][] = [[16, 6], [47, 26], [49, 11], [56, 53], [62, 19], [64, 60], [87, 24], [93, 73], [95, 75], [98, 78]]
const LADDERS: [number, number][] = [[1, 38], [4, 14], [9, 31], [21, 42], [28, 84], [36, 44], [51, 67], [71, 91], [80, 100]]

/** Square one is bottom left, and the numbering snakes back and forth. */
function cellAt(n: number) {
  const row = Math.floor((n - 1) / 10)
  const inRow = (n - 1) % 10
  const file = row % 2 === 0 ? inRow : 9 - inRow
  return {
    x: CX - 4.5 * SL + file * SL,
    y: CY + 4.5 * SL - row * SL,
  }
}

export function snakesBoard(): Slot[] {
  const out: Slot[] = []
  for (let n = 1; n <= 100; n++) {
    const { x, y } = cellAt(n)
    const up = LADDERS.find(([from]) => from === n)
    const down = SNAKES.find(([from]) => from === n)
    out.push({
      id: `sl-${n}`,
      x,
      y,
      label: '',
      cell: SL,
      note: String(n),
      ...(up ? { shade: 'rgba(47,111,63,.26)' } : down ? { shade: 'rgba(176,43,30,.24)' } : {}),
    })
  }
  return out
}

export function snakesLines(): Line[] {
  const out: Line[] = []
  for (const [from, to] of LADDERS) {
    const a = cellAt(from)
    const b = cellAt(to)
    out.push({ id: `ld-${from}`, x1: a.x, y1: a.y, x2: b.x, y2: b.y, colour: '#2f6f3f' })
  }
  for (const [from, to] of SNAKES) {
    const a = cellAt(from)
    const b = cellAt(to)
    out.push({ id: `sn-${from}`, x1: a.x, y1: a.y, x2: b.x, y2: b.y, colour: '#b02b1e', wavy: true })
  }
  return out
}

const TOKEN_COLOURS = ['#c8412c', '#1f6f3f', '#2f5fa8', '#c9a227', '#6b3fa0', '#2f2a24']

/** Beside the board, not under it: the bottom of the felt is spoken for. */
export function snakesTokens(): Puck[] {
  return TOKEN_COLOURS.map((colour, i) => ({
    id: `tok-${i}`,
    x: CX - 5.5 * SL - 34,
    y: CY - 2.5 * SL + i * 40,
    label: '',
    hint: `Counter ${i + 1}`,
    colour,
  }))
}

export const oneDie = (): Die[] => [
  { id: 'd1', x: CX + 5.5 * SL + 40, y: CY, faces: 6, value: 1, held: false },
]

// ---------------------------------------------------------------------------
// Scrabble
// ---------------------------------------------------------------------------

const SB = 42
/** Triple word, double word, triple letter, double letter, in board order. */
const TW = [[0, 0], [0, 7], [0, 14], [7, 0], [7, 14], [14, 0], [14, 7], [14, 14]]
const DW = [[1, 1], [2, 2], [3, 3], [4, 4], [1, 13], [2, 12], [3, 11], [4, 10], [13, 1], [12, 2], [11, 3], [10, 4], [13, 13], [12, 12], [11, 11], [10, 10], [7, 7]]
const TL = [[1, 5], [1, 9], [5, 1], [5, 5], [5, 9], [5, 13], [9, 1], [9, 5], [9, 9], [9, 13], [13, 5], [13, 9]]
const DL = [[0, 3], [0, 11], [2, 6], [2, 8], [3, 0], [3, 7], [3, 14], [6, 2], [6, 6], [6, 8], [6, 12], [7, 3], [7, 11], [8, 2], [8, 6], [8, 8], [8, 12], [11, 0], [11, 7], [11, 14], [12, 6], [12, 8], [14, 3], [14, 11]]

const has = (list: number[][], r: number, c: number) => list.some(([a, b]) => a === r && b === c)

export function scrabbleBoard(): Slot[] {
  // The bag goes beside the board. Left in the middle it sits on the star,
  // which is the one square everybody needs to see.
  const out: Slot[] = [{ id: 'draw', x: CX - 7.5 * SB - 66, y: CY, label: 'Bag' }]
  const left = CX - 7 * SB
  const top = CY - 7 * SB
  for (let r = 0; r < 15; r++) {
    for (let c = 0; c < 15; c++) {
      const premium = has(TW, r, c)
        ? { shade: 'rgba(176,43,30,.34)', note: 'TW' }
        : has(DW, r, c)
          ? { shade: 'rgba(201,110,90,.26)', note: r === 7 && c === 7 ? '★' : 'DW' }
          : has(TL, r, c)
            ? { shade: 'rgba(31,75,122,.30)', note: 'TL' }
            : has(DL, r, c)
              ? { shade: 'rgba(47,127,143,.22)', note: 'DL' }
              : {}
      out.push({ id: `sc-${r}-${c}`, x: left + c * SB, y: top + r * SB, label: '', cell: SB, ...premium })
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Boggle
// ---------------------------------------------------------------------------

/** The sixteen dice of the classic set, each with its own six letters. */
const BOGGLE = [
  'AAEEGN', 'ABBJOO', 'ACHOPS', 'AFFKPS', 'AOOTTW', 'CIMOTU', 'DEILRX', 'DELRVY',
  'DISTTY', 'EEGHNW', 'EEINSU', 'EHRTVW', 'EIOSST', 'ELRTTY', 'HIMNQU', 'HLNNRZ',
]

export function boggleDice(): Die[] {
  const out: Die[] = []
  const left = CX - 1.5 * 86
  const top = CY - 1.5 * 86
  BOGGLE.forEach((letters, i) => {
    out.push({
      id: `bg-${i}`,
      x: left + (i % 4) * 86,
      y: top + Math.floor(i / 4) * 86,
      faces: 6,
      value: i % 6,
      letters: letters.split(''),
      held: false,
    })
  })
  return out
}

export const boggleTray = (): Slot[] => {
  const out: Slot[] = []
  const left = CX - 1.5 * 86
  const top = CY - 1.5 * 86
  for (let i = 0; i < 16; i++) {
    out.push({ id: `bt-${i}`, x: left + (i % 4) * 86, y: top + Math.floor(i / 4) * 86, label: '', cell: 80 })
  }
  return out
}

// ---------------------------------------------------------------------------
// Yahtzee
// ---------------------------------------------------------------------------

export const fiveDice = (): Die[] =>
  Array.from({ length: 5 }, (_, i) => ({
    id: `y${i}`,
    x: CX - 2 * 74 + i * 74,
    y: CY,
    faces: 6,
    value: 1,
    held: false,
  }))
