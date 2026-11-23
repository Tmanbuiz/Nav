/**
 * Ride workflows that combine storage with the phone's geocoder:
 * importing texts, approving rides, and ordering a day's stops.
 */
import type { SQLiteDatabase } from 'expo-sqlite';

import { planImport, type ImportSummary } from '@/core/importer';
import { parseAssignmentMessages, type Assignment, type Leg } from '@/core/parser/assignmentParser';
import { distanceKm, suggestOrder, type Point } from '@/core/route';
import { todayISO } from '@/core/time';
import { assignmentFromAi, type AiRide } from '@/core/validate';
import {
  applyImportPlan,
  confirmRide,
  getRide,
  loadImportContext,
  setRideGeo,
  setRideIssues,
  setTripOrder,
  stopPoint,
  upsertRegularForRide,
  type RideSource,
  type Trip,
} from '@/db/repo';
import { loadSettings, saveSettings, type Settings } from '@/db/settings';

import { geocode } from './geo';

/** A pickup further than this from the church is held for a second look. */
export const FAR_FROM_CHURCH_KM = 60;

/** Imports run one at a time, so texts arriving together can't trip over each other. */
let importQueue: Promise<unknown> = Promise.resolve();

function serialized<T>(task: () => Promise<T>): Promise<T> {
  const run = importQueue.then(task);
  importQueue = run.catch(() => undefined);
  return run;
}

export function importText(db: SQLiteDatabase, text: string, source: RideSource): Promise<ImportSummary> {
  return serialized(() => importTextNow(db, text, source));
}

export function importAiRides(db: SQLiteDatabase, rides: AiRide[], raw: string): Promise<ImportSummary> {
  return serialized(() => importAiRidesNow(db, rides, raw));
}

async function importTextNow(db: SQLiteDatabase, text: string, source: RideSource): Promise<ImportSummary> {
  const settings = await loadSettings(db);
  const results = parseAssignmentMessages(text, {
    expectedDriverName: settings.driverName.trim() || undefined,
    today: todayISO(),
    expectedProvince: settings.province.trim() || undefined,
  });
  const { existing, regulars } = await loadImportContext(db);
  return applyImportPlan(db, planImport(results, existing, regulars), source);
}

async function importAiRidesNow(db: SQLiteDatabase, rides: AiRide[], raw: string): Promise<ImportSummary> {
  const settings = await loadSettings(db);
  const assignments: Assignment[] = rides.map((r) =>
    assignmentFromAi(r, raw, { today: todayISO(), province: settings.province.trim() || undefined }),
  );
  const { existing, regulars } = await loadImportContext(db);
  return applyImportPlan(db, planImport(assignments, existing, regulars), 'ai');
}

/** Church coordinates, geocoding the saved address once if needed. */
export async function churchPoint(db: SQLiteDatabase, settings?: Settings): Promise<Point | null> {
  const s = settings ?? (await loadSettings(db));
  if (s.churchLat !== null && s.churchLng !== null) return { lat: s.churchLat, lng: s.churchLng };
  const point = await geocode(s.churchAddress);
  if (point) await saveSettings(db, { churchLat: point.lat, churchLng: point.lng });
  return point;
}

export async function homePoint(db: SQLiteDatabase, settings?: Settings): Promise<Point | null> {
  const s = settings ?? (await loadSettings(db));
  if (s.homeLat !== null && s.homeLng !== null) return { lat: s.homeLat, lng: s.homeLng };
  const point = await geocode(s.homeAddress);
  if (point) await saveSettings(db, { homeLat: point.lat, homeLng: point.lng });
  return point;
}

export type ApproveResult = { ok: true } | { ok: false; reason: string };

/**
 * Confirms a ride: links or creates the regular, finds the pickup's location and
 * checks it isn't far from the church. A far pickup is held once with a flag;
 * approving again with the flag showing confirms it.
 */
export async function approveRide(db: SQLiteDatabase, id: string): Promise<ApproveResult> {
  const ride = await getRide(db, id);
  if (!ride) return { ok: false, reason: 'This ride no longer exists.' };
  if (ride.issues.some((i) => i.severity === 'error')) {
    return { ok: false, reason: 'Fix the items marked in red first (tap Edit).' };
  }
  if (!ride.legs.length) return { ok: false, reason: 'Choose to church, from church, or both (tap Edit).' };

  const regular = await upsertRegularForRide(db, ride);
  let point = stopPoint({ ride, regular });
  if (!point) {
    point = await geocode(ride.pickupAddress);
    if (point) await setRideGeo(db, id, point);
  }

  const church = await churchPoint(db);
  if (point && church && !ride.issues.some((i) => i.code === 'far-from-church')) {
    const km = distanceKm(point, church);
    if (km > FAR_FROM_CHURCH_KM) {
      await setRideIssues(db, id, [
        ...ride.issues,
        {
          field: 'pickupAddress',
          severity: 'review',
          code: 'far-from-church',
          message: `About ${Math.round(km)} km from the church: check the address`,
        },
      ]);
      return {
        ok: false,
        reason: `This pickup looks about ${Math.round(km)} km from the church. Check the address, then approve again if it’s right.`,
      };
    }
  }

  await confirmRide(db, id);
  return { ok: true };
}

/**
 * Orders one leg's pending stops by straight-line distance and saves the order.
 * Looks up any missing locations first. Returns how many stops had no location.
 */
export async function suggestDayOrder(db: SQLiteDatabase, trips: Trip[], leg: Leg): Promise<{ unlocated: number }> {
  const legTrips = trips.filter((t) => t.leg === leg);
  const pending = legTrips.filter((t) => t.status === 'pending');
  const finished = legTrips.filter((t) => t.status !== 'pending');

  const points: (Point | null)[] = [];
  for (const trip of pending) {
    let point = stopPoint(trip);
    if (!point) {
      point = await geocode(trip.ride.pickupAddress);
      if (point) await setRideGeo(db, trip.assignmentId, point);
    }
    points.push(point);
  }

  const church = await churchPoint(db);
  const home = leg === 'to-church' ? await homePoint(db) : null;
  const order = suggestOrder(points, leg === 'to-church' ? { start: home, end: church } : { start: church });
  const orderedIds = [
    ...finished.map((t) => t.assignmentId),
    ...order.map((i) => pending[i]?.assignmentId).filter((v): v is string => !!v),
  ];
  await setTripOrder(db, leg, orderedIds);
  return { unlocated: points.filter((p) => p === null).length };
}
