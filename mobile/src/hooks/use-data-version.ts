import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';

import { onChanged } from '@/db/events';

/**
 * A number that goes up whenever the data changes or the screen comes into view.
 * Put it in a load effect's dependencies to keep the screen fresh.
 */
export function useDataVersion(): number {
  const [version, setVersion] = useState(0);
  useEffect(() => onChanged(() => setVersion((v) => v + 1)), []);
  useFocusEffect(
    useCallback(() => {
      setVersion((v) => v + 1);
    }, []),
  );
  return version;
}
