import { useMemo, useState } from 'react'
import type { CardView, RoomView, SeatView, ZoneView } from '../core/project.ts'
import type { LogEntry } from '../core/narrate.ts'

const PIP: Record<string, string> = { S: '♠', H: '♥', D: '♦', C: '♣' }
const isRed = (id: string) => id[1] === 'H' || id[1] === 'D'
export const chips = (n: number) => n.toLocaleString()

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

export function Card({
  card,
  size = 'sm',
  selected,
  onClick,
}: {
  card: CardView
  size?: 'sm' | 'md' | 'lg'
  selected?: boolean
  onClick?: () => void
}) {
  const cls = [
    'card',
    size === 'md' ? 'card--md' : size === 'lg' ? 'card--lg' : '',
    card.id ? (isRed(card.id) ? 'is-red' : '') : 'card--face-down',
    selected ? 'card--selected' : '',
  ]
    .filter(Boolean)
    .join(' ')

  const label = card.id ? `${card.id[0]} of ${suitName(card.id[1]!)}` : 'face down card'
  const Tag = onClick ? 'button' : 'div'

  return (
    <Tag className={cls} onClick={onClick} aria-label={label} type={onClick ? 'button' : undefined}>
      {card.id && (
        <>
          <span className="card-rank">{card.id[0] === 'T' ? '10' : card.id[0]}</span>
          <span className="card-pip">{PIP[card.id[1]!]}</span>
          {size === 'lg' && <span className="card-pip--big">{PIP[card.id[1]!]}</span>}
        </>
      )}
    </Tag>
  )
}

const suitName = (s: string) => ({ S: 'spades', H: 'hearts', D: 'diamonds', C: 'clubs' })[s] ?? s

/** "2 selected" reads as two things. "2♣" reads as a card. */
export const cardLabel = (id: string) => `${id[0] === 'T' ? '10' : id[0]}${PIP[id[1]!] ?? ''}`

// ---------------------------------------------------------------------------
// Seat
// ---------------------------------------------------------------------------

export function Seat({
  seat,
  view,
  showChips,
}: {
  seat: SeatView
  view: RoomView
  showChips: boolean
}) {
  // Poker state is only meaningful in poker. Reading it in sandbox leaks the
  // last hand's bets onto a table that has no betting.
  const poker = view.mode === 'poker'
  const p = view.poker
  const folded = poker && p.folded.includes(seat.id)
  const allIn = poker && p.allIn.includes(seat.id)
  const bet = poker ? (p.street[seat.id] ?? 0) : 0
  const inHand = seat.cardCount > 0
  const busted = poker && showChips && seat.stack === 0 && !allIn && !inHand && view.open

  const cls = [
    'seat',
    seat.isTurn && poker ? 'seat--to-act' : '',
    folded ? 'seat--folded' : '',
    allIn && !folded ? 'seat--allin' : '',
    seat.away ? 'seat--out' : '',
    busted ? 'seat--busted' : '',
  ]
    .filter(Boolean)
    .join(' ')

  // Every state carries a WORD, never a treatment alone. One line, so a long
  // name and a long state cannot fight over the same row.
  const state = seat.away
    ? { text: 'stood up', cls: 'is-out' }
    : folded
      ? { text: 'folded', cls: '' }
      : allIn
        ? { text: `all-in ${chips(bet)}`, cls: 'is-allin' }
        : seat.isTurn && poker
          ? { text: 'to act', cls: 'is-turn' }
          : bet > 0
            ? { text: `bet ${chips(bet)}`, cls: 'is-turn' }
            : busted
              ? { text: 'busted', cls: 'is-out' }
              : inHand
                ? { text: `${seat.cardCount} cards`, cls: '' }
                : // Nobody is "offline" before they have joined for the first
                  // time; that reads as an error when it is just an empty seat.
                  seat.connected
                  ? { text: 'ready', cls: '' }
                  : { text: 'not here yet', cls: '' }

  return (
    <div className={cls}>
      <div className="seat-head">
        <span className="seat-name">
          <span className="n">{seat.name}</span>
          {seat.isButton && (
            <span className="seat-button" title="dealer button">
              D
            </span>
          )}
        </span>
        <span className="seat-metric">{showChips ? chips(seat.stack) : `${seat.cardCount}`}</span>
      </div>
      <div className={`seat-state ${state.cls}`}>{state.text}</div>
    </div>
  )
}

