/**
 * ChurchRide: parser for the church's automated "Transportation Assignment" SMS.
 *
 * Template seen in Nov 2026: one passenger per text, plain SMS from the church's
 * Twilio number, "Label: value" fields on a single line:
 *
 *   Transportation Assignment Dear <driver>, You have been assigned to provide
 *   transportation for the following member: Name: <passenger>
 *   Number of Persons: <n> Phone Number: <+1XXXXXXXXXX> Service Date: <YYYY-MM-DD>
 *   Pickup Time: <h:mm AM> - <h:mm AM> Transport Type: <pick-up | two-way>
 *   Pickup Address: <street address or named place>
 *   View Location on Google Maps Provide updates through the Church App . <footer>
 *
 * Rules:
 * - Runs entirely on the device: no network, no AI. AI is only a fallback for texts
 *   that come back as "possible-change" or "not-an-assignment" when you expected one.
 * - Never invents values. A missing field is null plus an "error" issue.
 * - Anything uncertain is kept but flagged "review", and the app shows it before saving.
 * - Fields are found by their labels, so line breaks, extra spaces, odd dashes and
 *   reordered fields don't break it.
 * - parseAssignmentMessages() splits a paste or share holding several texts.
 * - expectedProvince flags addresses in another province, because the church's system
 *   has sent a local pickup with a Vancouver, BC address. After geocoding, the app
 *   also flags any stop far from the church.
 */

export type Severity = 'error' | 'review';

export type IssueCode =
  | 'unfamiliar-wording'
  | 'multiple-passengers'
  | 'other-driver'
  | 'missing-name'
  | 'missing-persons'
  | 'missing-phone'
  | 'unusual-phone'
  | 'missing-date'
  | 'bad-date'
  | 'past-date'
  | 'missing-time'
  | 'bad-time'
  | 'no-meridiem'
  | 'window-order'
  | 'missing-type'
  | 'unknown-type'
  | 'missing-address'
  | 'place-address'
  | 'other-province'
  | 'far-from-church'
  | 'changed'
  | 'ai-extracted';

export interface Issue {
  field: string;
  severity: Severity;
  code: IssueCode;
  message: string;
}

/** Trips to create: "pick-up" is to church only; "two-way" adds a separate return trip. */
export type Leg = 'to-church' | 'from-church';

export interface Assignment {
  kind: 'assignment';
  driverName: string | null;
  passengerName: string | null;
  persons: number | null;
  /** E.164, e.g. +15065550101. Best key for matching saved regulars. */
  phone: string | null;
  /** YYYY-MM-DD */
  serviceDate: string | null;
  /** 24-hour "HH:MM" */
  pickupWindow: { start: string; end: string } | null;
  /** As sent, lower-cased, e.g. "pick-up" or "two-way" */
  transportType: string | null;
  legs: Leg[];
  pickupAddress: string | null;
  /** "place" = a named building with no street number; confirm the exact pickup spot once. */
  addressKind: 'street' | 'place' | null;
  /** The same key arriving again means a resend or a change, not a new assignment. */
  dedupeKey: string | null;
  issues: Issue[];
  raw: string;
}

export interface PossibleChange {
  kind: 'possible-change';
  hint: 'cancellation' | 'update';
  /** Whatever could be read, to match it against an existing assignment. Always needs review. */
  fields: Pick<
    Assignment,
    'passengerName' | 'phone' | 'serviceDate' | 'pickupWindow' | 'pickupAddress' | 'dedupeKey'
  >;
  raw: string;
}

export interface NotAnAssignment {
  kind: 'not-an-assignment';
  raw: string;
}

export type ParseResult = Assignment | PossibleChange | NotAnAssignment;

export interface ParseOptions {
  /** Your name as the church spells it. Flags texts addressed to someone else. */
  expectedDriverName?: string;
  /** Today's date as YYYY-MM-DD, for the "date already passed" check. */
  today?: string;
  /** Province the church is in, e.g. "NB". Flags pickup addresses in another province. */
  expectedProvince?: string;
}

const LABELS = [
  ['Name', 'name'],
  ['Number of Persons', 'persons'],
  ['Phone Number', 'phone'],
  ['Service Date', 'date'],
  ['Pickup Time', 'time'],
  ['Transport Type', 'type'],
  ['Pickup Address', 'address'],
] as const;

type FieldKey = (typeof LABELS)[number][1];
type RawFields = Partial<Record<FieldKey, string>>;

