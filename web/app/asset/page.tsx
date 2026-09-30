import type { Metadata } from 'next';
import { lookupAsset } from 'second-opinion/web';
import { CheckList } from '../components/check-list';
import { EvidenceTable } from '../components/evidence-table';
import { SearchForm } from '../components/search-form';
import { VerdictCard } from '../components/verdict-card';

/**
 * One asset, read through the whole engine.
 *
 * The Node runtime is required rather than preferred: the engine reads `config/checks.json` and the recorded
 * answers from disk. The page is never cached, because a verdict is about the data as it is now — a cached ACT
 * is the exact failure this project exists to prevent.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Asset check — Second Opinion' };

type SearchParams = Record<string, string | string[] | undefined>;

/** The query a visitor typed, out of `?q=`. */
function askedFor(params: SearchParams): string {
  const raw = params.q;
  const value = Array.isArray(raw) ? raw[0] : raw;
  return (value ?? '').trim();
}

export default async function AssetPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const query = askedFor(await searchParams);

  if (query === '') {
    return (
      <>
        <p className="lede">Name an asset to check: a symbol such as PAXG, or a numeric CoinMarketCap ID.</p>
        <SearchForm />
      </>
    );
  }

  const result = await lookupAsset(query);

  if (result.status === 'error') {
    return (
      <>
        <SearchForm value={query} />
        <section className="card">
          <div className="verdict">
            <span className="badge tone-stop">No verdict</span>
            <span className="muted">{result.kind === null ? 'the run stopped' : result.kind}</span>
          </div>
          <p className="summary">{result.message}</p>
          {result.fixture === null ? null : (
            <p className="muted">
              Recorded answer behind this: <code>{result.fixture}</code>
            </p>
          )}
        </section>
      </>
    );
  }

  const { view } = result;

  return (
    <>
      <SearchForm value={query} />
      <h2>{view.title}</h2>
      <VerdictCard view={view} modeNote={result.modeNote} />

      {view.raised.length === 0 ? (
        <p className="muted">None of the checks that ran raised an observation.</p>
      ) : (
        <>
          <h2>What was observed</h2>
          <CheckList checks={view.raised} />
        </>
      )}

      <h2>All seven checks</h2>
      <CheckList checks={view.checks} />

      {view.failures.length === 0 ? null : (
        <>
          <h2>Calls that brought nothing back</h2>
          <ul className="checks">
            {view.failures.map((failure) => (
              <li key={`${failure.endpoint}-${failure.kind}`} className="check">
                <div className="check-head">
                  <h3>
                    {failure.endpoint} — {failure.kind}
                  </h3>
                </div>
                <p className="muted">{failure.message}</p>
              </li>
            ))}
          </ul>
        </>
      )}

      <h2>Evidence</h2>
      <EvidenceTable view={view} />

      {view.caveats.length === 0 ? null : (
        <>
          <h2>What this answer does not cover</h2>
          <ul>
            {view.caveats.map((caveat) => (
              <li key={caveat}>{caveat}</li>
            ))}
          </ul>
        </>
      )}

      <h2>This run</h2>
      <table>
        <tbody>
          <tr>
            <th scope="row">Credits charged</th>
            <td className="mono">
              {view.credits.charged} of a {view.credits.budget} budget
              {view.credits.unconfirmed === 0 ? '' : `, ${view.credits.unconfirmed} unconfirmed`}
            </td>
          </tr>
          <tr>
            <th scope="row">Requests</th>
            <td className="mono">{view.credits.requests}</td>
          </tr>
          <tr>
            <th scope="row">Elapsed</th>
            <td className="mono">{view.elapsedMs} ms</td>
          </tr>
          <tr>
            <th scope="row">Wrapper index</th>
            <td>{result.indexNote}</td>
          </tr>
        </tbody>
      </table>
    </>
  );
}
