import * as AppIntents from 'expo-app-intents';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect } from 'react';
import { AppState } from 'react-native';

import { onChanged } from '@/db/events';
import { drainIntents, drainPendingIntents, publishStopCatalog } from '@/services/app-intents';

/**
 * Mounted once at the root, inside the database provider. Applies Siri and Shortcuts actions
 * (queued while the app was closed, or arriving while it's open) and keeps the stops that Siri
 * reads up to date. Renders nothing.
 */
export function AppIntentsBridge() {
  const db = useSQLiteContext();

  AppIntents.useAppIntents(async (pending) => {
    await drainIntents(db, pending);
  });

  useEffect(() => {
    const publish = () => {
      publishStopCatalog(db).catch((error) => console.warn('Couldn’t update Siri’s stop list', error));
    };
    publish();
    const stopListening = onChanged(publish);
    const appState = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      publish();
      drainPendingIntents(db).catch((error) => console.warn('Couldn’t check queued Siri actions', error));
    });
    return () => {
      stopListening();
      appState.remove();
    };
  }, [db]);

  return null;
}
