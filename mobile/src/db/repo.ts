import type { SQLiteDatabase } from 'expo-sqlite';

import {
  sameAddress,
  type AssignmentStatus,
  type ExistingAssignment,
  type ImportPlan,
  type ImportSummary,
  type KnownRegular,
} from '@/core/importer';
import type { Issue, Leg } from '@/core/parser/assignmentParser';
import type { Point } from '@/core/route';
import type { RideFields } from '@/core/validate';

import { newId, notifyChanged, nowStamp } from './events';

export type RideSource = 'paste' | 'link' | 'shortcut' | 'share' | 'screenshot' | 'manual' | 'ai';
export type TripStatus = 'pending' | 'done' | 'no-show';

export interface Ride {
  id: string;
  dedupeKey: string | null;
  regularId: string | null;
  passengerName: string | null;
  phone: string | null;
  persons: number | null;
  serviceDate: string | null;
  windowStart: string | null;
  windowEnd: string | null;
  transportType: string | null;
  legs: Leg[];
  pickupAddress: string | null;
  addressKind: 'street' | 'place' | null;
  geoLat: number | null;
  geoLng: number | null;
  status: AssignmentStatus;
  issues: Issue[];
  rawText: string | null;
  source: RideSource;
  createdAt: string;
  updatedAt: string;
}

