/**
 * The four suits, drawn rather than typed.
 *
 * These used to be the text characters ♠ ♥ ♦ ♣, which was a mistake twice over.
 * A glyph is whatever the device's font decides it is — Windows, Android and
 * older iOS all draw a different heart, and some draw it in colour — and a
 * glyph's box is mostly padding, so pips ended up sitting on top of the corner
 * index. Shapes we draw ourselves are the same everywhere and sized exactly.
 */
export function Suit({ s }: { s: string }) {
  return (
    <svg className="suit" viewBox="0 0 100 100" fill="currentColor" aria-hidden="true" focusable="false">
      {s === 'H' && (
        <path d="M50 90C22 70 8 53 8 36 8 21 19 11 32 11c9 0 15 5 18 12 3-7 9-12 18-12 13 0 24 10 24 25 0 17-14 34-42 54Z" />
      )}
      {s === 'S' && (
        <path d="M50 8c28 20 42 37 42 54 0 13-9 22-21 22-8 0-15-4-19-10 1 10 6 16 14 20H34c8-4 13-10 14-20-4 6-11 10-19 10-12 0-21-9-21-22C8 45 22 28 50 8Z" />
      )}
      {s === 'D' && <path d="M50 6 86 50 50 94 14 50Z" />}
      {s === 'C' && (
        <>
          <circle cx="50" cy="27" r="20" />
          <circle cx="27" cy="60" r="20" />
          <circle cx="73" cy="60" r="20" />
          <path d="M44 58c2 18-2 30-11 36h34c-9-6-13-18-11-36Z" />
        </>
      )}
      {s === 'X' && (
        <path d="M50 6 61 38h34L67 58l11 33-28-20-28 20 11-33L5 38h34Z" />
      )}
    </svg>
  )
}
