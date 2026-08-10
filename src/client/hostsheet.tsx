import { useState } from 'react'
import type { Room } from './useRoom.ts'
import { chips } from './components.tsx'

/**
 * Everything the host can do, on the host's phone. There is no terminal and no
 * admin panel — the person dealing is also playing.
 *
 * Non-hosts get the same sheet with the settings hidden, because they still
 * need the room code and a way to leave.
 */
export function HostSheet({ room, onClose }: { room: Room; onClose: () => void }) {
  const view = room.view
  const s = view?.settings
  const [copied, setCopied] = useState(false)
  const handLive = view ? view.poker.phase !== 'complete' && view.poker.phase !== 'idle' : false

  const shareLink = `${location.origin}${location.pathname}#${room.code}`

  const share = async () => {
    try {
      if (navigator.share) await navigator.share({ title: 'suitfold', url: shareLink })
      else await navigator.clipboard.writeText(shareLink)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* the user dismissed the share sheet */
    }
  }

  return (
    <div className="sheet">
      <div className="sheet-head">
        <h2>{room.isHost ? 'Your table' : 'This table'}</h2>
        <button className="btn" type="button" style={{ minHeight: 38, padding: '0 14px' }} onClick={onClose}>
          Done
        </button>
      </div>

      <div className="sheet-body">
        <div className="field">
          <label>ROOM CODE</label>
          <div className="code-big">{room.code}</div>
          <button className="btn" type="button" onClick={share}>
            {copied ? 'Link copied' : 'Send the link'}
          </button>
          <div className="ledger-sub">
            {room.peerCount + 1} here. Anyone with the code can sit down, so use a fresh table if you
            want a fresh crowd.
          </div>
        </div>

        {room.isHost && s && view && (
          <>
            <div className="field">
              <label>GAME</label>
              <select
                value={s.mode}
                onChange={(e) => room.changeSettings({ mode: e.target.value as 'poker' | 'sandbox' })}
                disabled={handLive}
              >
                <option value="poker">Poker — the app deals and enforces</option>
                <option value="sandbox">Sandbox — freeform, any card game</option>
              </select>
              {s.mode === 'sandbox' && (
                <select
                  value={s.layout}
                  onChange={(e) => room.changeSettings({ layout: e.target.value as never })}
                >
                  <option value="deck-only">Just a deck and a discard</option>
                  <option value="deal-5">Deal 5 each</option>
                  <option value="deal-7">Deal 7 each</option>
                  <option value="deal-13">Deal 13 each</option>
                  <option value="trick">Trick game — hands and a trick pile</option>
                  <option value="everything">Everything — deck, discard, board, trick</option>
                </select>
              )}
              {handLive && <div className="ledger-sub">Finish the hand before switching games.</div>}
            </div>

            {s.mode === 'poker' && (
              <div className="field">
                <label>BLINDS AND STACK</label>
                <div style={{ display: 'flex', gap: 'var(--s-4)' }}>
                  <input
                    type="number"
                    inputMode="numeric"
                    value={s.smallBlind}
                    onChange={(e) => room.changeSettings({ smallBlind: Number(e.target.value) })}
                    aria-label="small blind"
                  />
                  <input
                    type="number"
                    inputMode="numeric"
                    value={s.bigBlind}
                    onChange={(e) => room.changeSettings({ bigBlind: Number(e.target.value) })}
                    aria-label="big blind"
                  />
                  <input
                    type="number"
                    inputMode="numeric"
                    value={s.startingStack}
                    onChange={(e) => room.changeSettings({ startingStack: Number(e.target.value) })}
                    aria-label="starting stack"
                  />
                </div>
                <div className="ledger-sub">small blind · big blind · starting stack</div>
              </div>
            )}

            <div className="field">
              <label>TABLE</label>
              <Toggle
                label="Reveal mucked hands at showdown"
                on={s.muckedReveal}
                onChange={(v) => room.changeSettings({ muckedReveal: v })}
              />
              <Toggle
                label="Chips on the table"
                on={s.counters}
                onChange={(v) => room.changeSettings({ counters: v })}
              />
            </div>

            <div className="field">
              <label>DEAL</label>
              <div className="host-actions">
                <button className="btn btn--primary" type="button" onClick={room.deal}>
                  {view.open
                    ? s.mode === 'poker'
                      ? 'Deal the next hand now'
                      : 'Reshuffle and redeal'
                    : `Start playing — everyone gets ${chips(s.startingStack)}`}
                </button>
              </div>
            </div>
          </>
        )}

        {view && room.deckCommitment && (
          <div className="field">
            <label>THIS DEAL</label>
            <div className="commitment">{room.deckCommitment}</div>
            <div className="ledger-sub">
              The person dealing shuffles, so they can see the deck — same as whoever shuffles at a
              kitchen table. This is a fingerprint of that shuffle, sent out before the hand. It
              cannot be changed once the cards are out.
            </div>
          </div>
        )}

        <div className="field">
          <button className="btn danger" type="button" onClick={room.leave}>
            {room.isHost ? 'End the table' : 'Leave the table'}
          </button>
          {room.isHost && (
            <div className="ledger-sub">
              Closing this tab ends the game for everyone. Nothing is saved — it is just a game.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function Toggle({ label, on, onChange }: { label: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="toggle">
      <span>{label}</span>
      <button type="button" aria-pressed={on} aria-label={label} onClick={() => onChange(!on)}>
        <i />
      </button>
    </div>
  )
}
