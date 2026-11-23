/**
 * What ChurchRide does with Siri and Shortcuts actions, and what it tells Siri about the day.
 * No native imports here, so it can be tested on its own; app-intents.ts wires it to iOS.
 * Dispatch names and params must match the Swift intents in app-intents/.
 */
import type { SQLiteDatabase } from 'expo-sqlite';

import { buildStopRecords, type StopRecord } from '@/core/siri';
import { todayISO } from '@/core/time';
import { isInvocationProcessed, listTripsForDate, listUpcomingDates, setTripStatusOnce } from '@/db/repo';

import { importText } from './rides';

export interface Invocation {
  id: string;
  name: string;
  params: Record<string, unknown>;
  /** Unix milliseconds. Actions are applied oldest first, so a later correction wins. */
  createdAt?: number;
}

/**
 * done: applied (or already applied before), remove it from the queue.
 * discard: can never be applied (bad input, unknown action, ride gone), remove it.
 * Throwing means a temporary failure: leave it queued and try again later.
 */
export type Outcome = 'done' | 'discard';

export async function handleInvocation(db: SQLiteDatabase, inv: Invocation): Promise<Outcome> {
  if (await isInvocationProcessed(db, inv.id)) return 'done';

  switch (inv.name) {
    case 'addAssignmentText': {
      const text = inv.params.text;
      if (typeof text !== 'string' || !text.trim()) return 'discard';
      await importText(db, text, 'shortcut', { id: inv.id, name: inv.name });
      return 'done';
    }
    case 'setTripStatus': {
      const { assignmentId, leg, status } = inv.params;
      if (
        typeof assignmentId !== 'string' ||
        (leg !== 'to-church' && leg !== 'from-church') ||
        (status !== 'done' && status !== 'no-show' && status !== 'pending')
      ) {
        return 'discard';
      }
      const result = await setTripStatusOnce(db, { assignmentId, leg, status, invocationId: inv.id });
      return result === 'no-such-trip' ? 'discard' : 'done';
    }
    default:
      return 'discard';
  }
}

/** The next service day's run (today or later), in the order shown on the Today screen. */
export async function loadStopRecords(db: SQLiteDatabase): Promise<StopRecord[]> {
  const [date] = await listUpcomingDates(db, todayISO());
  if (!date) return [];
  const trips = await listTripsForDate(db, date);
  const ordered = [...trips.filter((t) => t.leg === 'to-church'), ...trips.filter((t) => t.leg === 'from-church')];
  return buildStopRecords(
    ordered.map((t) => ({
      assignmentId: t.assignmentId,
      leg: t.leg,
      status: t.status,
      passengerName: t.ride.passengerName,
      pickupAddress: t.ride.pickupAddress,
      windowStart: t.ride.windowStart,
      windowEnd: t.ride.windowEnd,
      serviceDate: date,
      statusUpdatedAt: t.updatedAt,
    })),
  );
}
