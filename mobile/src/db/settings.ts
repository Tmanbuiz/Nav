import type { SQLiteDatabase } from 'expo-sqlite';

import type { MapsApp } from '@/core/maps';

import { notifyChanged } from './events';

export interface Settings {
  /** Your name as the church's texts spell it, e.g. "Jane Example". */
  driverName: string;
  churchName: string;
  churchAddress: string;
  churchLat: number | null;
  churchLng: number | null;
  /** Where you usually leave from, for leave-by estimates. Optional. */
  homeAddress: string;
  homeLat: number | null;
  homeLng: number | null;
  /** Rider seats in your car (not counting you). */
  seats: number;
  mapsApp: MapsApp;
  /** When service usually ends, "HH:MM", shown for return trips. */
  serviceEnd: string;
  /** Province code for the out-of-province address check. */
  province: string;
  onMyWayText: string;
  outsideText: string;
  /** Cloudflare Worker base URL for the AI fallback, e.g. https://churchride-ai.<you>.workers.dev */
  aiUrl: string;
  aiToken: string;
}

export const DEFAULT_SETTINGS: Settings = {
  driverName: '',
  churchName: '',
  churchAddress: '',
  churchLat: null,
  churchLng: null,
  homeAddress: '',
  homeLat: null,
  homeLng: null,
  seats: 4,
  mapsApp: 'apple',
  serviceEnd: '12:30',
  province: 'NB',
  onMyWayText: "Hi {first}, it's {driver}, your ride to church. I'm on my way.",
  outsideText: "Hi {first}, it's {driver}. I'm outside.",
  aiUrl: '',
  aiToken: '',
};

type Key = keyof Settings;

export async function loadSettings(db: SQLiteDatabase): Promise<Settings> {
  const rows = await db.getAllAsync<{ key: string; value: string }>('SELECT key, value FROM settings');
  const loaded: Partial<Record<Key, unknown>> = {};
  for (const row of rows) {
    if (row.key in DEFAULT_SETTINGS) {
      try {
        loaded[row.key as Key] = JSON.parse(row.value);
      } catch {
        // Ignore a corrupted value and fall back to the default.
      }
    }
  }
  return { ...DEFAULT_SETTINGS, ...(loaded as Partial<Settings>) };
}

export async function saveSettings(db: SQLiteDatabase, patch: Partial<Settings>): Promise<void> {
  await db.withTransactionAsync(async () => {
    for (const [key, value] of Object.entries(patch)) {
      if (!(key in DEFAULT_SETTINGS) || value === undefined) continue;
      await db.runAsync(
        'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
        key,
        JSON.stringify(value),
      );
    }
  });
  notifyChanged();
}
