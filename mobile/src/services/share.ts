/**
 * Imports what was shared to ChurchRide from the iOS share sheet (expo-sharing's share
 * extension). Texts go straight to the Inbox. Screenshots are read on the phone first, and
 * their rides are flagged for a closer check. Then the share is cleared, which also deletes
 * the copied pictures.
 */
import * as Sharing from 'expo-sharing';
import type { SQLiteDatabase } from 'expo-sqlite';

import { addSummaries, EMPTY_SUMMARY, type ImportSummary } from '@/core/importer';
import { sameShare, sortSharedPayloads, type SharedPayload } from '@/core/share';

import { importText } from './rides';
import { readScreenshotText } from './screenshot-text';

export interface SharedImport {
  summary: ImportSummary;
  /** Everything that was read, shared texts first, for the import screen's text box. */
  text: string;
  /** Pictures with no text ChurchRide could read. */
  unreadable: number;
  /** Items ChurchRide doesn't read: links, videos, other files. */
  skipped: number;
}

/** What's waiting to be imported. Always empty without the share extension (Expo Go). */
export function pendingShare(): SharedPayload[] {
  try {
    return Sharing.getSharedPayloads();
  } catch {
    return [];
  }
}

/** True in your own build, where ChurchRide shows up in the share sheet. */
export function shareSheetAvailable(): boolean {
  try {
    Sharing.getSharedPayloads();
    return true;
  } catch {
    return false;
  }
}

let running: Promise<SharedImport | null> | null = null;
let latest: { result: SharedImport; at: number } | null = null;

/**
 * Imports the waiting share, then clears it. Calls that overlap share one run, so nothing is
 * imported twice. Null when nothing was waiting. If the import fails, the share stays for a retry.
 */
export function importPendingShare(db: SQLiteDatabase): Promise<SharedImport | null> {
  running ??= importNow(db).finally(() => {
    running = null;
  });
  return running;
}

/** The last share imported in the past two minutes, for a screen that opened just after. */
export function recentSharedImport(now = Date.now()): SharedImport | null {
  return latest && now - latest.at < 2 * 60_000 ? latest.result : null;
}

async function importNow(db: SQLiteDatabase): Promise<SharedImport | null> {
  let total: SharedImport | null = null;
  // Something new can be shared while a share is being read. Clear only what was imported,
  // and go round again for the rest (three rounds at most).
  for (let round = 0; round < 3; round++) {
    const payloads = pendingShare();
    if (!payloads.length) break;
    const result = await importPayloads(db, payloads, readScreenshotText);
    total = total ? mergeImports(total, result) : result;
    if (sameShare(pendingShare(), payloads)) {
      try {
        Sharing.clearSharedPayloads();
      } catch (error) {
        // Already imported; a repeat next time only counts as "already saved".
        console.warn('Couldn’t clear the shared items', error);
      }
      break;
    }
  }
  if (total) latest = { result: total, at: Date.now() };
  return total;
}

/** Imports one share. `readImage` turns a picture into text; tests pass their own. */
export async function importPayloads(
  db: SQLiteDatabase,
  payloads: SharedPayload[],
  readImage: (uri: string) => Promise<string>,
): Promise<SharedImport> {
  const { texts, images, skipped } = sortSharedPayloads(payloads);
  let summary = EMPTY_SUMMARY;
  const read: string[] = [];
  let unreadable = 0;

  if (texts.length) {
    const text = texts.join('\n\n');
    summary = addSummaries(summary, await importText(db, text, 'share'));
    read.push(text);
  }

  for (const uri of images) {
    let text = '';
    try {
      text = (await readImage(uri)).trim();
    } catch {
      // Counted as unreadable below. The picture itself is never kept.
    }
    if (!text) {
      unreadable += 1;
      continue;
    }
    summary = addSummaries(summary, await importText(db, text, 'screenshot'));
    read.push(text);
  }

  return { summary, text: read.join('\n\n'), unreadable, skipped };
}

function mergeImports(a: SharedImport, b: SharedImport): SharedImport {
  return {
    summary: addSummaries(a.summary, b.summary),
    text: [a.text, b.text].filter(Boolean).join('\n\n'),
    unreadable: a.unreadable + b.unreadable,
    skipped: a.skipped + b.skipped,
  };
}
