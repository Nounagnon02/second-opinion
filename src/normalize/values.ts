/**
 * Reading raw CMC fields into usable values, and writing down every field that could not be used.
 *
 * The shapes handled here are the ones observed in the T1.2 fixtures (docs/ENDPOINTS.md, decision D8): decimal
 * numbers sent as strings (E11 `liqUsd`, `v24`, `liq`), millisecond epochs sent as strings (E10 `ts`, E11 `pubAt`),
 * identifiers sent as strings (E05 `platform.id`, E08 `base_asset_ucid`) and ISO timestamps everywhere else.
 *
 * A field that cannot be read becomes a `FieldIssue`, never an exception: one unusable field must not hide the rest
 * of an answer, and C7 is built on those issues (D8).
 */

export type FieldProblem =
  | 'missing'
  | 'null'
  | 'not_a_number'
  | 'not_a_timestamp'
  | 'not_a_string'
  | 'not_a_boolean'
  | 'not_an_object'
  | 'not_an_array';

export interface FieldIssue {
  /** Where the field sits in the response body, for example `data[0].quote[0].price`. */
  field: string;
  problem: FieldProblem;
  /**
   * True when a check reads this field. C7 scores the required ones only; the others describe the shape of the API
   * and belong to the audit (D8).
   */
  required: boolean;
  /** The JSON type received: `absent`, `null`, `string`, `number`, `boolean`, `array` or `object`. */
  seen: string;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The JSON type of a value, with `absent` for a field the answer did not carry at all. */
export function jsonTypeOf(value: unknown): string {
  if (value === undefined) return 'absent';
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

const DECIMAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

/**
 * A finite number, from a JSON number or from a decimal string (E10 and E11 send amounts as strings).
 * Strings longer than a double keeps lose their last digits, which is below any threshold the checks use.
 */
export function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!DECIMAL.test(text)) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

/** An integer, from a JSON number or from a string (E05 `platform.id`, E08 `base_asset_ucid`). */
export function toInteger(value: unknown): number | null {
  const parsed = toFiniteNumber(value);
  return parsed !== null && Number.isInteger(parsed) ? parsed : null;
}

/**
 * The window an epoch timestamp must fall into. A whole number is read as milliseconds, the shape observed in E10
 * (`ts`, `fpt`, `fpct`) and E11 (`pubAt`); a value outside the window is refused rather than read as seconds, as
 * no answer has shown that shape.
 */
const EPOCH_MS_MIN = Date.UTC(2000, 0, 1);
const EPOCH_MS_MAX = Date.UTC(2100, 0, 1);

/** An ISO 8601 UTC timestamp, from an ISO string or from a millisecond epoch sent as a number or a string. */
export function toIsoTimestamp(value: unknown): string | null {
  if (typeof value === 'number') return fromEpochMs(value);
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (text === '') return null;
  if (/^\d+$/.test(text)) return fromEpochMs(Number(text));
  const ms = Date.parse(text);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

function fromEpochMs(ms: number): string | null {
  if (!Number.isInteger(ms) || ms < EPOCH_MS_MIN || ms >= EPOCH_MS_MAX) return null;
  return new Date(ms).toISOString();
}

/** A boolean, from a JSON boolean (E13 `has_tokens`) or from the 0 / 1 integers of E01 and E02 (`is_active`). */
export function toFlag(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (value === 0 || value === 1) return value === 1;
  return null;
}

/** A non-empty string; an empty or blank one is treated as no value. */
export function toText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

/**
 * Seconds between the server clock of an answer (`status.timestamp`) and the timestamp of the data it carries.
 * The local clock is never used, so a replayed fixture always gives the same age (D4). A negative value means the
 * data is dated after the answer.
 */
export function ageSeconds(observedAt: string, lastUpdated: string | null): number | null {
  if (lastUpdated === null) return null;
  const observed = Date.parse(observedAt);
  const updated = Date.parse(lastUpdated);
  if (Number.isNaN(observed) || Number.isNaN(updated)) return null;
  return (observed - updated) / 1000;
}

function note(issues: FieldIssue[], field: string, problem: FieldProblem, required: boolean, value: unknown): void {
  issues.push({
    field,
    problem: value === undefined ? 'missing' : value === null ? 'null' : problem,
    required,
    seen: jsonTypeOf(value),
  });
}

/** True when a field that could not be read deserves an issue: always for a required one, else only if it was sent. */
function worthNoting(required: boolean, value: unknown): boolean {
  return required || (value !== undefined && value !== null);
}

/**
 * Reads the fields of one object of a CMC answer and collects what it could not use.
 *
 * `required` marks a field that a check reads (D8). A required field that is absent, `null` or unusable is always
 * written down; an optional one only when it was sent in a shape that could not be read, because an absent optional
 * field says nothing about the quality of the data.
 */
export class Reader {
  readonly path: string;
  readonly issues: FieldIssue[];
  private readonly record: Record<string, unknown> | undefined;

  constructor(value: unknown, path: string, issues: FieldIssue[] = [], required = false) {
    this.path = path;
    this.issues = issues;
    this.record = isRecord(value) ? value : undefined;
    if (this.record === undefined && worthNoting(required, value)) {
      note(issues, path, 'not_an_object', required, value);
    }
  }

  /**
   * The readers of an array of items, each with its own issue list, so that one unusable item does not pollute the
   * others. A problem with the array itself goes to `issues`.
   */
  static list(value: unknown, path: string, issues: FieldIssue[], required = false): Reader[] {
    if (!Array.isArray(value)) {
      if (worthNoting(required, value)) note(issues, path, 'not_an_array', required, value);
      return [];
    }
    return value.map((item, index) => new Reader(item, `${path}[${index}]`, [], required));
  }

  /** False when the value read was not an object: every field then reads as absent. */
  get present(): boolean {
    return this.record !== undefined;
  }

  /** The field names the object carries, in the order the answer listed them. */
  get keys(): string[] {
    return this.record === undefined ? [] : Object.keys(this.record);
  }

  raw(name: string): unknown {
    return this.record?.[name];
  }

  private read<T>(
    name: string,
    required: boolean,
    problem: FieldProblem,
    parse: (value: unknown) => T | null,
  ): T | null {
    const value = this.raw(name);
    const parsed = parse(value);
    if (parsed === null && worthNoting(required, value)) {
      note(this.issues, `${this.path}.${name}`, problem, required, value);
    }
    return parsed;
  }

  number(name: string, required = false): number | null {
    return this.read(name, required, 'not_a_number', toFiniteNumber);
  }

  integer(name: string, required = false): number | null {
    return this.read(name, required, 'not_a_number', toInteger);
  }

  timestamp(name: string, required = false): string | null {
    return this.read(name, required, 'not_a_timestamp', toIsoTimestamp);
  }

  text(name: string, required = false): string | null {
    return this.read(name, required, 'not_a_string', toText);
  }

  flag(name: string, required = false): boolean | null {
    return this.read(name, required, 'not_a_boolean', toFlag);
  }

  /** A reader on a nested object, sharing this reader's issue list. */
  child(name: string, required = false): Reader {
    return new Reader(this.raw(name), `${this.path}.${name}`, this.issues, required);
  }

  /** The readers of a nested array, sharing this reader's issue list (short arrays such as `quote` or `quotes`). */
  items(name: string, required = false): Reader[] {
    const value = this.raw(name);
    if (!Array.isArray(value)) {
      if (worthNoting(required, value)) note(this.issues, `${this.path}.${name}`, 'not_an_array', required, value);
      return [];
    }
    return value.map((item, index) => new Reader(item, `${this.path}.${name}[${index}]`, this.issues, required));
  }
}
