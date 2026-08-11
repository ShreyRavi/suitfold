export const SEEN_HELP = 'suitfold.helped'

/**
 * The table explains none of itself, on purpose: it is a felt surface with
 * things on it, and it enforces nothing. That is only friendly once you know
 * the four or five gestures, so the first time you sit down, here they are.
 */
export function Help({ onClose }: { onClose: () => void }) {
  return (
    <div className="ask" role="dialog" aria-modal="true" aria-label="How this works">
      <div className="ask-box help-box">
        <h2>How this works</h2>
        <p className="help-lede">
          It is a table with cards on it. Nothing is enforced, nothing takes your turn for you, and
          you can do anything you could do with a real deck.
        </p>

        <div className="help-grid">
          <Bit act="Drag" of="a card to move it. Drop it on another and they become a pile." />
          <Bit act="Drag" of="the number on a pile to move the whole pile at once." />
          <Bit act="Right click" of="a card to turn it face up or face down." />
          <Bit act="Double click" of="a card to see it big enough to read." />
          <Bit act="Hold" of="a card for the pile menu: flip all, shuffle, spread out, take." />
          <Bit act="Drag down" of="to the bottom of the screen to take a card into your hand." />
          <Bit act="Play" of="from your hand and it lands in the space marked in front of you." />
          <Bit act="@name" of="in the log to get somebody's attention." />
        </div>

        <p className="fine">
          Only you can see what is in your hand. A face down card genuinely has no face in anybody
          else's browser, so nobody can peek by looking at the page. Whoever started the table is
          holding the deck, so they need to keep their tab open.
        </p>

        <div className="ask-acts">
          <button className="btn primary" onClick={onClose}>
            Got it
          </button>
        </div>
      </div>
      <button className="ask-scrim" onClick={onClose} aria-label="Close" />
    </div>
  )
}

function Bit({ act, of }: { act: string; of: string }) {
  return (
    <p className="help-bit">
      <b>{act}</b> {of}
    </p>
  )
}
