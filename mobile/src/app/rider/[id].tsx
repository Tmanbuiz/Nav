import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useRef, useState } from 'react';
import { Alert, Platform } from 'react-native';

import { Body, Button, ButtonRow, Card, Field, Pill, Screen, Section, Title } from '@/components/ui';
import { fillTemplate, firstName, singleStopUrl, smsUrl, telUrl } from '@/core/maps';
import { formatDate, formatWindow } from '@/core/time';
import {
  clearRegularSpot,
  deleteRegular,
  getRegular,
  listRidesForRegular,
  saveRegularSpot,
  updateRegular,
  type Regular,
  type Ride,
} from '@/db/repo';
import { loadSettings, type Settings } from '@/db/settings';
import { useDataVersion } from '@/hooks/use-data-version';
import { currentSpot } from '@/services/geo';
import { openExternal } from '@/services/open';

export default function RiderScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const id = typeof params.id === 'string' ? params.id : '';
  const db = useSQLiteContext();
  const version = useDataVersion();
  const [rider, setRider] = useState<Regular | null | undefined>(undefined);
  const [rides, setRides] = useState<Ride[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [form, setForm] = useState({ name: '', address: '', notes: '' });
  const [dirty, setDirty] = useState(false);
  const [locating, setLocating] = useState(false);
  // Mirrors `dirty` for the loader, so a background reload never overwrites unsaved typing.
  const editing = useRef(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [r, list, s] = await Promise.all([getRegular(db, id), listRidesForRegular(db, id), loadSettings(db)]);
      if (!alive) return;
      setRider(r);
      setRides(list);
      setSettings(s);
      if (r && !editing.current) setForm({ name: r.name, address: r.pickupAddress ?? '', notes: r.notes });
    })();
    return () => {
      alive = false;
    };
  }, [db, id, version]);

  if (rider === undefined) return <Screen>{null}</Screen>;
  if (rider === null) {
    return (
      <Screen>
        <Body>This rider no longer exists.</Body>
      </Screen>
    );
  }

  const edit = (key: 'name' | 'address' | 'notes') => (value: string) => {
    editing.current = true;
    setDirty(true);
    setForm((f) => ({ ...f, [key]: value }));
  };

  const save = async () => {
    if (!form.name.trim()) {
      Alert.alert('Add a name');
      return;
    }
    await updateRegular(db, rider.id, {
      name: form.name.trim(),
      pickupAddress: form.address.trim() || null,
      notes: form.notes.trim(),
    });
    editing.current = false;
    setDirty(false);
  };

  const saveHere = async () => {
    setLocating(true);
    try {
      const result = await currentSpot();
      if (!result.ok) {
        Alert.alert('Couldn’t save the spot', result.reason);
        return;
      }
      await saveRegularSpot(db, rider.id, result.point);
      const meters = result.accuracy ? ` (within about ${Math.round(result.accuracy)} m)` : '';
      Alert.alert('Pickup spot saved', `Routes will now go to this exact spot${meters}.`);
    } finally {
      setLocating(false);
    }
  };

  const vars = { first: firstName(rider.name), name: rider.name, driver: firstName(settings?.driverName) || 'your driver' };
  const mapsApp = settings?.mapsApp ?? 'apple';

  return (
    <Screen>
      <Stack.Screen options={{ title: rider.name }} />

      {rider.phone ? (
        <ButtonRow>
          <Button title="Call" onPress={() => openExternal(telUrl(rider.phone as string))} />
          <Button
            title="Text"
            onPress={() =>
              openExternal(smsUrl(rider.phone as string, fillTemplate(settings?.onMyWayText ?? '', vars), Platform.OS))
            }
          />
        </ButtonRow>
      ) : null}

      <Section title="Pickup spot">
        <Card tone={rider.spotSaved ? 'success' : 'default'}>
          {rider.spotSaved ? (
            <>
              <Pill tone="success" text="Exact spot saved" />
              <Body muted>Routes go to this spot instead of the address.</Body>
              <ButtonRow>
                <Button
                  small
                  title="Check it in Maps"
                  onPress={() =>
                    openExternal(
                      singleStopUrl(mapsApp, { address: rider.pickupAddress, lat: rider.spotLat, lng: rider.spotLng }),
                    )
                  }
                />
                <Button small variant="danger" title="Clear spot" onPress={() => clearRegularSpot(db, rider.id)} />
              </ButtonRow>
            </>
          ) : (
            <>
              <Title>No exact spot saved</Title>
              <Body muted>
                Next time you’re parked where {firstName(rider.name) || 'this rider'} gets in, tap the button. Useful for
                residences and buildings with several doors.
              </Body>
            </>
          )}
          <ButtonRow>
            <Button
              variant={rider.spotSaved ? 'secondary' : 'primary'}
              title={locating ? 'Finding you…' : rider.spotSaved ? 'Replace with where I am now' : 'Save where I am now'}
              onPress={saveHere}
              disabled={locating}
            />
          </ButtonRow>
        </Card>
      </Section>

      <Section title="Details">
        <Field label="Name" value={form.name} onChangeText={edit('name')} autoCapitalize="words" />
        <Field
          label="Usual pickup address"
          value={form.address}
          onChangeText={edit('address')}
          multiline
          hint="Changing the address clears the saved spot."
        />
        <Field label="Notes" value={form.notes} onChangeText={edit('notes')} multiline placeholder="Side door, text when outside, needs help with steps…" />
        <ButtonRow>
          <Button variant="primary" title="Save" onPress={save} disabled={!dirty} />
        </ButtonRow>
      </Section>

      <Section title={`Rides (${rides.length})`}>
        {rides.slice(0, 20).map((ride) => (
          <Card key={ride.id}>
            <Body>
              {formatDate(ride.serviceDate)} · {formatWindow(ride.windowStart, ride.windowEnd)}
            </Body>
            <Body muted>{ride.status === 'confirmed' ? 'Approved' : ride.status === 'cancelled' ? 'Cancelled' : 'In review'}</Body>
          </Card>
        ))}
      </Section>

      <ButtonRow>
        <Button
          variant="danger"
          title="Delete rider"
          onPress={() =>
            Alert.alert('Delete this rider?', 'Their rides stay, but the notes and saved spot are removed.', [
              { text: 'Back', style: 'cancel' },
              {
                text: 'Delete',
                style: 'destructive',
                onPress: async () => {
                  await deleteRegular(db, rider.id);
                  router.back();
                },
              },
            ])
          }
        />
      </ButtonRow>
    </Screen>
  );
}
