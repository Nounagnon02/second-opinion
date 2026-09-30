import { describe, expect, it } from 'vitest';
import { parseRecordArgs } from '../src/cli/record.js';

// Built at runtime: a literal API path here would have to be listed as verified in docs/ENDPOINTS.md.
const PATH = ['', 'v9', 'sample', 'latest'].join('/');

describe('parseRecordArgs', () => {
  it('reads the label, the path and the query parameters', () => {
    expect(parseRecordArgs(['E99-sample', PATH, 'id=1,4705', 'convert=USD'])).toEqual({
      label: 'E99-sample',
      path: PATH,
      query: { id: '1,4705', convert: 'USD' },
    });
  });

  it('keeps "=" inside a parameter value', () => {
    expect(parseRecordArgs(['label', PATH, 'filter=a=b']).query).toEqual({ filter: 'a=b' });
  });

  it('accepts a call without parameters', () => {
    expect(parseRecordArgs(['label', PATH]).query).toEqual({});
  });

  it('rejects labels that could leave the fixture directory', () => {
    expect(() => parseRecordArgs(['../escape', PATH])).toThrow(/label/);
    expect(() => parseRecordArgs(['a/b', PATH])).toThrow(/label/);
    expect(() => parseRecordArgs([])).toThrow(/Usage/);
  });

  it('rejects paths that are not API paths', () => {
    expect(() => parseRecordArgs(['label', 'https://example.test/x'])).toThrow(/Invalid API path/);
    expect(() => parseRecordArgs(['label', `${PATH}?id=1`])).toThrow(/Invalid API path/);
    expect(() => parseRecordArgs(['label'])).toThrow(/Invalid API path/);
  });

  it('rejects parameters without a name', () => {
    expect(() => parseRecordArgs(['label', PATH, 'novalue'])).toThrow(/name=value/);
    expect(() => parseRecordArgs(['label', PATH, '=1'])).toThrow(/name=value/);
  });
});