const LABEL_TO_KEY = new Map<string, FieldKey>(
  LABELS.map(([label, key]) => [label.toLowerCase(), key]),
);

const LABEL_RE = new RegExp(
  `\\b(${LABELS.map(([label]) => escapeRegExp(label)).join('|')})\\s*:`,
  'gi',
);

/** Text after the fields: link captions and the footer. */
const STOP_RE =
  /\b(?:View Location on Google Maps|Provide updates through|Thank you for serving|Kind regards)\b/i;

const CANCEL_RE = /\bcancel(?:l?ed|lation)?\b/i;
const UPDATE_RE = /\b(?:updated?|changed?|revised|rescheduled)\b/i;
const ASSIGNMENT_HEADER_RE = /\btransportation assignment\b/i;

const CLOCK = String.raw`(\d{1,2}):(\d{2})\s*([AaPp])?\.?\s*(?:[Mm]\.?)?`;
const WINDOW_RE = new RegExp(`^${CLOCK}(?:\\s*(?:-|to)\\s*${CLOCK})?`);

const TRANSPORT_TYPES: Record<string, Leg[]> = {
  pickup: ['to-church'],
  twoway: ['to-church', 'from-church'],
  roundtrip: ['to-church', 'from-church'],
};

/** Where each text starts when several are pasted or shared together. */
const MESSAGE_START_RE = /(?:\b(?:Updated|Revised|Cancelled|Canceled)\s+)?\bTransportation Assignment\b/gi;

export const PROVINCE_CODES: Record<string, string> = {
  'british columbia': 'BC', bc: 'BC',
  alberta: 'AB', ab: 'AB',
  saskatchewan: 'SK', sk: 'SK',
  manitoba: 'MB', mb: 'MB',
  ontario: 'ON', on: 'ON',
  quebec: 'QC', 'québec': 'QC', qc: 'QC',
  'new brunswick': 'NB', nb: 'NB',
  'nova scotia': 'NS', ns: 'NS',
  'prince edward island': 'PE', pei: 'PE', pe: 'PE',
  'newfoundland and labrador': 'NL', newfoundland: 'NL', nl: 'NL',
  yukon: 'YT', yt: 'YT',
  'northwest territories': 'NT', nt: 'NT',
  nunavut: 'NU', nu: 'NU',
};

const PROVINCE_AT_END_RE = new RegExp(
  `(?:^|\\s)(${Object.keys(PROVINCE_CODES).map(escapeRegExp).join('|')})$`,
);

/** Parses a paste or share that may hold several assignment texts, in order. */
export function parseAssignmentMessages(input: string, opts: ParseOptions = {}): ParseResult[] {
  const text = normalize(input);
  const starts = [...text.matchAll(MESSAGE_START_RE)].map((m) => m.index ?? 0);
  if (starts.length <= 1) return [parseAssignmentSms(input, opts)];
  return starts.map((start, i) => parseAssignmentSms(text.slice(start, starts[i + 1] ?? text.length), opts));
}

export function parseAssignmentSms(input: string, opts: ParseOptions = {}): ParseResult {
  const text = normalize(input);
  const { header, fields, repeated } = extractFields(text);

  const cancelled = CANCEL_RE.test(header);
  const updated = ASSIGNMENT_HEADER_RE.test(header) && UPDATE_RE.test(header);
  if (cancelled || updated) {
    const a = buildAssignment(fields, header, repeated, input, opts);
    return {
      kind: 'possible-change',
      hint: cancelled ? 'cancellation' : 'update',
      fields: {
        passengerName: a.passengerName,
        phone: a.phone,
        serviceDate: a.serviceDate,
        pickupWindow: a.pickupWindow,
        pickupAddress: a.pickupAddress,
        dedupeKey: a.dedupeKey,
      },
      raw: input,
    };
  }

  if (fields.name === undefined) return { kind: 'not-an-assignment', raw: input };

  return buildAssignment(fields, header, repeated, input, opts);
}

/** Province code named in an address ("..., Vancouver, BC, Canada" gives "BC"), or null. */
export function findProvince(address: string): string | null {
  const parts = address
    .split(',')
    .map((p) => p.trim().toLowerCase().replace(/\s*[a-z]\d[a-z]\s?\d[a-z]\d$/, '').trim());
  for (let i = parts.length - 1; i >= 0; i--) {
    const match = PROVINCE_AT_END_RE.exec(parts[i] ?? '');
    const code = match?.[1] ? PROVINCE_CODES[match[1]] : undefined;
    if (code) return code;
  }
  return null;
}

