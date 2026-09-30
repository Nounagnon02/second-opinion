import { describe, expect, it } from 'vitest';
import { normalizeAssetInfo, normalizeAssetMap } from '../src/normalize/identity.js';
import { damaged, recordedSource } from './helpers/normalize.js';

describe('normalizeAssetMap (E01)', () => {
  const normalized = normalizeAssetMap(recordedSource('E01', 'E01-map-btc-paxg'));

  it('returns every candidate a symbol matched, so the resolver can choose (D3)', () => {
    expect(normalized.issues).toEqual([]);
    expect(normalized.items.flatMap((item) => item.issues)).toEqual([]);
    expect(normalized.items).toHaveLength(14);
    expect(normalized.items.filter((item) => item.asset.symbol === 'BTC')).toHaveLength(13);
  });

  it('carries the rank and the active flag the choice rests on', () => {
    const bitcoin = normalized.items.find((item) => item.asset.cmcId === 1);
    expect(bitcoin).toMatchObject({
      asset: { cmcId: 1, symbol: 'BTC', name: 'Bitcoin', slug: 'bitcoin' },
      rank: 1,
      isActive: true,
      platform: null,
    });
    expect(normalized.items.filter((item) => item.asset.symbol === 'BTC' && (item.rank ?? 0) > 1)).not.toHaveLength(0);
  });

  it('keeps the platform identifier of this answer without reconciling it with the other endpoints', () => {
    // E01 numbers Ethereum 1, E02 numbers it 1027 and E05 sends "1027" (observation 8): only the slug is comparable.
    expect(normalized.items.find((item) => item.asset.cmcId === 4705)?.platform).toEqual({
      cmcId: 1,
      name: 'Ethereum',
      slug: 'ethereum',
      symbol: 'ETH',
      tokenAddress: '0x45804880de22913dafe09f4980848ece6ecbaf78',
    });
  });

  it('writes down a platform that carries no address, and keeps the candidate', () => {
    const broken = damaged('E01', 'E01-map-btc-paxg', (data) => {
      const entry = (data as { platform: { token_address?: string } | null }[])[1];
      if (entry?.platform) delete entry.platform.token_address;
    });
    const result = normalizeAssetMap(broken);

    expect(result.items[1]?.platform?.tokenAddress).toBeNull();
    expect(result.items[1]?.issues).toEqual([
      { field: 'data[1].platform.token_address', problem: 'missing', required: true, seen: 'absent' },
    ]);
  });
});

describe('normalizeAssetInfo (E05)', () => {
  const normalized = normalizeAssetInfo(recordedSource('E05', 'E05-info-btc-paxg'));

  it('reads the object keyed by CMC identifier as a list of assets', () => {
    expect(normalized.issues).toEqual([]);
    expect(normalized.items.flatMap((item) => item.issues)).toEqual([]);
    expect(normalized.items.map((item) => item.asset.cmcId)).toEqual([1, 4705]);
  });

  it('gives the platform slug and token address E10 and E11 are called with (D3)', () => {
    expect(normalized.items[1]).toMatchObject({
      asset: { cmcId: 4705, symbol: 'PAXG' },
      category: 'token',
      platform: {
        cmcId: 1027,
        slug: 'ethereum',
        tokenAddress: '0x45804880de22913dafe09f4980848ece6ecbaf78',
      },
      contracts: [
        {
          address: '0x45804880de22913dafe09f4980848ece6ecbaf78',
          platformName: 'Ethereum',
          platformSlug: 'ethereum',
        },
      ],
    });
  });

  it('reports a coin as having no platform and no contract, which is what makes C1 and C4 inapplicable', () => {
    expect(normalized.items[0]).toMatchObject({
      asset: { cmcId: 1, symbol: 'BTC' },
      category: 'coin',
      platform: null,
      contracts: [],
    });
  });
});
