import { describe, expect, it } from 'vitest';
import {
  fieldPattern,
  rwaQuoteInput,
  runSchemaCheck,
  schemaInput,
  schemaIssues,
  severityOfField,
  type SchemaInput,
} from '../src/checks/c7-schema.js';
import { loadChecksConfig } from '../src/checks/config.js';
import { priceObservations } from '../src/normalize/index.js';
import { normalizeDexPools } from '../src/normalize/dex.js';
import { normalizeRwaQuotes } from '../src/normalize/rwa.js';
import { damaged, recordedSource } from './helpers/normalize.js';

const { C7 } = loadChecksConfig();

type Quote = { quote: { price: number | null; last_updated: string; market_cap: number | string }[] };

/** An E02 answer with one field of its first item replaced, read as the checks read it. */
function brokenQuotes(edit: (item: Quote) => void): SchemaInput {
  const source = damaged('E02', 'E02-quotes-latest-btc-paxg', (data) => {
    edit((data as Quote[])[0]!);
  });
  return schemaInput(priceObservations(source));
}

describe('what C7 reads', () => {
  it('collects the problems of the container and of every item of an answer', () => {
    const pools = schemaInput(normalizeDexPools(recordedSource('E11', 'E11-dex-token-pools-paxg')));
    expect(pools.source.endpoint).toBe('E11');
    expect(pools.issues).toEqual([]);
  });

  it('reaches the priced tokens E14 nests under each asset', () => {
    const quotes = normalizeRwaQuotes(recordedSource('E14', 'E14-rwa-quotes-gold'));
    expect(quotes.items[0]?.wrappers).toHaveLength(7);
    expect(rwaQuoteInput(quotes).issues).toEqual([]);

    const broken = normalizeRwaQuotes(
      damaged('E14', 'E14-rwa-quotes-gold', (data) => {
        const assets = (data as { rwa_assets: { tokens: { price: number | null }[] }[] }).rwa_assets;
        assets[0]!.tokens[0]!.price = null;
      }),
    );
    // Read as assets, the token is out of reach of the item issues; `rwaQuoteInput` goes down to it.
    expect(schemaInput(broken).issues).toEqual([]);
    expect(rwaQuoteInput(broken).issues).toEqual([
      { field: 'data.rwa_assets[0].tokens[0].price', problem: 'null', required: true, seen: 'null' },
    ]);
  });

  it('reads the same field of every item as one pattern', () => {
    expect(fieldPattern('data[12].quote[0].price')).toBe('data.quote.price');
    expect(fieldPattern('data[0].quote[USD]')).toBe('data.quote');
    expect(fieldPattern('data.ts')).toBe('data.ts');
  });

  it('takes a severity from the full pattern first, then from the field name, then from the default', () => {
    expect(severityOfField('data.quote.USD', C7)).toBe('critical');
    expect(severityOfField('data.quote.price', C7)).toBe('critical');
    expect(severityOfField('data.ts', C7)).toBe(C7.defaultSeverity);
  });

  it('prefers a key naming the endpoint over the same field written for every endpoint', () => {
    // Losing the price on the endpoint that carries the asset's own aggregated price leaves nothing to form a
    // verdict about; losing it on a DEX venue leaves one price where the run wanted two (T4.2, D12).
    expect(severityOfField('data.p', C7, 'E10')).toBe('warning');
    expect(severityOfField('data.quote.price', C7, 'E02')).toBe('critical');
    expect(severityOfField('data.quote.price', C7, 'E08')).toBe('warning');
  });

  it('falls back to the endpoint-agnostic key when no key names the endpoint', () => {
    // E02 is named by no key, so it reads the same severities as a lookup that gives no endpoint at all.
    expect(severityOfField('data.p', C7, 'E02')).toBe(severityOfField('data.p', C7));
    expect(severityOfField('data.ts', C7, 'E10')).toBe(C7.defaultSeverity);
    expect(severityOfField('data.ts', C7, 'E02')).toBe(C7.defaultSeverity);
  });
});

describe('runSchemaCheck on the recorded answers', () => {
  const FIXTURES = {
    E02: 'E02-quotes-latest-btc-paxg',
    E03: 'E03-listings-latest-top5',
    E06: 'E06-simple-price-btc-paxg',
    E07: 'E07-price-conversion-paxg',
    E09: 'E09-dex-pair-quotes-paxg-weth',
    E10: 'E10-dex-token-price-paxg',
    E14: 'E14-rwa-quotes-gold',
  } as const;

  it('finds every field the verdict reads present in the answers recorded in T1.2', () => {
    for (const [endpoint, label] of Object.entries(FIXTURES) as [keyof typeof FIXTURES, string][]) {
      const result = runSchemaCheck([schemaInput(priceObservations(recordedSource(endpoint, label)))], C7);
      expect(result, endpoint).toMatchObject({ id: 'C7', status: 'evaluated', severity: 'info', findings: [] });
    }
  });

  it('reports the pairs of the E08 sample that name no CMC asset, once, with the count', () => {
    const answer = priceObservations(recordedSource('E08', 'E08-dex-spot-pairs-paxg-uniswap'));
    expect(answer.items).toHaveLength(100);
    const result = runSchemaCheck([schemaInput(answer)], C7);
    // 12 of the 100 pairs carry a base asset symbol but no `base_asset_ucid`, so they cannot be tied to an asset.
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      code: 'unreadable_field',
      severity: 'warning',
      message:
        'E08 data.base_asset_ucid: the value was null, observed 12 times in this answer, ' +
        'for example at data[3].base_asset_ucid.',
    });
    expect(result.findings[0]?.measurement).toMatchObject({ value: 12, unit: 'count', threshold: null });
    expect(result.findings[0]?.evidence[0]?.source.fixture?.file).toBe(
      'fixtures/discovery/E08-dex-spot-pairs-paxg-uniswap.json',
    );
  });

  it('runs on nothing only when nothing was read (D9)', () => {
    expect(runSchemaCheck([], C7)).toMatchObject({ status: 'not_applicable', severity: null, findings: [] });
  });
});

