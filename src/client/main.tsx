import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '../../design/tokens.css'
import '../../design/base.css'
import './client.css'
import { rememberedName, useRoom } from './useRoom.ts'
import { Connecting, Lobby, Nav, PokerTable, SandboxTable } from './screens.tsx'
import { HostSheet } from './hostsheet.tsx'
import { Toast } from './components.tsx'

/**
 * suitfold has no server. The host's tab deals; everyone else's tab draws what
 * it is told. A room code in the URL hash means someone was sent a link rather
 * than a code read out loud.
 */
function App() {
  const room = useRoom()
  const [sheet, setSheet] = useState(false)
  const hashCode = location.hash.replace('#', '').toUpperCase().slice(0, 6)

  if (room.stage === 'lobby') {
    return (
      <div className="app">
        <Lobby
          onHost={room.host}
          onJoin={room.join}
          initialName={rememberedName()}
          initialCode={hashCode}
        />
      </div>
    )
  }

  if (room.stage === 'connecting' || !room.view) {
    return (
      <div className="app">
        <Nav view={room.view} isHost={room.isHost} onMenu={() => setSheet(true)} code={room.code} peers={room.peerCount} />
        <Connecting code={room.code} isHost={room.isHost} />
      </div>
    )
  }

  return (
    <div className="app">
      <Nav
        view={room.view}
        isHost={room.isHost}
        onMenu={() => setSheet(true)}
        code={room.code}
        peers={room.peerCount}
      />

      {room.view.mode === 'sandbox' ? (
        <SandboxTable
          view={room.view}
          log={room.log}
          you={room.you}
          isHost={room.isHost}
          missed={room.missed}
          clearMissed={room.clearMissed}
          send={room.send}
        />
      ) : (
        <PokerTable
          view={room.view}
          log={room.log}
          you={room.you}
          isHost={room.isHost}
          missed={room.missed}
          clearMissed={room.clearMissed}
          send={room.send}
          descriptions={room.descriptions}
        />
      )}

      {sheet && <HostSheet room={room} onClose={() => setSheet(false)} />}
      <Toast text={room.reject ? explain(room.reject) : null} />
    </div>
  )
}

/** Rejections are shown in words. A silent refusal is an undebuggable table. */
function explain(reason: string): string {
  return (
    {
      'not-your-turn': "It isn't your turn yet.",
      'not-host': 'Only the person who started the table can do that.',
      'below-min-raise': 'That raise is too small.',
      'action-not-reopened': 'A short all-in does not reopen the betting — you can call or fold.',
      'insufficient-chips': "You don't have that many chips.",
      'restack-mid-hand': 'Re-stack between hands, not during one.',
      'not-enough-players': 'Need at least two people at the table.',
      'hand-in-progress': 'That hand is still going.',
      'zone-not-visible': "You can't move a card you can't see.",
      'card-not-there': 'That card has already moved.',
      'nothing-to-do': 'Nothing to do there.',
      'illegal-move': "That isn't a legal move.",
      'wrong-mode': 'Not available in this game.',
    }[reason] ?? reason
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
