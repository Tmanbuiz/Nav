/// <reference types="node" />
/**
 * Test helper: an in-memory SQLite database (Node's built-in engine) behind expo-sqlite's async
 * method names, so tests run the app's real SQL. Never imported by the app itself.
 */
import type { SQLiteDatabase } from 'expo-sqlite';
import { DatabaseSync } from 'node:sqlite';

export function openTestDb(): SQLiteDatabase {
  const raw = new DatabaseSync(':memory:');
  const args = (params: unknown[]) => (params.length === 1 && Array.isArray(params[0]) ? params[0] : params) as never[];
  const db = {
    execAsync: async (sql: string) => {
      raw.exec(sql);
    },
    runAsync: async (sql: string, ...params: unknown[]) => {
      const r = raw.prepare(sql).run(...args(params));
      return { lastInsertRowId: Number(r.lastInsertRowid), changes: Number(r.changes) };
    },
    getAllAsync: async (sql: string, ...params: unknown[]) => raw.prepare(sql).all(...args(params)),
    getFirstAsync: async (sql: string, ...params: unknown[]) => raw.prepare(sql).get(...args(params)) ?? null,
    withTransactionAsync: async (task: () => Promise<void>) => {
      raw.exec('BEGIN');
      try {
        await task();
        raw.exec('COMMIT');
      } catch (e) {
        raw.exec('ROLLBACK');
        throw e;
      }
    },
  };
  return db as unknown as SQLiteDatabase;
}
