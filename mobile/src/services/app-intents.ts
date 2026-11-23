/**
 * Connects ChurchRide to expo-app-intents: drains the queue of Siri and Shortcuts actions and
 * publishes the day's stops for the Swift intents. Does nothing where App Intents aren't
 * available (Expo Go, Android, web).
 */
import * as AppIntents from 'expo-app-intents';
import type { SQLiteDatabase } from 'expo-sqlite';

import { STOP_CATALOG_KIND } from '@/core/siri';

import { handleInvocation, loadStopRecords, type Invocation } from './intents';

let draining: Promise<void> = Promise.resolve();

/**
 * Applies queued actions one at a time, oldest first. Several callers (the hook, a foreground
 * check) can ask at once; they all run through the same chain, and each action is recorded in
 * the database, so nothing is applied twice.
 */
export function drainIntents(db: SQLiteDatabase, pending: Invocation[]): Promise<void> {
  const run = draining.then(async () => {
    const oldestFirst = [...pending].sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
    for (const inv of oldestFirst) {
      try {
        await handleInvocation(db, inv);
        await AppIntents.removePendingInvocationAsync(inv.id);
      } catch (error) {
        // Temporary failure: it stays queued and is retried on the next launch or foreground.
        console.warn('Siri/Shortcuts action kept for retry', inv.name, error);
      }
    }
  });
  draining = run.catch(() => undefined);
  return run;
}

/** Re-reads the queue, for when the app returns to the foreground. */
export async function drainPendingIntents(db: SQLiteDatabase): Promise<void> {
  if (!AppIntents.isAvailable()) return;
  const pending = await AppIntents.getPendingInvocationsAsync();
  if (pending.length) await drainIntents(db, pending);
}

let publishing: Promise<void> | null = null;
let publishAgain = false;

/** Publishes the day's stops. Calls that arrive mid-publish are folded into one more pass. */
export function publishStopCatalog(db: SQLiteDatabase): Promise<void> {
  if (!AppIntents.isAvailable()) return Promise.resolve();
  if (publishing) {
    publishAgain = true;
    return publishing;
  }
  publishing = (async () => {
    do {
      publishAgain = false;
      const records = await loadStopRecords(db);
      await AppIntents.setEntityCatalogAsync(STOP_CATALOG_KIND, records);
    } while (publishAgain);
  })().finally(() => {
    publishing = null;
  });
  return publishing;
}