export interface Regular {
  id: string;
  name: string;
  phone: string | null;
  pickupAddress: string | null;
  spotLat: number | null;
  spotLng: number | null;
  spotSaved: boolean;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface Trip {
  assignmentId: string;
  leg: Leg;
  status: TripStatus;
  sortOrder: number | null;
  /** When this trip's status or order last changed (ISO). */
  updatedAt: string;
  ride: Ride;
  regular: Regular | null;
}

export interface Notice {
  id: string;
  hint: 'cancellation' | 'update';
  assignmentId: string | null;
  passengerName: string | null;
  serviceDate: string | null;
  rawText: string;
  /** What to check, when ChurchRide knows. */
  details: string | null;
  resolved: boolean;
  createdAt: string;
}

type Row = Record<string, unknown>;

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function parseJson<T>(v: unknown, fallback: T): T {
  if (typeof v !== 'string') return fallback;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
}

function toRide(row: Row): Ride {
  const kind = str(row.address_kind);
  return {
    id: String(row.id),
    dedupeKey: str(row.dedupe_key),
    regularId: str(row.regular_id),
    passengerName: str(row.passenger_name),
    phone: str(row.phone),
    persons: num(row.persons),
    serviceDate: str(row.service_date),
    windowStart: str(row.window_start),
    windowEnd: str(row.window_end),
    transportType: str(row.transport_type),
    legs: parseJson<Leg[]>(row.legs, []),
    pickupAddress: str(row.pickup_address),
    addressKind: kind === 'street' || kind === 'place' ? kind : null,
    geoLat: num(row.geo_lat),
    geoLng: num(row.geo_lng),
    status: (str(row.status) as AssignmentStatus | null) ?? 'review',
    issues: parseJson<Issue[]>(row.issues, []),
    rawText: str(row.raw_text),
    source: (str(row.source) as RideSource | null) ?? 'paste',
    createdAt: String(row.created_at ?? ''),
    updatedAt: String(row.updated_at ?? ''),
  };
}

function toRegular(row: Row, prefix = ''): Regular {
  const get = (k: string) => row[`${prefix}${k}`];
  return {
    id: String(get('id')),
    name: String(get('name') ?? ''),
    phone: str(get('phone')),
    pickupAddress: str(get('pickup_address')),
    spotLat: num(get('spot_lat')),
    spotLng: num(get('spot_lng')),
    spotSaved: get('spot_saved') === 1,
    notes: String(get('notes') ?? ''),
    createdAt: String(get('created_at') ?? ''),
    updatedAt: String(get('updated_at') ?? ''),
  };
}

function toNotice(row: Row): Notice {
  return {
    id: String(row.id),
    hint: row.hint === 'cancellation' ? 'cancellation' : 'update',
    assignmentId: str(row.assignment_id),
    passengerName: str(row.passenger_name),
    serviceDate: str(row.service_date),
    rawText: String(row.raw_text ?? ''),
    details: str(row.details),
    resolved: row.resolved === 1,
    createdAt: String(row.created_at ?? ''),
  };
}

/** Where to send Maps for this stop: the saved spot if it matches the address, else the address. */
export function stopPoint(trip: Pick<Trip, 'ride' | 'regular'>): Point | null {
  const { ride, regular } = trip;
  if (
    regular?.spotSaved &&
    regular.spotLat !== null &&
    regular.spotLng !== null &&
    sameAddress(regular.pickupAddress, ride.pickupAddress)
  ) {
    return { lat: regular.spotLat, lng: regular.spotLng };
  }
  if (ride.geoLat !== null && ride.geoLng !== null) return { lat: ride.geoLat, lng: ride.geoLng };
  return null;
}

export function hasSavedSpot(trip: Pick<Trip, 'ride' | 'regular'>): boolean {
  const { ride, regular } = trip;
  return !!regular?.spotSaved && sameAddress(regular.pickupAddress, ride.pickupAddress);
}

// ---------- Rides ----------

export async function getRide(db: SQLiteDatabase, id: string): Promise<Ride | null> {
  const row = await db.getFirstAsync<Row>('SELECT * FROM assignments WHERE id = ?', id);
  return row ? toRide(row) : null;
}

export async function listRidesByStatus(db: SQLiteDatabase, status: AssignmentStatus): Promise<Ride[]> {
  const rows = await db.getAllAsync<Row>(
    'SELECT * FROM assignments WHERE status = ? ORDER BY service_date, window_start, passenger_name',
    status,
  );
  return rows.map(toRide);
}

export async function listRidesForRegular(db: SQLiteDatabase, regularId: string): Promise<Ride[]> {
  const rows = await db.getAllAsync<Row>(
    'SELECT * FROM assignments WHERE regular_id = ? ORDER BY service_date DESC, window_start',
    regularId,
  );
  return rows.map(toRide);
}

/** Rides waiting for review plus unresolved notices: the Inbox badge. */
export async function countInbox(db: SQLiteDatabase): Promise<number> {
  const row = await db.getFirstAsync<{ n: number }>(
    `SELECT (SELECT COUNT(*) FROM assignments WHERE status = 'review') +
            (SELECT COUNT(*) FROM notices WHERE resolved = 0) AS n`,
  );
  return row?.n ?? 0;
}

export async function listUpcomingDates(db: SQLiteDatabase, fromDate: string): Promise<string[]> {
  const rows = await db.getAllAsync<{ service_date: string }>(
    `SELECT DISTINCT service_date FROM assignments
     WHERE status = 'confirmed' AND service_date >= ? ORDER BY service_date LIMIT 12`,
    fromDate,
  );
  return rows.map((r) => r.service_date);
}

export async function listTripsForDate(db: SQLiteDatabase, date: string): Promise<Trip[]> {
  const rows = await db.getAllAsync<Row>(
    `SELECT a.*, t.leg AS trip_leg, t.status AS trip_status, t.sort_order AS trip_sort, t.updated_at AS trip_updated,
            r.id AS r_id, r.name AS r_name, r.phone AS r_phone, r.pickup_address AS r_pickup_address,
            r.spot_lat AS r_spot_lat, r.spot_lng AS r_spot_lng, r.spot_saved AS r_spot_saved,
            r.notes AS r_notes, r.created_at AS r_created_at, r.updated_at AS r_updated_at
     FROM trips t
     JOIN assignments a ON a.id = t.assignment_id
     LEFT JOIN regulars r ON r.id = a.regular_id
     WHERE a.service_date = ? AND a.status = 'confirmed'
     ORDER BY t.leg DESC, (t.sort_order IS NULL), t.sort_order, a.window_start, a.passenger_name`,
    date,
  );
  return rows.map((row) => ({
    assignmentId: String(row.id),
    leg: row.trip_leg === 'from-church' ? 'from-church' : 'to-church',
    status: (str(row.trip_status) as TripStatus | null) ?? 'pending',
    sortOrder: num(row.trip_sort),
    updatedAt: String(row.trip_updated ?? ''),
    ride: toRide(row),
    regular: row.r_id ? toRegular(row, 'r_') : null,
  }));
}

export async function loadImportContext(
  db: SQLiteDatabase,
): Promise<{ existing: ExistingAssignment[]; regulars: KnownRegular[] }> {
  const rides = (await db.getAllAsync<Row>('SELECT * FROM assignments WHERE dedupe_key IS NOT NULL')).map(toRide);
  const regulars = (await db.getAllAsync<Row>('SELECT * FROM regulars')).map((r) => toRegular(r));
  return {
    existing: rides.map((r) => ({
      id: r.id,
      dedupeKey: r.dedupeKey,
      passengerName: r.passengerName,
      phone: r.phone,
      persons: r.persons,
      serviceDate: r.serviceDate,
      windowStart: r.windowStart,
      windowEnd: r.windowEnd,
      transportType: r.transportType,
      pickupAddress: r.pickupAddress,
      status: r.status,
    })),
    regulars: regulars.map((r) => ({
      id: r.id,
      phone: r.phone,
      pickupAddress: r.pickupAddress,
      spotSaved: r.spotSaved,
    })),
  };
}

export async function applyImportPlan(
  db: SQLiteDatabase,
  plan: ImportPlan,
  source: RideSource,
  /** A Siri/Shortcuts invocation ID, recorded with the import so a replay changes nothing. */
  idempotencyKey?: { id: string; name: string },
): Promise<ImportSummary> {
  const now = nowStamp();
  await db.withTransactionAsync(async () => {
    if (idempotencyKey) await recordInvocation(db, idempotencyKey.id, idempotencyKey.name, now);
    for (const action of plan.actions) {
      if (action.type === 'create' || action.type === 'changed') {
        const a = action.assignment;
        const values = [
          action.regularId,
          a.passengerName,
          a.phone,
          a.persons,
          a.serviceDate,
          a.pickupWindow?.start ?? null,
          a.pickupWindow?.end ?? null,
          a.transportType,
          JSON.stringify(a.legs),
          a.pickupAddress,
          a.addressKind,
          JSON.stringify(action.issues),
          a.raw,
        ];
        if (action.type === 'create') {
          await db.runAsync(
            `INSERT INTO assignments (id, dedupe_key, regular_id, passenger_name, phone, persons, service_date,
               window_start, window_end, transport_type, legs, pickup_address, address_kind, issues, raw_text,
               status, source, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'review', ?, ?, ?)`,
            [newId(), a.dedupeKey, ...values, source, now, now],
          );
        } else {
          await db.runAsync(
            `UPDATE assignments SET regular_id = ?, passenger_name = ?, phone = ?, persons = ?, service_date = ?,
               window_start = ?, window_end = ?, transport_type = ?, legs = ?, pickup_address = ?, address_kind = ?,
               issues = ?, raw_text = ?, geo_lat = NULL, geo_lng = NULL, status = 'review', updated_at = ?
             WHERE id = ?`,
            [...values, now, action.existingId],
          );
        }
      } else if (action.type === 'notice') {
        await db.runAsync(
          `INSERT INTO notices (id, hint, assignment_id, passenger_name, service_date, raw_text, details, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            newId(),
            action.hint,
            action.existingId,
            action.change.fields.passengerName,
            action.change.fields.serviceDate,
            action.change.raw,
            action.details ?? null,
            now,
          ],
        );
      }
    }
  });
  notifyChanged();
  return plan.summary;
}

export async function createManualRide(db: SQLiteDatabase, fields: RideFields, issues: Issue[]): Promise<string> {
  const id = newId();
  const now = nowStamp();
  await db.runAsync(
    `INSERT INTO assignments (id, dedupe_key, passenger_name, phone, persons, service_date, window_start, window_end,
       transport_type, legs, pickup_address, address_kind, issues, status, source, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'review', 'manual', ?, ?)`,
    [
      id,
      fields.dedupeKey,
      fields.passengerName,
      fields.phone,
      fields.persons,
      fields.serviceDate,
      fields.windowStart,
      fields.windowEnd,
      fields.transportType,
      JSON.stringify(fields.legs),
      fields.pickupAddress,
      fields.addressKind,
      JSON.stringify(issues),
      now,
      now,
    ],
  );
  notifyChanged();
  return id;
}

export async function updateRideFields(
  db: SQLiteDatabase,
  id: string,
  fields: RideFields,
  issues: Issue[],
): Promise<void> {
  const before = await getRide(db, id);
  const addressChanged = before ? !sameAddress(before.pickupAddress, fields.pickupAddress) : true;
  await db.runAsync(
    `UPDATE assignments SET dedupe_key = ?, passenger_name = ?, phone = ?, persons = ?, service_date = ?,
       window_start = ?, window_end = ?, transport_type = ?, legs = ?, pickup_address = ?, address_kind = ?,
       issues = ?, updated_at = ?,
       geo_lat = CASE WHEN ? THEN NULL ELSE geo_lat END,
       geo_lng = CASE WHEN ? THEN NULL ELSE geo_lng END
     WHERE id = ?`,
    [
      fields.dedupeKey,
      fields.passengerName,
      fields.phone,
      fields.persons,
      fields.serviceDate,
      fields.windowStart,
      fields.windowEnd,
      fields.transportType,
      JSON.stringify(fields.legs),
      fields.pickupAddress,
      fields.addressKind,
      JSON.stringify(issues),
      nowStamp(),
      addressChanged ? 1 : 0,
      addressChanged ? 1 : 0,
      id,
    ],
  );
  if (before?.status === 'confirmed') await syncTrips(db, id, fields.legs);
  notifyChanged();
}

export async function setRideIssues(db: SQLiteDatabase, id: string, issues: Issue[]): Promise<void> {
  await db.runAsync('UPDATE assignments SET issues = ?, updated_at = ? WHERE id = ?', [
    JSON.stringify(issues),
    nowStamp(),
    id,
  ]);
  notifyChanged();
}

export async function setRideGeo(db: SQLiteDatabase, id: string, point: Point): Promise<void> {
  await db.runAsync('UPDATE assignments SET geo_lat = ?, geo_lng = ? WHERE id = ?', [point.lat, point.lng, id]);
}

export async function confirmRide(db: SQLiteDatabase, id: string): Promise<void> {
  const ride = await getRide(db, id);
  if (!ride) return;
  await db.withTransactionAsync(async () => {
    await db.runAsync(`UPDATE assignments SET status = 'confirmed', updated_at = ? WHERE id = ?`, [nowStamp(), id]);
    await syncTrips(db, id, ride.legs);
  });
  notifyChanged();
}

export async function setRideStatus(db: SQLiteDatabase, id: string, status: AssignmentStatus): Promise<void> {
  await db.runAsync('UPDATE assignments SET status = ?, updated_at = ? WHERE id = ?', [status, nowStamp(), id]);
  notifyChanged();
}

export async function cancelRide(db: SQLiteDatabase, id: string): Promise<void> {
  await db.runAsync(`UPDATE assignments SET status = 'cancelled', updated_at = ? WHERE id = ?`, [nowStamp(), id]);
  notifyChanged();
}

export async function deleteRide(db: SQLiteDatabase, id: string): Promise<void> {
  await db.runAsync('DELETE FROM assignments WHERE id = ?', id);
  notifyChanged();
}

/** Makes the trips table match the ride's legs, keeping the status of trips that stay. */
async function syncTrips(db: SQLiteDatabase, id: string, legs: Leg[]): Promise<void> {
  const now = nowStamp();
  for (const leg of legs) {
    await db.runAsync(
      'INSERT OR IGNORE INTO trips (assignment_id, leg, status, updated_at) VALUES (?, ?, ?, ?)',
      [id, leg, 'pending', now],
    );
  }
  const placeholders = legs.map(() => '?').join(', ') || "''";
  await db.runAsync(`DELETE FROM trips WHERE assignment_id = ? AND leg NOT IN (${placeholders})`, [id, ...legs]);
}

export async function setTripStatus(db: SQLiteDatabase, assignmentId: string, leg: Leg, status: TripStatus) {
  await db.runAsync('UPDATE trips SET status = ?, updated_at = ? WHERE assignment_id = ? AND leg = ?', [
    status,
    nowStamp(),
    assignmentId,
    leg,
  ]);
  notifyChanged();
}

/** Saves a visiting order for one leg of the day's trips. */
export async function setTripOrder(db: SQLiteDatabase, leg: Leg, orderedAssignmentIds: string[]): Promise<void> {
  await db.withTransactionAsync(async () => {
    for (const [index, assignmentId] of orderedAssignmentIds.entries()) {
      await db.runAsync('UPDATE trips SET sort_order = ? WHERE assignment_id = ? AND leg = ?', [
        index,
        assignmentId,
        leg,
      ]);
    }
  });
  notifyChanged();
}

// ---------- Siri and Shortcuts actions ----------

export async function isInvocationProcessed(db: SQLiteDatabase, id: string): Promise<boolean> {
  const row = await db.getFirstAsync<{ id: string }>('SELECT id FROM processed_invocations WHERE id = ?', id);
  return row !== null;
}

async function recordInvocation(db: SQLiteDatabase, id: string, name: string, at: string): Promise<void> {
  await db.runAsync('INSERT INTO processed_invocations (id, name, processed_at) VALUES (?, ?, ?)', [id, name, at]);
}

export type OnceResult = 'applied' | 'already-applied' | 'no-such-trip';

/** Sets a trip's status for a Siri action exactly once, recording the action in the same transaction. */
export async function setTripStatusOnce(
  db: SQLiteDatabase,
  args: { assignmentId: string; leg: Leg; status: TripStatus; invocationId: string },
): Promise<OnceResult> {
  let result: OnceResult = 'applied';
  await db.withTransactionAsync(async () => {
    if (await isInvocationProcessed(db, args.invocationId)) {
      result = 'already-applied';
      return;
    }
    const now = nowStamp();
    const trip = await db.getFirstAsync<{ status: string }>(
      'SELECT status FROM trips WHERE assignment_id = ? AND leg = ?',
      [args.assignmentId, args.leg],
    );
    if (!trip) {
      result = 'no-such-trip';
    } else {
      await db.runAsync('UPDATE trips SET status = ?, updated_at = ? WHERE assignment_id = ? AND leg = ?', [
        args.status,
        now,
        args.assignmentId,
        args.leg,
      ]);
    }
    await recordInvocation(db, args.invocationId, 'setTripStatus', now);
  });
  if (result === 'applied') notifyChanged();
  return result;
}

// ---------- Notices ----------

export async function listOpenNotices(db: SQLiteDatabase): Promise<Notice[]> {
  const rows = await db.getAllAsync<Row>('SELECT * FROM notices WHERE resolved = 0 ORDER BY created_at DESC');
  return rows.map(toNotice);
}

export async function resolveNotice(db: SQLiteDatabase, id: string): Promise<void> {
  await db.runAsync('UPDATE notices SET resolved = 1 WHERE id = ?', id);
  notifyChanged();
}

// ---------- Regulars ----------

export async function listRegulars(db: SQLiteDatabase): Promise<Regular[]> {
  const rows = await db.getAllAsync<Row>('SELECT * FROM regulars ORDER BY name COLLATE NOCASE');
  return rows.map((r) => toRegular(r));
}

export async function getRegular(db: SQLiteDatabase, id: string): Promise<Regular | null> {
  const row = await db.getFirstAsync<Row>('SELECT * FROM regulars WHERE id = ?', id);
  return row ? toRegular(row) : null;
}

/**
 * Links a ride to its regular (by phone), creating the regular on first sight.
 * A new pickup address clears a saved spot, since the spot belongs to the old address.
 */
export async function upsertRegularForRide(db: SQLiteDatabase, ride: Ride): Promise<Regular | null> {
  if (!ride.phone) return null;
  const now = nowStamp();
  const row = await db.getFirstAsync<Row>('SELECT * FROM regulars WHERE phone = ?', ride.phone);
  let id: string;
  if (row) {
    const regular = toRegular(row);
    id = regular.id;
    const moved = !sameAddress(regular.pickupAddress, ride.pickupAddress);
    await db.runAsync(
      `UPDATE regulars SET name = ?, pickup_address = ?, updated_at = ?,
         spot_saved = CASE WHEN ? THEN 0 ELSE spot_saved END,
         spot_lat = CASE WHEN ? THEN NULL ELSE spot_lat END,
         spot_lng = CASE WHEN ? THEN NULL ELSE spot_lng END
       WHERE id = ?`,
      [
        ride.passengerName ?? regular.name,
        ride.pickupAddress,
        now,
        moved ? 1 : 0,
        moved ? 1 : 0,
        moved ? 1 : 0,
        id,
      ],
    );
  } else {
    id = newId();
    await db.runAsync(
      `INSERT INTO regulars (id, name, phone, pickup_address, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
      [id, ride.passengerName ?? 'Rider', ride.phone, ride.pickupAddress, now, now],
    );
  }
  await db.runAsync('UPDATE assignments SET regular_id = ? WHERE id = ?', [id, ride.id]);
  return getRegular(db, id);
}

export async function updateRegular(
  db: SQLiteDatabase,
  id: string,
  patch: { name: string; pickupAddress: string | null; notes: string },
): Promise<void> {
  const before = await getRegular(db, id);
  const moved = before ? !sameAddress(before.pickupAddress, patch.pickupAddress) : false;
  await db.runAsync(
    `UPDATE regulars SET name = ?, pickup_address = ?, notes = ?, updated_at = ?,
       spot_saved = CASE WHEN ? THEN 0 ELSE spot_saved END,
       spot_lat = CASE WHEN ? THEN NULL ELSE spot_lat END,
       spot_lng = CASE WHEN ? THEN NULL ELSE spot_lng END
     WHERE id = ?`,
    [patch.name, patch.pickupAddress, patch.notes, nowStamp(), moved ? 1 : 0, moved ? 1 : 0, moved ? 1 : 0, id],
  );
  notifyChanged();
}

export async function saveRegularSpot(db: SQLiteDatabase, id: string, point: Point): Promise<void> {
  await db.runAsync(
    'UPDATE regulars SET spot_lat = ?, spot_lng = ?, spot_saved = 1, updated_at = ? WHERE id = ?',
    [point.lat, point.lng, nowStamp(), id],
  );
  notifyChanged();
}

export async function clearRegularSpot(db: SQLiteDatabase, id: string): Promise<void> {
  await db.runAsync(
    'UPDATE regulars SET spot_lat = NULL, spot_lng = NULL, spot_saved = 0, updated_at = ? WHERE id = ?',
    [nowStamp(), id],
  );
  notifyChanged();
}

export async function deleteRegular(db: SQLiteDatabase, id: string): Promise<void> {
  await db.runAsync('DELETE FROM regulars WHERE id = ?', id);
  notifyChanged();
}

// ---------- Backup ----------

export async function exportAll(db: SQLiteDatabase): Promise<Record<string, unknown>> {
  const [regulars, assignments, trips, notices, settings] = await Promise.all([
    db.getAllAsync<Row>('SELECT * FROM regulars'),
    db.getAllAsync<Row>('SELECT * FROM assignments'),
    db.getAllAsync<Row>('SELECT * FROM trips'),
    db.getAllAsync<Row>('SELECT * FROM notices'),
    db.getAllAsync<Row>(`SELECT * FROM settings WHERE key != 'aiToken'`),
  ]);
  return { app: 'ChurchRide', version: 1, exportedAt: nowStamp(), regulars, assignments, trips, notices, settings };
}
