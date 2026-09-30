import type { Metadata } from 'next';
import { KIND_NOTE, loadAuditView, readWebSettings, type AuditView } from 'second-opinion/web';

/**
 * The published audit of the API (specification F9).
 *
 * It reads `docs/api_audit.json` and reshapes it; it measures nothing. The report on disk is the one the second
 * read of T6.2 went through, claim by claim, against the recorded answer each cites — recomputing anything here
 * would put something on the page that read has never seen.
 *
 * Read at request time rather than prerendered, for the same reason `next.config.ts` traces the report into the
 * deployment by name: which file is read is a setting of the deployment (`SECOND_OPINION_AUDIT_FILE`), and a
 * page rendered at build time would freeze the build's environment and leave that tracing with no reader (D15).
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'API audit — Second Opinion' };

/** `9 observed, 14 signals, 1 suggestion.` — one sentence, so no word is split across text nodes. */
function countsLine(view: AuditView): string {
  const plural = (count: number, word: string): string => `${String(count)} ${word}${count === 1 ? '' : 's'}`;
  return [
    `${String(view.counts.observed)} observed`,
    plural(view.counts.signal, 'signal'),
    `${plural(view.counts.suggestion, 'suggestion')}.`,
  ].join(', ');
}

/** What the report left out, and why. */
function withheldLine(view: AuditView): string {
  const entries = (count: number): string => `${String(count)} entr${count === 1 ? 'y' : 'ies'}`;
  return (
    `${entries(view.withheld)} cited no recorded answer and ${entries(view.unproven)} cited one that did not ` +
    'show what was stated; neither is printed here.'
  );
}

export default function AuditPage() {
  const settings = readWebSettings();
  const view = loadAuditView(settings.auditFile);

  if (view === null) {
    return (
      <>
        <h2>API audit</h2>
        <p className="lede">
          No report has been generated in this deployment. Run <code>npm run audit -- --write</code>, which reads
          the recorded answers in <code>fixtures/</code> and sends no request.
        </p>
      </>
    );
  }

  return (
    <>
      <h2>API audit</h2>
      <p className="lede">
        What the recorded CoinMarketCap answers in this repository contain, measured without sending a single
        request. Every entry below cites the recorded answer behind it; an entry that cites none is not published.
      </p>
      <p className="muted">Generated {view.generatedAt}.</p>

      <ul className="stats">
        {view.stats.map((stat) => (
          <li key={stat.label} className="stat">
            <span className="value">{stat.value}</span>
            <strong>{stat.label}</strong>
            <p className="muted">{stat.note}</p>
          </li>
        ))}
      </ul>

      <p className="muted">
        {countsLine(view)} {withheldLine(view)} {view.reviewNote}
      </p>

      <h2>Entries</h2>
      <ul className="checks">
        {view.findings.map((finding) => (
          <li key={finding.id} className="check">
            <div className="check-head">
              <h3>
                {finding.id} — {finding.title}
              </h3>
              <span className="badge tone-idle" title={KIND_NOTE[finding.kind]}>
                {finding.kindLabel}
              </span>
              {finding.endpoints.length === 0 ? null : (
                <span className="muted">{finding.endpoints.join(', ')}</span>
              )}
            </div>
            <p>{finding.statement}</p>
            {finding.measurement === null ? null : <p className="mono">{finding.measurement}</p>}
            <details>
              <summary>
                Evidence — {finding.evidence.length} recorded answer{finding.evidence.length === 1 ? '' : 's'}
              </summary>
              <table>
                <thead>
                  <tr>
                    <th scope="col">File</th>
                    <th scope="col">Field</th>
                    <th scope="col">What it shows</th>
                  </tr>
                </thead>
                <tbody>
                  {finding.evidence.map((source) => (
                    <tr key={`${source.file}-${source.field ?? ''}`}>
                      <td className="mono evidence-file">{source.file}</td>
                      <td className="mono">{source.field ?? '—'}</td>
                      <td>{source.shows}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          </li>
        ))}
      </ul>

      <h2>How to read the three kinds</h2>
      <table>
        <tbody>
          <tr>
            <th scope="row">Observed</th>
            <td>{KIND_NOTE.observed}</td>
          </tr>
          <tr>
            <th scope="row">Signal</th>
            <td>{KIND_NOTE.signal}</td>
          </tr>
          <tr>
            <th scope="row">Suggestion</th>
            <td>{KIND_NOTE.suggestion}</td>
          </tr>
        </tbody>
      </table>
    </>
  );
}
