/**
 * Decides what an import does, without touching storage: create new assignments,
 * update changed ones, skip duplicates, raise change notices, ignore other texts.
 * The storage layer applies the plan. Everything new or changed lands in review.
 *
 * Text read from a screenshot can be misread, so it is trusted less: its rides carry a
 * "screenshot" flag, and it never overwrites a saved value. It may only fill in what a saved
 * ride is missing; any other difference becomes a notice.
 */
import type { Assignment, Issue, ParseResult, PossibleChange } from './parser/assignmentParser';

export type AssignmentStatus = 'review' | 'confirmed' | 'cancelled';

export interface ExistingAssignment {
  id: string;
  dedupeKey: string | null;
  passengerName: string | null;
  phone: string | null;
  persons: number | null;
  serviceDate: string | null;
  windowStart: string | null;
  windowEnd: string | null;
  transportType: string | null;
  pickupAddress: string | null;
  status: AssignmentStatus;
}

export interface KnownRegular {
  id: string;
  phone: string | null;
  pickupAddress: string | null;
  /** The exact pickup spot has been saved for this address. */
  spotSaved: boolean;
}

export type ImportAction =
  | { type: 'create'; assignment: Assignment; regularId: string | null; issues: Issue[] }
  | {
      type: 'changed';
      existingId: string;
      assignment: Assignment;
      regularId: string | null;
      issues: Issue[];
      changes: string[];
    }
  | { type: 'duplicate'; existingId: string | null; passengerName: string | null }
  | {
      type: 'notice';
      hint: PossibleChange['hint'];
      existingId: string | null;
      change: PossibleChange;
      /** What to check, when ChurchRide knows: e.g. what a screenshot shows differently. */
      details?: string;
    }
  | { type: 'ignored'; raw: string };

export interface PlanOptions {
  /** The text was read from a screenshot (see the note at the top). */
  fromScreenshot?: boolean;
}

export const SCREENSHOT_ISSUE: Issue = {
  field: 'message',
  severity: 'review',
  code: 'screenshot',
  message: 'Read from a screenshot: check the name, phone number, time and address against it',
};

export interface ImportSummary {
  created: number;
  changed: number;
  duplicates: number;
  notices: number;
  ignored: number;
}

export interface ImportPlan {
  actions: ImportAction[];
  summary: ImportSummary;
}

export const EMPTY_SUMMARY: ImportSummary = { created: 0, changed: 0, duplicates: 0, notices: 0, ignored: 0 };

/** Two imports' counts together, e.g. several texts or screenshots shared at once. */
export function addSummaries(a: ImportSummary | null, b: ImportSummary): ImportSummary {
  if (!a) return b;
  return {
    created: a.created + b.created,
    changed: a.changed + b.changed,
    duplicates: a.duplicates + b.duplicates,
    notices: a.notices + b.notices,
    ignored: a.ignored + b.ignored,
  };
}

export function planImport(
  results: ParseResult[],
  existing: ExistingAssignment[],
  regulars: KnownRegular[],
  opts: PlanOptions = {},
): ImportPlan {
  const byKey = new Map(existing.filter((e) => e.dedupeKey).map((e) => [e.dedupeKey as string, e]));
  const regularByPhone = new Map(regulars.filter((r) => r.phone).map((r) => [r.phone as string, r]));
  // Texts arrive oldest first, so when one paste repeats an assignment the last copy is the newest.
  const lastIndexByKey = new Map<string, number>();
  results.forEach((r, i) => {
    if (r.kind === 'assignment' && r.dedupeKey) lastIndexByKey.set(r.dedupeKey, i);
  });
  const actions: ImportAction[] = [];

  for (const [index, result] of results.entries()) {
    if (result.kind === 'not-an-assignment') {
      actions.push({ type: 'ignored', raw: result.raw });
      continue;
    }

    if (result.kind === 'possible-change') {
      const target =
        (result.fields.dedupeKey ? byKey.get(result.fields.dedupeKey) : undefined) ??
        existing.find(
          (e) =>
            e.serviceDate === result.fields.serviceDate &&
            sameName(e.passengerName, result.fields.passengerName),
        );
      actions.push({ type: 'notice', hint: result.hint, existingId: target?.id ?? null, change: result });
      continue;
    }

    const key = result.dedupeKey;
    if (key && lastIndexByKey.get(key) !== index) {
      actions.push({ type: 'duplicate', existingId: byKey.get(key)?.id ?? null, passengerName: result.passengerName });
      continue;
    }

    const regular = result.phone ? regularByPhone.get(result.phone) : undefined;
    const parsedIssues = result.issues.filter(
      (i) =>
        !(
          i.code === 'place-address' &&
          regular?.spotSaved &&
          sameAddress(regular.pickupAddress, result.pickupAddress)
        ),
    );
    const issues = opts.fromScreenshot ? [SCREENSHOT_ISSUE, ...parsedIssues] : parsedIssues;
    const regularId = regular?.id ?? null;
    const current = key ? byKey.get(key) : undefined;

    if (!current) {
      actions.push({ type: 'create', assignment: result, regularId, issues });
      continue;
    }

    if (opts.fromScreenshot) {
      // Only what the picture actually shows counts: a message cut off at the edge of the
      // screen says nothing about the fields it lost.
      const shown = fieldChanges(current, result).filter((c) => !c.newEmpty);
      if (!shown.length) {
        actions.push({ type: 'duplicate', existingId: current.id, passengerName: result.passengerName });
        continue;
      }
      // A complete reading may fill in what a saved ride is missing (say, from an earlier
      // cut-off screenshot). Anything else would overwrite a value, so it becomes a notice.
      const fillsGapsOnly =
        current.status !== 'cancelled' &&
        shown.every((c) => c.savedEmpty) &&
        !result.issues.some((i) => i.severity === 'error');
      if (!fillsGapsOnly) {
        actions.push({
          type: 'notice',
          hint: 'update',
          existingId: current.id,
          change: asPossibleChange(result),
          details: screenshotMismatch(current, shown.map((c) => c.field)),
        });
        continue;
      }
    }

    const changes = describeChanges(current, result);
    if (!changes.length) {
      actions.push({ type: 'duplicate', existingId: current.id, passengerName: result.passengerName });
      continue;
    }
    actions.push({
      type: 'changed',
      existingId: current.id,
      assignment: result,
      regularId,
      changes,
      issues: [
        ...issues,
        {
          field: 'message',
          severity: 'review',
          code: 'changed',
          message: `Changed since you first got it: ${changes.join(', ')}`,
        },
      ],
    });
  }

  const count = (t: ImportAction['type']) => actions.filter((a) => a.type === t).length;
  return {
    actions,
    summary: {
      created: count('create'),
      changed: count('changed'),
      duplicates: count('duplicate'),
      notices: count('notice'),
      ignored: count('ignored'),
    },
  };
}

