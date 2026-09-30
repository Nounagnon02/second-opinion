/**
 * What the recorded answers actually carry, field by field, and how that compares with what was written down
 * (specification F9: "compare the documented fields to the fields received").
 *
 * The baseline is the "Observed fields" table of `docs/ENDPOINTS.md`, as decision D8 settles: it is the inventory
 * this project verified endpoint by endpoint on 2026-09-24, and it is the document every later task has read the
 * API through. So the comparison runs in the direction that says something: **a field the inventory lists and that
 * no recorded answer of that endpoint carries**. The other direction is not published, because the table says
 * "fields of interest" and never claimed to be exhaustive — listing everything it omits would describe our own
 * note-taking, not the API.
 *
 * Three things are measured on the answers themselves, and they need no baseline at all:
 * - a field whose JSON type is not the same in every answer of one endpoint;
 * - a field present in some answers of **the same question** and absent from others (the request shape of
 *   `corpus.ts` is what makes two answers comparable);
 * - a field observed `null`.
 *
 * Field paths have their array indices and their identifier-keyed map keys removed, exactly as C7 does
 * (`fieldPattern`), so that an answer holding a hundred pairs describes one field rather than a hundred. One
 * concrete path is kept beside each, to find the field again in the recorded answer.
 */
import type { EndpointId } from '../cmc/endpoints.js';
import { isRecord, jsonTypeOf } from '../normalize/values.js';
import { entriesOf, succeeded, type Corpus, type CorpusEntry } from './corpus.js';
import type { DocumentedEndpointId, FieldInventory } from './inventory.js';

/** One field of one answer: the JSON types seen under it, and where. */
export interface WalkedField {
  types: string[];
  /** Values observed under this field in this answer. */
  count: number;
  /** One concrete path, with its indices, for example `data[0].quote[0].price`. */
  example: string;
}

/**
 * Every field of one response body, keyed by its path with indices removed.
 *
 * Array positions and identifier-keyed map keys both collapse: `data[0].quote[0].price` and `data[4705].symbol`
 * become `data.quote.price` and `data.symbol`. CMC uses an integer-keyed object wherever it returns one entry per
 * asset (E05 `data.<id>`), so the two are the same shape written two ways, and reading them as one field is what
 * lets the answers of one endpoint be compared at all.
 */
export function walkFields(body: unknown): Map<string, WalkedField> {
  const fields = new Map<string, WalkedField>();

  const record = (pattern: string, type: string, path: string): void => {
    const found = fields.get(pattern);
    if (found === undefined) {
      fields.set(pattern, { types: [type], count: 1, example: path });
      return;
    }
    found.count += 1;
    if (!found.types.includes(type)) found.types.push(type);
  };

  /**
   * `counts` is false for a value reached by collapsing a position — an array element, or the value of an
   * integer key. Such a value shares the pattern of its container, and recording its type under that pattern
   * would make every array of objects look like a field that is "sometimes an array and sometimes an object".
   */
  const visit = (value: unknown, pattern: string, path: string, counts: boolean): void => {
    if (pattern !== '' && counts) record(pattern, jsonTypeOf(value), path);
    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        visit(item, pattern, `${path}[${String(index)}]`, false);
      });
      return;
    }
    if (!isRecord(value)) return;
    for (const [key, child] of Object.entries(value)) {
      // An integer key is a position in a map of entries, not a field name: it collapses like an array index.
      if (/^\d+$/.test(key)) visit(child, pattern, `${path}[${key}]`, false);
      else visit(child, pattern === '' ? key : `${pattern}.${key}`, path === '' ? key : `${path}.${key}`, true);
    }
  };

  visit(body, '', '', true);
  return fields;
}

/** Every segment of a field path: `data.quote.price` names `data`, `quote` and `price`. */
export function fieldNames(pattern: string): string[] {
  return pattern.split('.').filter((part) => part !== '');
}

/** Where a field was observed: which recorded answer, and at which concrete path inside it. */
export interface FieldSite {
  file: string;
  path: string;
}

/** One field of one endpoint, across every recorded answer of that endpoint. */
export interface EndpointField {
  field: string;
  /** JSON types observed under it, in the order they were first seen. */
  types: string[];
  /** Answers of this endpoint that carried it. */
  answers: number;
  /** Values observed under it, all answers together. */
  values: number;
  site: FieldSite;
  /** One answer per type, so a field whose type varies can be opened on both sides. */
  byType: { type: string; answers: number; site: FieldSite }[];
}

/** Every field of every answer of one endpoint, most widely carried first. */
export function endpointFields(entries: readonly CorpusEntry[]): EndpointField[] {
  const fields = new Map<string, EndpointField>();
  for (const entry of entries) {
    for (const [pattern, walked] of walkFields(entry.body)) {
      const site: FieldSite = { file: entry.file, path: walked.example };
      const found = fields.get(pattern) ?? { field: pattern, types: [], answers: 0, values: 0, site, byType: [] };
      found.answers += 1;
      found.values += walked.count;
      for (const type of walked.types) {
        if (!found.types.includes(type)) found.types.push(type);
        const byType = found.byType.find((one) => one.type === type);
        if (byType) byType.answers += 1;
        else found.byType.push({ type, answers: 1, site });
      }
      fields.set(pattern, found);
    }
  }
  return [...fields.values()].sort((a, b) => b.answers - a.answers || (a.field < b.field ? -1 : 1));
}

/** A field whose JSON type is not the same in every answer of one endpoint. */
export interface TypeVariance {
  field: string;
  /** The types seen, `null` and `absent` excluded: neither says the field changed type. */
  types: { type: string; answers: number; site: FieldSite }[];
}

