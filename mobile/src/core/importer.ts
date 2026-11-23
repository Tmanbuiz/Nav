/**
 * Decides what an import does, without touching storage: create new assignments,
 * update changed ones, skip duplicates, raise change notices, ignore other texts.
 * The storage layer applies the plan. Everything new or changed lands in review.
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
  | { type: 'notice'; hint: PossibleChange['hint']; existingId: string | null; change: PossibleChange }
  | { type: 'ignored'; raw: string };

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

export function planImport(
  results: ParseResult[],
  existing: ExistingAssignment[],
  regulars: KnownRegular[],
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
    const issues = result.issues.filter(
      (i) =>
        !(
          i.code === 'place-address' &&
          regular?.spotSaved &&
          sameAddress(regular.pickupAddress, result.pickupAddress)
        ),
    );
    const regularId = regular?.id ?? null;
    const current = key ? byKey.get(key) : undefined;

    if (!current) {
      actions.push({ type: 'create', assignment: result, regularId, issues });
      continue;
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

function describeChanges(current: ExistingAssignment, next: Assignment): string[] {
  const changes: string[] = [];
  if (current.status === 'cancelled') changes.push('it was cancelled before');
  if (!sameName(current.passengerName, next.passengerName)) changes.push('name');
  if ((current.persons ?? null) !== (next.persons ?? null)) changes.push('number of persons');
  if (
    (current.windowStart ?? null) !== (next.pickupWindow?.start ?? null) ||
    (current.windowEnd ?? null) !== (next.pickupWindow?.end ?? null)
  ) {
    changes.push('pickup time');
  }
  if ((current.transportType ?? null) !== (next.transportType ?? null)) changes.push('transport type');
  if (!sameAddress(current.pickupAddress, next.pickupAddress)) changes.push('pickup address');
  return changes;
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