const CANCELLED_BEFORE = 'it was cancelled before';

interface FieldChange {
  field: string;
  /** The saved ride has no value here. */
  savedEmpty: boolean;
  /** The new copy has no value here. */
  newEmpty: boolean;
}

function fieldChanges(current: ExistingAssignment, next: Assignment): FieldChange[] {
  const changes: FieldChange[] = [];
  const empty = (v: unknown) => v === null || v === undefined || v === '';
  const check = (field: string, saved: unknown, incoming: unknown, same: boolean) => {
    if (!same) changes.push({ field, savedEmpty: empty(saved), newEmpty: empty(incoming) });
  };
  check('name', current.passengerName, next.passengerName, sameName(current.passengerName, next.passengerName));
  check('number of persons', current.persons, next.persons, (current.persons ?? null) === (next.persons ?? null));
  check(
    'pickup time',
    current.windowStart,
    next.pickupWindow,
    (current.windowStart ?? null) === (next.pickupWindow?.start ?? null) &&
      (current.windowEnd ?? null) === (next.pickupWindow?.end ?? null),
  );
  check('transport type', current.transportType, next.transportType, (current.transportType ?? null) === (next.transportType ?? null));
  check('pickup address', current.pickupAddress, next.pickupAddress, sameAddress(current.pickupAddress, next.pickupAddress));
  return changes;
}

function describeChanges(current: ExistingAssignment, next: Assignment): string[] {
  const changes = fieldChanges(current, next).map((c) => c.field);
  return current.status === 'cancelled' ? [CANCELLED_BEFORE, ...changes] : changes;
}

function screenshotMismatch(current: ExistingAssignment, fields: string[]): string {
  const parts = [`The screenshot doesn’t match the saved ride: ${joinList(fields)}.`];
  if (current.status === 'cancelled') parts.push('This ride was cancelled.');
  parts.push('The saved ride wasn’t changed. Open it to compare, and edit it if the screenshot is right.');
  return parts.join(' ');
}

function joinList(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function asPossibleChange(a: Assignment): PossibleChange {
  return {
    kind: 'possible-change',
    hint: 'update',
    fields: {
      passengerName: a.passengerName,
      phone: a.phone,
      serviceDate: a.serviceDate,
      pickupWindow: a.pickupWindow,
      pickupAddress: a.pickupAddress,
      dedupeKey: a.dedupeKey,
    },
    raw: a.raw,
  };
}

const STREET_WORDS: Record<string, string> = {
  street: 'st',
  drive: 'dr',
  avenue: 'ave',
  road: 'rd',
  crescent: 'cres',
  court: 'ct',
  boulevard: 'blvd',
  lane: 'ln',
  place: 'pl',
  terrace: 'terr',
};

/** Loose address comparison: case, punctuation, "Street"/"St", province name/code, "Canada". */
export function sameAddress(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return !a && !b;
  return normalizeAddress(a) === normalizeAddress(b);
}

export function normalizeAddress(address: string): string {
  return address
    .toLowerCase()
    .replace(/new brunswick/g, 'nb')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .map((w) => STREET_WORDS[w] ?? w)
    .filter((w) => w !== 'canada')
    .join(' ');
}

function sameName(a: string | null | undefined, b: string | null | undefined): boolean {
  const norm = (s: string | null | undefined) => (s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
  return norm(a) === norm(b);
}
