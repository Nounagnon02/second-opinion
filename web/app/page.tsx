import { CHECK_TITLES } from 'second-opinion';
import { SearchForm } from './components/search-form';

export default function HomePage() {
  return (
    <>
      <p className="lede">
        Second Opinion cross-checks CoinMarketCap data against itself — the aggregated price against the DEX pools
        and the centralised pairs behind it, the timestamps against the answer that carried them, the depth an
        order would meet, a tokenised real-world asset against the other wrappers of the same underlying — scores
        what it finds out of 100 and answers <strong>ACT</strong>, <strong>CAUTION</strong> or{' '}
        <strong>DO_NOT_ACT</strong> with the endpoint answers behind every statement.
      </p>

      <SearchForm />
      <p className="hint">
        Try <a href="/asset?q=PAXG">PAXG</a>, <a href="/asset?q=BTC">BTC</a>, or a numeric CoinMarketCap ID such as{' '}
        <a href="/asset?q=4705">4705</a>.
      </p>

      <h2>The seven checks</h2>
      <ul className="checks">
        {Object.entries(CHECK_TITLES).map(([id, title]) => (
          <li key={id} className="check">
            <div className="check-head">
              <h3>
                {id} — {title}
              </h3>
            </div>
          </li>
        ))}
      </ul>
      <p className="muted">
        A check that cannot run on a given asset is never dropped silently: it is shown with the reason it did not
        run, and the score is renormalised over the checks that did, so a check an asset cannot have never costs it
        a point.
      </p>

      <h2>The API audit</h2>
      <p>
        The same recorded answers feed a second report, on the API itself: what the endpoints returned, which
        documented fields were present, what one call costs and how long it took. Every entry cites the recorded
        answer behind it, and an entry that cites none is not published. <a href="/audit">Read the audit</a>.
      </p>
    </>
  );
}
