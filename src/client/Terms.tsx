export const SEEN_TERMS = 'suitfold.terms'

/**
 * The terms, shown once and then kept in the footer.
 *
 * This is a deck of cards and a table to put them on. It settles nothing, it
 * scores nothing, and the chips are a number on a screen that has never been
 * connected to money. What anybody does around it is theirs, and this says so
 * plainly and in writing, because "a card table" and "a place to gamble" are
 * the same object and only the people at it decide which.
 */
export function Terms({ onAgree }: { onAgree: () => void }) {
  return (
    <div className="ask" role="dialog" aria-modal="true" aria-label="Before you play">
      <div className="ask-box terms-box">
        <h2>Before you play</h2>

        <div className="terms-body">
          <p>
            suitfold is a private, personal project provided free of charge, as-is and with no
            warranty of any kind, express or implied, including without limitation any warranty of
            merchantability or fitness for a particular purpose.
          </p>

          <p>
            <b>No money is involved.</b> The software handles no payments, holds no funds and
            processes no transactions. Chips shown in any game are arbitrary counters with no
            monetary value, no redeemable value, and no connection to any payment system.
          </p>

          <p>
            <b>You are responsible for how you use it.</b> By continuing you confirm that you will
            use this software only for lawful purposes and in compliance with all laws that apply to
            you. Gambling and gaming laws differ by country, state and territory, and operating or
            taking part in unlicensed gambling is a criminal offence in many places. Determining
            what is lawful where you are is your responsibility, not the author's.
          </p>

          <p>
            <b>No liability is accepted.</b> To the fullest extent permitted by law, the author
            accepts no liability for any loss, damage, claim or legal consequence arising from use
            or misuse of this software, including any use for wagering, betting or gambling, whether
            regulated, unregulated or unlawful. You use it entirely at your own risk.
          </p>

          <p>
            This software is not a gambling service, is not licensed as one, and is not offered to
            the public. Nothing here constitutes legal advice.
          </p>
        </div>

        <div className="ask-acts">
          <button className="btn primary" onClick={onAgree}>
            I understand
          </button>
        </div>
      </div>
    </div>
  )
}

/** The short version, kept where it can always be found. */
export function Small({ onOpen }: { onOpen: () => void }) {
  return (
    <p className="small-print">
      Provided as-is, with no warranty and no liability accepted. No real money, no payments, no
      stakes of any kind. Use it lawfully; gambling law is your responsibility.{' '}
      <button className="linkish" onClick={onOpen}>
        Terms
      </button>
    </p>
  )
}
