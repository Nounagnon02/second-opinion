import type { AssetView } from 'second-opinion/web';

/** Every answer the verdict was read from, once each: the proof behind the page. */
export function EvidenceTable({ view }: { view: AssetView }) {
  if (view.evidence.length === 0) {
    return <p className="muted">No endpoint answered this run, so there is no evidence to show.</p>;
  }
  return (
    <>
      <table>
        <thead>
          <tr>
            <th scope="col">Endpoint</th>
            <th scope="col">Path</th>
            <th scope="col">Observed at</th>
            <th scope="col">Answer</th>
          </tr>
        </thead>
        <tbody>
          {view.evidence.map((source) => (
            <tr key={`${source.endpoint}-${source.observedAt}-${source.fixture ?? 'live'}`}>
              <td>{source.endpoint}</td>
              <td className="mono">{source.path}</td>
              <td className="mono">{source.observedAt}</td>
              <td className="mono evidence-file">{source.fixture ?? 'live call'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted">
        {view.recordedCount} of {view.evidence.length} answers were replayed from a recorded file in{' '}
        <code>fixtures/</code>, with the API key masked at recording time.
      </p>
    </>
  );
}