export function ChipStack({ amount, wide }: { amount: number; wide?: boolean }) {
  // Bars, not discs: readable at 17px and it scales without a new asset.
  const bars = useMemo(() => {
    const out: string[] = []
    let left = amount
    for (const [size, cls] of [
      [1000, 'chip--high'],
      [100, ''],
      [1, 'chip--pale'],
    ] as const) {
      const n = Math.min(3, Math.floor(left / size))
      for (let i = 0; i < n; i++) out.push(cls)
      left -= n * size
    }
    return out.slice(0, 5)
  }, [amount])

  return (
    <div className="chips" aria-hidden="true">
      {bars.map((c, i) => (
        <i key={i} className={`chip ${c}`} style={wide ? { width: 24, height: 6 } : undefined} />
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Pot and side pots
// ---------------------------------------------------------------------------

export function Pot({ view }: { view: RoomView }) {
  const p = view.poker
  const name = (id: string) => view.seats.find((s) => s.id === id)?.name ?? id
  const total = p.potTotal

  return (
    <div className="pot">
      <div className="pot-main">POT</div>
      <div className="pot-amount">{chips(total)}</div>
      {p.pots.length > 1 && (
        <div className="pot-side">
          {p.pots.map((pot, i) => (
            <div className="pot-side-row" key={i}>
              <b>{i === 0 ? 'main' : `side ${i}`} {chips(pot.amount)}</b>{' '}
              <span>· {pot.eligible.map(name).join(', ')} only</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Zones
// ---------------------------------------------------------------------------

export function Zone({
  zone,
  onCard,
  onZone,
  onMenu,
  selected,
  target,
}: {
  zone: ZoneView
  onCard?: (cardIndex: number) => void
  onZone?: () => void
  onMenu?: () => void
  selected?: number | null
  target?: boolean
}) {
  const top = zone.cards[zone.cards.length - 1]
  const empty = zone.cards.length === 0

  return (
    <div className={`zone ${target ? 'zone--target' : ''} ${empty ? 'zone--empty' : ''}`}>
      {zone.layout === 'stack' ? (
        <div className="zone-slot" onClick={onZone} role={onZone ? 'button' : undefined}>
          {!empty && (
            <div className="stack">
              <i />
              <i />
              {top && <Card card={top} size="lg" />}
            </div>
          )}
        </div>
      ) : (
        <div className="zone-cards" onClick={onZone} role={onZone ? 'button' : undefined}>
          {empty ? <div className="zone-slot" /> : null}
          {zone.cards.slice(-6).map((c, i) => (
            <Card
              key={`${c.id ?? 'x'}${i}`}
              card={c}
              size="md"
              selected={selected === i}
              onClick={onCard ? () => onCard(i) : undefined}
            />
          ))}
        </div>
      )}
      <button className="zone-head zone-label" onClick={onMenu} type="button">
        {target ? 'MOVE HERE' : `${zone.label.toUpperCase()} · ${zone.count}`}
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Hand
// ---------------------------------------------------------------------------

export function Hand({
  cards,
  selected,
  onSelect,
}: {
  cards: CardView[]
  selected: number | null
  onSelect?: (i: number) => void
}) {
  // The fan overlaps left-over-right so every card's top-left corner stays
  // exposed. Long hands widen the overlap rather than shrinking the card,
  // because the small size was designed first.
  const overlap = cards.length > 9 ? -22 : cards.length > 6 ? -16 : -12

  return (
    <div className="hand">
      <div className="hand-inner" style={{ ['--hand-overlap' as string]: `${overlap}px` }}>
        {cards.map((c, i) => (
          <Card
            key={`${c.id ?? 'x'}${i}`}
            card={c}
            size="md"
            selected={selected === i}
            onClick={onSelect ? () => onSelect(i) : undefined}
          />
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Raise control — presets and a stepper, never a slider
// ---------------------------------------------------------------------------

export function RaiseControl({
  view,
  value,
  onChange,
}: {
  view: RoomView
  value: number
  onChange: (v: number) => void
}) {
  const p = view.poker
  const you = view.seats.find((s) => s.isYou)
  const stack = you?.stack ?? 0
  const committed = p.street[you?.id ?? ''] ?? 0
  const min = Math.min(p.minRaiseTo, p.maxRaiseTo)
  const max = p.maxRaiseTo
  const pot = p.potTotal
  const step = Math.max(view.settings.bigBlind, 1)

  const presets: { label: string; to: number }[] = [
    { label: 'MIN', to: min },
    { label: '½ POT', to: Math.min(max, Math.max(min, p.currentBet + Math.round(pot / 2))) },
    { label: 'POT', to: Math.min(max, Math.max(min, p.currentBet + pot)) },
    { label: 'ALL-IN', to: max },
  ]

  const clamp = (v: number) => Math.max(min, Math.min(max, v))

  return (
    <div className="raise">
      <div className="raise-read">
        <div>
          <div className="rail-label">{p.legal.includes('bet') ? 'BET' : 'RAISE TO'}</div>
          <div className="raise-to">{chips(value)}</div>
        </div>
        <div className="raise-after">
          costs {chips(value - committed)} · leaves {chips(committed + stack - value)}
        </div>
      </div>
      <div className="raise-presets">
        {presets.map((preset) => (
          <button
            key={preset.label}
            type="button"
            aria-pressed={value === preset.to}
            disabled={preset.to < min || preset.to > max}
            onClick={() => onChange(clamp(preset.to))}
          >
            {preset.label}
          </button>
        ))}
      </div>
      <div className="raise-step">
        <button type="button" onClick={() => onChange(clamp(value - step))} aria-label="less">
          −{chips(step)}
        </button>
        <button type="button" onClick={() => onChange(clamp(value + step))} aria-label="more">
          +{chips(step)}
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Action log
// ---------------------------------------------------------------------------

export function ActionLog({ log, you }: { log: LogEntry[]; you: string | null }) {
  // Newest first. The log lives in a short scroll box, so rendering oldest-first
  // shows the TOP of a list that grows downward — which means the line you most
  // need on re-entry is the one you cannot see.
  const recent = log.slice(-30).reverse()
  return (
    <div className="log">
      {recent.map((e, i) => (
        <div
          key={`${e.seq}-${i}`}
          className={[
            'log-entry',
            e.seatId && e.seatId === you ? 'is-you' : '',
            e.kind === 'award' ? 'is-award' : '',
            e.kind === 'street' ? 'is-street' : '',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          {e.text}
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Re-entry: what happened while you were away
// ---------------------------------------------------------------------------

export function AwayNote({ entries, onDismiss }: { entries: LogEntry[]; onDismiss: () => void }) {
  if (entries.length === 0) return null
  return (
    <div className="away-note" role="status">
      <div className="away-note-body">
        <div className="k">WHILE YOU WERE AWAY</div>
        <ul>
          {entries.slice(-5).map((e, i) => (
            <li key={i}>{e.text}</li>
          ))}
        </ul>
      </div>
      <button type="button" onClick={onDismiss} aria-label="dismiss">
        ×
      </button>
    </div>
  )
}

export function TurnIndicator({ text }: { text: string }) {
  return (
    <div className="turn-indicator">
      <i aria-hidden="true" />
      {text}
    </div>
  )
}

export function Toast({ text }: { text: string | null }) {
  if (!text) return null
  return <div className="toast">{text}</div>
}

export function useSelection<T>() {
  return useState<T | null>(null)
}