/** Same key the parser gives an assignment, for manual entries and AI results. */
export function makeDedupeKey(
  serviceDate: string | null,
  phone: string | null,
  passengerName: string | null,
): string | null {
  const who = phone ?? (passengerName ? normalizeName(passengerName) : null);
  return serviceDate && who ? `${serviceDate}|${who}` : null;
}

/** Normalizes a phone number to E.164 (+1 for 10-digit North American numbers). */
export function normalizePhone(v: string | null | undefined): string | null {
  const digits = (v ?? '').replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return `+${digits}`;
}

/** Legs for a transport type as the church writes it, or null if unknown. */
export function legsForType(type: string | null | undefined): Leg[] | null {
  if (!type) return null;
  const legs = TRANSPORT_TYPES[type.toLowerCase().replace(/[^a-z]/g, '')];
  return legs ? [...legs] : null;
}

function buildAssignment(
  fields: RawFields,
  header: string,
  repeated: FieldKey[],
  raw: string,
  opts: ParseOptions,
): Assignment {
  const issues: Issue[] = [];

  if (!ASSIGNMENT_HEADER_RE.test(header)) {
    issues.push(review('message', 'unfamiliar-wording', 'Unfamiliar wording: check this is really an assignment'));
  }
  if (repeated.includes('name')) {
    issues.push(
      review('message', 'multiple-passengers', 'This text seems to list more than one passenger; only the first was read'),
    );
  }

  const driverName = /\bDear\s+([^,]+),/i.exec(header)?.[1]?.trim() ?? null;
  if (
    opts.expectedDriverName &&
    driverName &&
    normalizeName(driverName) !== normalizeName(opts.expectedDriverName)
  ) {
    issues.push(review('driverName', 'other-driver', `Addressed to ${driverName}, not you`));
  }

  const passengerName = required(fields.name, 'passengerName', 'missing-name', 'Passenger name missing', issues);
  const persons = parsePersons(fields.persons, issues);
  const phone = parsePhone(fields.phone, issues);
  const serviceDate = parseDate(fields.date, issues, opts.today);
  const pickupWindow = parseWindow(fields.time, issues);
  const { transportType, legs } = parseTransportType(fields.type, issues);
  const pickupAddress = required(fields.address, 'pickupAddress', 'missing-address', 'Pickup address missing', issues);

  let addressKind: Assignment['addressKind'] = null;
  if (pickupAddress) {
    addressKind = /^\d+[A-Za-z]?\b/.test(pickupAddress) ? 'street' : 'place';
    if (addressKind === 'place') {
      issues.push(
        review(
          'pickupAddress',
          'place-address',
          'Named place, not a street address: confirm the exact pickup spot on the map',
        ),
      );
    }
    if (opts.expectedProvince) {
      const expected =
        PROVINCE_CODES[opts.expectedProvince.trim().toLowerCase()] ?? opts.expectedProvince.trim().toUpperCase();
      const found = findProvince(pickupAddress);
      if (found && found !== expected) {
        issues.push(
          review(
            'pickupAddress',
            'other-province',
            `Address is in ${found}, not ${expected}: probably a mistake, confirm before driving`,
          ),
        );
      }
    }
  }

  return {
    kind: 'assignment',
    driverName,
    passengerName,
    persons,
    phone,
    serviceDate,
    pickupWindow,
    transportType,
    legs,
    pickupAddress,
    addressKind,
    dedupeKey: makeDedupeKey(serviceDate, phone, passengerName),
    issues,
    raw,
  };
}

function extractFields(text: string): { header: string; fields: RawFields; repeated: FieldKey[] } {
  const matches = [...text.matchAll(LABEL_RE)];
  const fields: RawFields = {};
  const repeated: FieldKey[] = [];

  matches.forEach((m, i) => {
    const key = LABEL_TO_KEY.get((m[1] ?? '').toLowerCase());
    if (!key) return;
    const start = (m.index ?? 0) + m[0].length;
    const nextLabel = matches[i + 1]?.index ?? text.length;
    const stopAt = text.slice(start).search(STOP_RE);
    const end = stopAt >= 0 ? Math.min(nextLabel, start + stopAt) : nextLabel;
    const value = text.slice(start, end).trim().replace(/[\s,;]+$/, '');
    if (key in fields) repeated.push(key);
    else fields[key] = value;
  });

  const header = text.slice(0, matches[0]?.index ?? text.length);
  return { header, fields, repeated };
}

