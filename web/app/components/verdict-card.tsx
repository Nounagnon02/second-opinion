import type { AssetView } from 'second-opinion/web';

/** The verdict, the score and the one sentence that says what the two rest on. */
export function VerdictCard({ view, modeNote }: { view: AssetView; modeNote: string }) {
  return (
    <section className="card">
      <div className="verdict">
        <span className={`badge lg tone-${view.tone}`}>{view.verdict}</span>
        <span className="score">{view.scoreLabel}</span>
        <span className="muted">{view.coverage}</span>
      </div>
      <p className="summary">{view.summary}</p>
      <p className="muted">
        {view.verdict} means: {view.verdictLabel}.
      </p>
      <p className="muted">{modeNote}</p>
    </section>
  );
}
