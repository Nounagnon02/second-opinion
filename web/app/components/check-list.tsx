import type { CheckView } from 'second-opinion/web';

/** One check: what it found, what it measures, the limits it read, and every number behind it. */
function Check({ check }: { check: CheckView }) {
  return (
    <li className="check">
      <div className="check-head">
        <h3>
          {check.id} — {check.title}
        </h3>
        <span className={`badge tone-${check.tone}`}>
          {check.status === 'evaluated' ? (check.severity ?? 'info') : check.statusLabel}
        </span>
        {check.scored ? (
          <span className="muted">
            {check.points ?? 0} / 100, {check.sharePercent}% of the score
          </span>
        ) : (
          <span className="muted">not counted in the score</span>
        )}
      </div>

      {check.reason === null ? null : <p className="muted">{check.reason}</p>}

      {check.findings.map((finding) => (
        <div key={finding.code} className={`finding tone-${finding.tone}`}>
          <strong>
            {finding.severity} · {finding.code}
          </strong>
          <p>{finding.message}</p>
        </div>
      ))}

      <details>
        <summary>What this check measures, and the limits it read</summary>
        <p>{check.what}</p>
        <p>{check.why}</p>
        <p className="muted">
          Endpoints: {check.endpoints.length === 0 ? 'none' : check.endpoints.join(', ')}
        </p>
        <p className="muted">
          Configured limits:{' '}
          {check.thresholds.length === 0 ? 'none — this check reads no numeric threshold' : check.thresholds.join('; ')}
        </p>
        {check.caveat === null ? null : <p className="muted">Caveat: {check.caveat}</p>}
        {check.measurements.length === 0 ? null : (
          <table>
            <thead>
              <tr>
                <th scope="col">Measured</th>
                <th scope="col">Value</th>
                <th scope="col">Limit</th>
              </tr>
            </thead>
            <tbody>
              {check.measurements.map((measurement, index) => (
                <tr key={`${measurement.label}-${String(index)}`}>
                  <td>{measurement.label}</td>
                  <td className="mono">{measurement.value}</td>
                  <td className="mono">{measurement.threshold ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </details>
    </li>
  );
}

/** The seven checks, in the order the engine runs them. A check that did not run is shown with its reason (D9). */
export function CheckList({ checks }: { checks: CheckView[] }) {
  return (
    <ul className="checks">
      {checks.map((check) => (
        <Check key={check.id} check={check} />
      ))}
    </ul>
  );
}
