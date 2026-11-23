import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Body, Card, Empty, Header, Pill, Screen, Title } from '@/components/ui';
import { listRegulars, type Regular } from '@/db/repo';
import { useDataVersion } from '@/hooks/use-data-version';

export default function RidersScreen() {
  const db = useSQLiteContext();
  const version = useDataVersion();
  const [riders, setRiders] = useState<Regular[] | null>(null);

  useEffect(() => {
    let alive = true;
    listRegulars(db).then((r) => {
      if (alive) setRiders(r);
    });
    return () => {
      alive = false;
    };
  }, [db, version]);

  return (
    <Screen tabs>
      <Header title="Riders" subtitle="Saved after you approve their first ride. Notes and pickup spots carry over every week." />
      {riders && !riders.length ? (
        <Empty title="No riders yet" body="Approve a ride in your Inbox and the rider is saved here." />
      ) : null}
      {(riders ?? []).map((r) => (
        <Pressable
          key={r.id}
          accessibilityRole="button"
          accessibilityLabel={`Open ${r.name}`}
          onPress={() => router.push({ pathname: '/rider/[id]', params: { id: r.id } })}>
          <Card>
            <Title>{r.name}</Title>
            {r.pickupAddress ? <Body>{r.pickupAddress}</Body> : null}
            {r.phone ? <Body muted>{r.phone}</Body> : null}
            {r.notes ? <Body muted>Note: {r.notes}</Body> : null}
            <View style={styles.pills}>
              {r.spotSaved ? <Pill tone="success" text="Exact spot saved" /> : <Pill text="No exact spot yet" />}
            </View>
          </Card>
        </Pressable>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  pills: { flexDirection: 'row', gap: 6 },
});