describe('what C7 calls critical', () => {
  it('calls a price that could not be read critical: the verdict has nothing left to rest on', () => {
    const result = runSchemaCheck([brokenQuotes((item) => (item.quote[0]!.price = null))], C7);
    expect(result.severity).toBe('critical');
    expect(result.findings[0]).toMatchObject({
      severity: 'critical',
      message: 'E02 data.quote.price: the value was null, observed once in this answer, for example at data[0].quote[0].price.',
    });
  });

  it('calls a container that is not the expected list critical', () => {
    const source = { ...recordedSource('E02', 'E02-quotes-latest-btc-paxg'), data: { unexpected: true } };
    const result = runSchemaCheck([schemaInput(priceObservations(source))], C7);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      severity: 'critical',
      message: 'E02 data: the value was not an array (received: object), observed once in this answer, for example at data.',
    });
  });

  it('calls a missing USD quote critical, whatever the endpoint puts in its place', () => {
    const result = runSchemaCheck([brokenQuotes((item) => (item.quote = []))], C7);
    expect(result.severity).toBe('critical');
    expect(result.findings.map((found) => found.message)).toContain(
      'E02 data.quote: the field was absent, observed once in this answer, for example at data[0].quote[USD].',
    );
    // The price of that quote is critical too; the timestamp and the volume behind it stay warnings.
    expect(result.findings.map((found) => `${found.severity} ${found.measurement?.label ?? ''}`)).toEqual([
      'critical E02 data.quote',
      'critical E02 data.quote.price',
      'warning E02 data.quote.last_updated',
      'warning E02 data.quote.volume_24h',
    ]);
  });

  it('calls a timestamp that could not be read a warning: the verdict is formed, with less behind it', () => {
    const result = runSchemaCheck([brokenQuotes((item) => (item.quote[0]!.last_updated = 'not a date'))], C7);
    expect(result.severity).toBe('warning');
    expect(result.findings[0]).toMatchObject({
      severity: 'warning',
      message:
        'E02 data.quote.last_updated: the value could not be read as a timestamp (received: string), ' +
        'observed once in this answer, for example at data[0].quote[0].last_updated.',
    });
  });
});

describe('schemaIssues', () => {
  it('scores the fields the verdict reads and hands the rest to the audit (D8)', () => {
    // `market_cap` is sent, in a shape that cannot be read, but no check reads it.
    const input = brokenQuotes((item) => (item.quote[0]!.market_cap = 'a lot'));
    const { scored, reported } = schemaIssues([input]);
    expect(scored).toEqual([]);
    expect(reported).toHaveLength(1);
    expect(reported[0]).toMatchObject({
      field: 'data.quote.market_cap',
      example: 'data[0].quote[0].market_cap',
      problem: 'not_a_number',
      seen: ['string'],
      count: 1,
      required: false,
    });
    // Scored by nobody, so the verdict does not move.
    expect(runSchemaCheck([input], C7)).toMatchObject({ severity: 'info', findings: [] });
  });

  it('keeps the answers apart when the same field fails in two of them', () => {
    const first = brokenQuotes((item) => (item.quote[0]!.price = null));
    const second = schemaInput(
      priceObservations(
        damaged('E06', 'E06-simple-price-btc-paxg', (data) => {
          (data as { quotes: { price: number | null }[] }[])[0]!.quotes[0]!.price = null;
        }),
      ),
    );
    const { scored } = schemaIssues([first, second]);
    expect(scored.map((found) => `${found.source.endpoint} ${found.field}`)).toEqual([
      'E02 data.quote.price',
      'E06 data.quotes.price',
    ]);
    expect(runSchemaCheck([first, second], C7).sources.map((source) => source.endpoint)).toEqual(['E02', 'E06']);
  });

  it('lists every shape a field arrived in, when they differ', () => {
    const input = brokenQuotes(() => undefined);
    const source = damaged('E03', 'E03-listings-latest-top5', (data) => {
      const items = data as { quote: { price: number | null | string }[] }[];
      items[0]!.quote[0]!.price = null;
      items[1]!.quote[0]!.price = 'high';
    });
    const { scored } = schemaIssues([input, schemaInput(priceObservations(source))]);
    const nulls = scored.find((found) => found.problem === 'null' && found.source.endpoint === 'E03');
    const texts = scored.find((found) => found.problem === 'not_a_number' && found.source.endpoint === 'E03');
    expect(nulls).toMatchObject({ field: 'data.quote.price', count: 1, seen: ['null'] });
    expect(texts).toMatchObject({ field: 'data.quote.price', count: 1, seen: ['string'] });
  });
});
