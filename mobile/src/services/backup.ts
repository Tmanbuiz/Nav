import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import type { SQLiteDatabase } from 'expo-sqlite';

import { todayISO } from '@/core/time';
import { exportAll } from '@/db/repo';

/** Writes everything (except the AI token) to a JSON file and opens the share sheet. */
export async function shareBackup(db: SQLiteDatabase): Promise<void> {
  const data = await exportAll(db);
  const file = new File(Paths.cache, `churchride-backup-${todayISO()}.json`);
  if (file.exists) file.delete();
  file.create();
  await file.write(JSON.stringify(data, null, 2));
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing isn’t available on this device.');
  await Sharing.shareAsync(file.uri, {
    mimeType: 'application/json',
    UTI: 'public.json',
    dialogTitle: 'ChurchRide backup',
  });
}
