import type { SQLiteDatabase } from 'expo-sqlite';

/**
 * Each entry upgrades the database by one version (PRAGMA user_version).
 * Never edit a shipped migration: add a new one at the end.
 */
const MIGRATIONS: string[] = [
  `
  CREATE TABLE regulars (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    phone TEXT UNIQUE,
    pickup_address TEXT,
    spot_lat REAL,
    spot_lng REAL,
    spot_saved INTEGER NOT NULL DEFAULT 0,
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE assignments (
    id TEXT PRIMARY KEY NOT NULL,
    dedupe_key TEXT UNIQUE,
    regular_id TEXT REFERENCES regulars(id) ON DELETE SET NULL,
    passenger_name TEXT,
    phone TEXT,
    persons INTEGER,
    service_date TEXT,
    window_start TEXT,
    window_end TEXT,
    transport_type TEXT,
    legs TEXT NOT NULL DEFAULT '[]',
    pickup_address TEXT,
    address_kind TEXT,
    geo_lat REAL,
    geo_lng REAL,
    status TEXT NOT NULL DEFAULT 'review',
    issues TEXT NOT NULL DEFAULT '[]',
    raw_text TEXT,
    source TEXT NOT NULL DEFAULT 'paste',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX assignments_by_date ON assignments(service_date, status);

  CREATE TABLE trips (
    assignment_id TEXT NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
    leg TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    sort_order INTEGER,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (assignment_id, leg)
  );

  CREATE TABLE notices (
    id TEXT PRIMARY KEY NOT NULL,
    hint TEXT NOT NULL,
    assignment_id TEXT REFERENCES assignments(id) ON DELETE SET NULL,
    passenger_name TEXT,
    service_date TEXT,
    raw_text TEXT NOT NULL,
    resolved INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE TABLE settings (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL
  );
  `,
  // 2: Siri and Shortcuts actions already applied. iOS can deliver a queued action more than
  // once, so each one is recorded in the same transaction as its effect.
  `
  CREATE TABLE processed_invocations (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    processed_at TEXT NOT NULL
  );
  `,
];

export async function migrate(db: SQLiteDatabase): Promise<void> {
  await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  let version = row?.user_version ?? 0;
  while (version < MIGRATIONS.length) {
    const sql = MIGRATIONS[version] as string;
    const next = version + 1;
    await db.withTransactionAsync(async () => {
      await db.execAsync(sql);
      await db.execAsync(`PRAGMA user_version = ${next}`);
    });
    version = next;
  }
}
