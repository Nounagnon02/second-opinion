/**
 * What the price checks share: how a price is named in an output, how a number is written in a sentence, and how
 * the prices of one answer are narrowed to the asset a run is about.
 *
 * One answer often carries several assets (E02 returned BTC and PAXG in one call) and each source names an asset
 * differently: E02 gives a CMC identifier and a symbol, E08 and E09 give those of the base asset of a pair, and E10
 * gives neither, only the contract it was queried with (T1.2). `isAboutAsset` reads whichever of those the answer
 * carried, most identifying first, so that a check never compares two assets.
 */
import type { PriceKind, PriceObservation } from '../normalize/model.js';

/** How each kind of price is named in a sentence. */
export const PRICE_KIND_LABEL: Record<PriceKind, string> = {
  aggregate: 'aggregated price',
  conversion: 'converted price',
  dex_token: 'DEX token price',
  dex_pair: 'DEX pair price',
  rwa_wrapper: 'wrapper price',
};

/**
 * How an answer names the asset of an observation, most identifying first: its symbol, else the pair it was read
 * as, else the contract it was read at. `null` when the answer names none of the three, which an output then leaves
 * unsaid rather than filling in from another source.
 */
export function observationName(observation: PriceObservation): string | null {
  return observation.asset.symbol ?? observation.venue?.pair ?? observation.venue?.address ?? null;
}

/** Names an observation the way the outputs do: the endpoint, the kind of price, and the asset when it is named. */
export function priceLabel(observation: PriceObservation): string {
  const name = observationName(observation);
  const kind = PRICE_KIND_LABEL[observation.kind];
  return name === null
    ? `${observation.source.endpoint} ${kind}`
    : `${observation.source.endpoint} ${kind} of ${name}`;
}

/**
 * How a caller names the asset a run is about. Every part is optional, because the caller knows only what the user
 * typed and what the resolution returned; the parts it does know are matched against whatever the answer carried.
 */
export interface AssetSelector {
  cmcId?: number | null;
  symbol?: string | null;
  /** The token contract the DEX calls were made with; E10 names the asset by nothing else (D3). */
  contract?: string | null;
}

/** Two names of the same thing, compared the way the API writes them: case and surrounding spaces do not count. */
function sameText(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

/**
 * Whether an observation is about the selected asset. The identifier decides when both sides carry one, then the
 * symbol, then the contract the venue was read at. An observation naming nothing the selector also names is left
 * out: an unmatched price is never assumed to belong to the asset.
 */
export function isAboutAsset(observation: PriceObservation, selector: AssetSelector): boolean {
  const { cmcId, symbol } = observation.asset;
  if (cmcId !== null && selector.cmcId !== null && selector.cmcId !== undefined) return cmcId === selector.cmcId;
  if (symbol !== null && selector.symbol) return sameText(symbol, selector.symbol);
  const address = observation.venue?.address ?? null;
  if (address !== null && selector.contract) return sameText(address, selector.contract);
  return false;
}

/** The observations of one or several answers that are about the selected asset, in the order they were read. */
export function pricesOfAsset(
  observations: readonly PriceObservation[],
  selector: AssetSelector,
): PriceObservation[] {
  return observations.filter((observation) => isAboutAsset(observation, selector));
}

/**
 * A USD amount with enough significant digits to tell two prices apart, and no trailing zeros. Eight digits is what
 * the recorded answers need to show a gap: E02 PAXG 4253.2261 against E10 4264.1538 (observation 10).
 */
export function formatUsd(value: number): string {
  if (!Number.isFinite(value)) return 'an unreadable amount';
  if (value === 0) return '0 USD';
  return `${Number.parseFloat(value.toPrecision(8))} USD`;
}

/** A percentage as a report writes it: two decimals, or two significant digits when the value is smaller than that. */
export function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return 'an unreadable share';
  const rounded = Math.abs(value) < 0.01 && value !== 0 ? value.toPrecision(2) : value.toFixed(2);
  return `${Number.parseFloat(rounded)} %`;
}
