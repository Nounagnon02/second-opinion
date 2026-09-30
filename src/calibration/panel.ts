/**
 * The calibration panel (specification F5): the first assets by market capitalisation, read from E03 in one call.
 *
 * The specification names them "the 50 first cryptocurrencies by capitalisation (assets reputed reliable)", so the
 * panel is whatever E03 ranks first at the moment it is read — never a list written down here. `rank` is the
 * position in that answer, so a report can say which asset sat where without claiming a ranking of its own.
 *
 * An item E03 returns without a CMC identifier cannot be assessed: the later calls are all made on that identifier
 * (D3). Those are counted and named rather than dropped quietly, so the panel size in the report is the number of
 * assets actually measured.
 */
import type { CmcClient } from '../cmc/client.js';
import { CmcError } from '../cmc/errors.js';
import { normalizeListings } from '../normalize/aggregated.js';
import type { SourceRef } from '../normalize/model.js';

/** The panel size the specification states. */
export const DEFAULT_PANEL_SIZE = 50;

/** E03 charges 1 credit per 250 assets (docs/ENDPOINTS.md), so a panel of 250 is still a single credit. */
export const MAX_PANEL_SIZE = 250;

/** One asset of the panel, as E03 ranked and named it. */
export interface PanelMember {
  /** Position in the E03 answer, 1 for the first item. */
  rank: number;
  cmcId: number;
  symbol: string | null;
  name: string | null;
  /** `quote[USD].market_cap` as E03 reported it; `null` when the answer left it unreadable. */
  marketCapUsd: number | null;
}

/** What one E03 answer gave: the assets to assess, and the items it could not name one for. */
export interface CalibrationPanel {
  source: SourceRef;
  /** How many assets were asked for, so a short answer is visible as a short answer. */
  requested: number;
  members: PanelMember[];
  /** Ranks of the items E03 returned without a readable CMC ID: never assessed, always reported. */
  withoutId: number[];
}

/**
 * Reads the first `size` assets by market capitalisation from E03.
 *
 * Throws a `config` error for a size outside 1 to `MAX_PANEL_SIZE`, and lets the client's own errors through: a
 * panel that could not be read is not a panel, and the run that needed it has nothing to measure.
 */
export async function readPanel(client: CmcClient, size = DEFAULT_PANEL_SIZE): Promise<CalibrationPanel> {
  if (!Number.isInteger(size) || size < 1 || size > MAX_PANEL_SIZE) {
    throw new CmcError('config', `The panel size must be an integer between 1 and ${MAX_PANEL_SIZE}, got ${size}.`);
  }
  const listed = normalizeListings(await client.get('E03', { start: 1, limit: size, convert: 'USD' }));

  const members: PanelMember[] = [];
  const withoutId: number[] = [];
  listed.items.forEach((item, at) => {
    const rank = at + 1;
    if (item.asset.cmcId === null) {
      withoutId.push(rank);
      return;
    }
    members.push({
      rank,
      cmcId: item.asset.cmcId,
      symbol: item.asset.symbol,
      name: item.asset.name,
      marketCapUsd: item.marketCapUsd,
    });
  });

  if (members.length === 0) {
    throw new CmcError('invalid_response', `E03 named no asset with a CMC ID, so there is no panel to assess.`, {
      endpoint: 'E03',
    });
  }
  return { source: listed.source, requested: size, members, withoutId };
}

/** `BTC` when E03 gave a symbol, `CMC 1` otherwise: how a report names one member. */
export function describeMember(member: PanelMember): string {
  return member.symbol ?? `CMC ${String(member.cmcId)}`;
}
