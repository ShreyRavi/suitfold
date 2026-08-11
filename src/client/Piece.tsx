/**
 * The chess pieces, drawn rather than typed.
 *
 * The unicode chess characters exist, but they are a font's opinion the same
 * way the suit characters were: some devices draw them solid, some hollow, and
 * a hollow black king next to a hollow white king is unplayable. These are
 * silhouettes, so white and black differ only in fill, which is the one thing
 * that has to be unambiguous.
 */
export function Piece({ kind }: { kind: string }) {
  return (
    <svg className="piece" viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      {kind === 'P' && (
        <path d="M50 16a13 13 0 0 1 8 23c7 5 11 13 12 22H30c1-9 5-17 12-22a13 13 0 0 1 8-23ZM26 66h48c3 8 7 13 12 17H14c5-4 9-9 12-17Z" />
      )}
      {kind === 'R' && (
        <path d="M20 14h13v9h11v-9h12v9h11v-9h13v24l-9 8v25l9 12v6H20v-6l9-12V46l-9-8Z" />
      )}
      {kind === 'N' && (
        <path d="M36 12c12 0 32 9 38 30 4 15 2 27-2 36H30c0-9 4-15 11-21 5-4 4-9-1-8-6 2-11 7-16 6-6-1-8-8-4-14 6-9 14-13 14-19 0-4-2-6 2-10ZM26 84h50c3 6 6 10 10 13H16c4-3 7-7 10-13Z" />
      )}
      {kind === 'B' && (
        <path d="M50 10c4 0 7 4 7 8 0 2-1 4-2 5 9 7 16 17 16 26 0 10-9 19-21 19s-21-9-21-19c0-9 7-19 16-26-1-1-2-3-2-5 0-4 3-8 7-8ZM28 72h44c3 8 7 13 12 17H16c5-4 9-9 12-17Z" />
      )}
      {kind === 'Q' && (
        <path d="M18 26a7 7 0 1 1 7 7l4 18h42l4-18a7 7 0 1 1 7-7 7 7 0 0 1-4 6l-8 28H30l-8-28a7 7 0 0 1-4-6Zm32-14a7 7 0 1 1 0 14 7 7 0 0 1 0-14ZM28 62h44v9H28Zm-2 17h48c3 8 7 13 12 17H14c5-4 9-9 12-17Z" />
      )}
      {kind === 'K' && (
        <path d="M45 8h10v10h10v10H55v10h-9V28H36V18h9ZM26 44h48l-6 30H32Zm-2 34h52c3 8 7 13 12 18H12c5-5 9-10 12-18Z" />
      )}
    </svg>
  )
}