/** Fields of one endpoint carrying more than one non-null JSON type. */
export function typeVariances(fields: readonly EndpointField[]): TypeVariance[] {
  return fields.flatMap((field) => {
    const types = field.byType.filter((one) => one.type !== 'null' && one.type !== 'absent');
    return types.length > 1 ? [{ field: field.field, types }] : [];
  });
}

/** A field observed `null` in at least one answer. */
export interface NullField {
  field: string;
  answers: number;
  site: FieldSite;
}

/** Fields of one endpoint observed `null`, most often first. */
export function nullFields(fields: readonly EndpointField[]): NullField[] {
  return fields
    .flatMap((field) => {
      const asNull = field.byType.find((one) => one.type === 'null');
      return asNull === undefined ? [] : [{ field: field.field, answers: asNull.answers, site: asNull.site }];
    })
    .sort((a, b) => b.answers - a.answers || (a.field < b.field ? -1 : 1));
}

/** A field present in some answers of one question and absent from others. */
export interface OptionalField {
  /** The request shape it was observed under: the path and the parameter names. */
  shape: string;
  field: string;
  /** Answers of this shape that carried it, out of the answers of this shape. */
  present: number;
  answers: number;
  with: FieldSite;
  without: string;
}

/**
 * Fields that come and go between answers to the same question.
 *
 * Only shapes with more than one recorded answer can show this, and only the same shape can: a parameter that adds
 * a field to the answer (E06 `include_last_updated`) would otherwise read as the API dropping it.
 */
export function optionalFields(entries: readonly CorpusEntry[]): OptionalField[] {
  const shapes = new Map<string, CorpusEntry[]>();
  for (const entry of entries) {
    const group = shapes.get(entry.shape);
    if (group) group.push(entry);
    else shapes.set(entry.shape, [entry]);
  }

  const found: OptionalField[] = [];
  for (const [shape, group] of shapes) {
    if (group.length < 2) continue;
    const walked = group.map((entry) => ({ entry, fields: walkFields(entry.body) }));
    const patterns = new Set(walked.flatMap((one) => [...one.fields.keys()]));
    for (const field of patterns) {
      const carrying = walked.filter((one) => one.fields.has(field));
      const first = carrying[0];
      const missing = walked.find((one) => !one.fields.has(field));
      if (first === undefined || missing === undefined) continue;
      found.push({
        shape,
        field,
        present: carrying.length,
        answers: walked.length,
        with: { file: first.entry.file, path: first.fields.get(field)?.example ?? field },
        without: missing.entry.file,
      });
    }
  }
  return found.sort((a, b) => a.present / a.answers - b.present / b.answers || (a.field < b.field ? -1 : 1));
}

/** Everything one endpoint's accepted answers carry, walked once and read by every comparison below. */
export interface EndpointFieldSet {
  endpoint: EndpointId;
  /** The answers the API accepted; a refusal carries no `data` and would read as every field being absent. */
  entries: CorpusEntry[];
  fields: EndpointField[];
  /** Every distinct field name received, at any depth. */
  names: Set<string>;
}

/**
 * Walks the answers of every endpoint the corpus holds one for, once each.
 *
 * Only the answers the API accepted are walked. A refusal carries a `status` block and nothing else, so counting
 * it would report every field of the endpoint as one that "comes and goes" — a statement about the refusals
 * rather than about the shape of an answer. The refusals are measured in their own entry.
 */
export function fieldsByEndpoint(corpus: Corpus): EndpointFieldSet[] {
  const endpoints = [...new Set(corpus.entries.flatMap((entry) => (entry.endpoint === null ? [] : [entry.endpoint])))];
  return endpoints.flatMap((endpoint) => {
    const entries = entriesOf(corpus, endpoint).filter(succeeded);
    if (entries.length === 0) return [];
    const fields = endpointFields(entries);
    return [{ endpoint, entries, fields, names: new Set(fields.flatMap((field) => fieldNames(field.field))) }];
  });
}

/** What the comparison between the inventory and the recorded answers found, for one endpoint. */
export interface InventoryComparison {
  endpoint: EndpointId;
  /** Whether the comparison was run, and why not when it was not. */
  compared: boolean;
  /** The endpoint this row states its fields by reference to; `null` when it states them itself. */
  reference: DocumentedEndpointId | null;
  /** Names the inventory lists for it. */
  listed: number;
  /** Names it lists that no recorded answer of this endpoint carries. */
  missing: string[];
  /** Names it says are absent that a recorded answer does carry. */
  unexpected: string[];
  /** Distinct names the recorded answers carried, to say what the comparison ran against. */
  received: number;
  answers: number;
  /** One recorded answer of this endpoint, to open the comparison in. */
  example: string;
}

/**
 * Compares the inventory with what the corpus received, endpoint by endpoint.
 *
 * Both directions the inventory states plainly are checked: a name it lists that never arrived, and a name it says
 * is absent that did. An endpoint the corpus holds no answer for is left out entirely — nothing was received, so
 * nothing can be said to be missing from it — and a row that states its fields by reference is carried through
 * uncompared, so the report can say how much of the inventory the comparison covered.
 */
export function compareInventory(
  sets: readonly EndpointFieldSet[],
  inventory: readonly FieldInventory[],
): InventoryComparison[] {
  const compared: InventoryComparison[] = [];
  for (const row of inventory) {
    const set = sets.find((one) => one.endpoint === row.endpoint);
    const example = set?.entries[0];
    if (set === undefined || example === undefined) continue;
    compared.push({
      endpoint: set.endpoint,
      compared: row.reference === null,
      reference: row.reference,
      listed: row.names.length,
      missing: row.reference === null ? row.names.filter((name) => !set.names.has(name)) : [],
      unexpected: row.absent.filter((name) => set.names.has(name)),
      received: set.names.size,
      answers: set.entries.length,
      example: example.file,
    });
  }
  return compared;
}
