/**
 * What the calibration tests read: the live run of T4.1, replayed offline.
 *
 * `fixtures/calibration/` holds every answer of that run — the E03 panel and the whole call plan of each asset on
 * it — so the panel can be assessed again without a network and without a key. The token to real-world-asset index
 * C5 needs is rebuilt from the recorded E18 / E19 walk in `fixtures/rwa-index/` rather than read from `.cache/`,
 * which a clean clone does not have.
 *
 * Both are built once per test file: replaying fifty assets means parsing every fixture of the repository, and
 * nothing in these tests changes between cases.
 */
import { join } from 'node:path';
import { runCalibration, type CalibrationRun } from '../../src/calibration/run.js';
import { DEFAULT_FIXTURE_DIR } from '../../src/cmc/config.js';
import { replayClient, replayIndex } from './rwa-index.js';

// The index and the replay client moved to `rwa-index.ts` when the demonstration and the submission tests turned
// out to need them too (T9.1); they are re-exported so that the calibration tests keep one import.
export { replayClient, replayIndex, RWA_INDEX_FIXTURES } from './rwa-index.js';

/**
 * Where the answers of the live calibration run behind `docs/CALIBRATION.md` are recorded.
 *
 * One dated directory per live run, because a replay has to answer from that run alone. Two earlier attempts at the
 * same panel stopped part way and left their answers under `fixtures/calibration/` — loose at its root, and in
 * `live-2026-09-26/`; mixing any of them in would let a call this run lost to a timeout be answered by an older
 * recording, and the replay would then measure something the live run never measured.
 */
export const CALIBRATION_FIXTURES = join(DEFAULT_FIXTURE_DIR, 'calibration', 'live-20260926T1044Z');

let replayed: Promise<CalibrationRun> | null = null;

/**
 * The recorded panel, assessed again from the fixtures alone.
 *
 * Only the size the live run recorded can be replayed: a panel of another size is another E03 request, and no
 * fixture answers it. The verdicts, scores and check statuses here are the ones the live run produced; the credits,
 * the wall clock and the account-wide counters are not, and no test reads them from here.
 */
export function replayedRun(): Promise<CalibrationRun> {
  replayed ??= replayIndex().then(async (wrapperIndex) =>
    runCalibration(replayClient(CALIBRATION_FIXTURES), { wrapperIndex }),
  );
  return replayed;
}