function parsePersons(v: string | undefined, issues: Issue[]): number | null {
  const n = v ? Number(/^\d{1,2}\b/.exec(v)?.[0]) : NaN;
  if (!Number.isInteger(n) || n < 1) {
    issues.push(error('persons', 'missing-persons', 'Number of persons missing'));
    return null;
  }
  return n;
}

function parsePhone(v: string | undefined, issues: Issue[]): string | null {
  const phone = normalizePhone(v);
  if (!phone) {
    issues.push(error('phone', 'missing-phone', 'Phone number missing'));
    return null;
  }
  if (!/^\+1\d{10}$/.test(phone)) issues.push(review('phone', 'unusual-phone', 'Unusual phone number: check it'));
  return phone;
}

function parseDate(v: string | undefined, issues: Issue[], today?: string): string | null {
  const m = /(\d{4})-(\d{2})-(\d{2})/.exec(v ?? '');
  if (!m) {
    issues.push(error('serviceDate', 'missing-date', 'Service date missing'));
    return null;
  }
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) {
    issues.push(error('serviceDate', 'bad-date', `"${m[0]}" is not a real date`));
    return null;
  }
  const iso = m[0];
  if (today && iso < today) issues.push(review('serviceDate', 'past-date', 'Service date has already passed'));
  return iso;
}

function parseWindow(v: string | undefined, issues: Issue[]): Assignment['pickupWindow'] {
  const m = WINDOW_RE.exec(v ?? '');
  if (!m) {
    issues.push(error('pickupWindow', 'missing-time', 'Pickup time missing'));
    return null;
  }
  const [, h1, m1, a1, h2, m2, a2] = m;
  if (!a1 && !a2) issues.push(review('pickupWindow', 'no-meridiem', 'No AM/PM in the pickup time: check it'));

  const end = h2 ? to24h(Number(h2), Number(m2), a2 ?? a1) : null;
  let start = to24h(Number(h1), Number(m1), a1 ?? a2);
  // "11:30 - 12:15 PM" means 11:30 AM: if borrowing the end's AM/PM puts start after end, flip it.
  if (!a1 && a2 && start && end && start > end) {
    start = to24h(Number(h1), Number(m1), a2.toLowerCase() === 'p' ? 'a' : 'p');
  }

  const finish = h2 ? end : start;
  if (!start || !finish) {
    issues.push(error('pickupWindow', 'bad-time', `Couldn't read the pickup time "${v}"`));
    return null;
  }
  if (finish < start) issues.push(review('pickupWindow', 'window-order', 'Pickup window ends before it starts'));
  return { start, end: finish };
}

function parseTransportType(
  v: string | undefined,
  issues: Issue[],
): { transportType: string | null; legs: Leg[] } {
  const transportType = v ? v.toLowerCase() : null;
  if (!transportType) {
    issues.push(error('transportType', 'missing-type', 'Transport type missing'));
    return { transportType: null, legs: [] };
  }
  const legs = legsForType(transportType);
  if (!legs) {
    issues.push(review('transportType', 'unknown-type', `Unknown transport type "${v}": choose the trips by hand`));
    return { transportType, legs: [] };
  }
  return { transportType, legs };
}

function to24h(h: number, m: number, meridiem: string | undefined): string | null {
  if (m > 59) return null;
  if (meridiem) {
    if (h < 1 || h > 12) return null;
    const pm = meridiem.toLowerCase() === 'p';
    return `${pad((h % 12) + (pm ? 12 : 0))}:${pad(m)}`;
  }
  return h > 23 ? null : `${pad(h)}:${pad(m)}`;
}

function required(
  v: string | undefined,
  field: string,
  code: IssueCode,
  message: string,
  issues: Issue[],
): string | null {
  if (v) return v;
  issues.push(error(field, code, message));
  return null;
}

function normalize(text: string): string {
  return text
    .replace(/[   ]/g, ' ')
    .replace(/[‐-―−]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/\s+/g, ' ').trim();
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function error(field: string, code: IssueCode, message: string): Issue {
  return { field, severity: 'error', code, message };
}

function review(field: string, code: IssueCode, message: string): Issue {
  return { field, severity: 'review', code, message };
}
