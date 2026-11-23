import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { Alert } from 'react-native';

import { Body, Button, ButtonRow, Card, Field, IssueList, Pill, Screen, Section, Segmented } from '@/components/ui';
import { sameAddress } from '@/core/importer';
import { choiceToLegs, legsToChoice, type LegChoice } from '@/core/labels';
import type { Issue } from '@/core/parser/assignmentParser';
import { formatClock, nextSunday, parseClockInput, todayISO } from '@/core/time';
import { validateRide } from '@/core/validate';
import {
  cancelRide,
  createManualRide,
  deleteRide,
  getRegular,
  getRide,
  setRideStatus,
  updateRideFields,
  type Regular,
  type Ride,
} from '@/db/repo';
import { loadSettings, type Settings } from '@/db/settings';
import { approveRide } from '@/services/rides';

interface Form {
  name: string;
  phone: string;
  persons: string;
  date: string;
  start: string;
  end: string;
  legs: LegChoice;
  address: string;
}

function formFromRide(r: Ride): Form {
  return {
    name: r.passengerName ?? '',
    phone: r.phone ?? '',
    persons: r.persons ? String(r.persons) : '1',
    date: r.serviceDate ?? '',
    start: r.windowStart ? formatClock(r.windowStart) : '',
    end: r.windowEnd && r.windowEnd !== r.windowStart ? formatClock(r.windowEnd) : '',
    legs: legsToChoice(r.legs),
    address: r.pickupAddress ?? '',
  };
}

function emptyForm(): Form {
  return { name: '', phone: '', persons: '1', date: nextSunday(todayISO()), start: '', end: '', legs: 'to', address: '' };
}

const STATUS_LABEL = { review: 'Waiting for review', confirmed: 'Approved', cancelled: 'Cancelled' } as const;

export default function RideScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const id = typeof params.id === 'string' ? params.id : 'new';
  const isNew = id === 'new';
  const db = useSQLiteContext();
  const [loaded, setLoaded] = useState(false);
  const [ride, setRide] = useState<Ride | null>(null);
  const [regular, setRegular] = useState<Regular | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [form, setForm] = useState<Form>(emptyForm);
  const [problems, setProblems] = useState<Issue[] | null>(null);
  const [showRaw, setShowRaw] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const s = await loadSettings(db);
      const r = isNew ? null : await getRide(db, id);
      const reg = r?.regularId ? await getRegular(db, r.regularId) : null;
      if (!alive) return;
      setSettings(s);
      setRide(r);
      setRegular(reg);
      setForm(r ? formFromRide(r) : emptyForm());
      setLoaded(true);
    })();
    return () => {
      alive = false;
    };
  }, [db, id, isNew]);

  const set = (key: keyof Form) => (value: string) => setForm((f) => ({ ...f, [key]: value }));

  const save = async (approve: boolean) => {
    if (!settings) return;
    const start = parseClockInput(form.start);
    const end = form.end.trim() ? parseClockInput(form.end) : null;
    const timeIssues: Issue[] = [];
    if (form.start.trim() && !start) {
      timeIssues.push({ field: 'pickupWindow', severity: 'error', code: 'bad-time', message: 'Type the pickup time like 9:30 AM' });
    }
    if (form.end.trim() && !end) {
      timeIssues.push({ field: 'pickupWindow', severity: 'error', code: 'bad-time', message: 'Type the “until” time like 9:45 AM' });
    }
    const { fields, issues: checked } = validateRide(
      {
        passengerName: form.name,
        phone: form.phone,
        persons: form.persons,
        serviceDate: form.date,
        windowStart: start,
        windowEnd: end,
        legs: choiceToLegs(form.legs),
        pickupAddress: form.address,
      },
      {
        today: todayISO(),
        province: settings.province,
        spotSaved: !!regular?.spotSaved && sameAddress(regular.pickupAddress, form.address),
      },
    );
    const issues = [...timeIssues, ...checked];
    const hasErrors = issues.some((i) => i.severity === 'error');
    setProblems(issues);
    if (approve && hasErrors) {
      Alert.alert('Almost there', 'Fix the items marked in red, then approve.');
      return;
    }

    setBusy(true);
    try {
      let rideId = id;
      if (isNew) {
        rideId = await createManualRide(db, fields, issues);
      } else {
        await updateRideFields(db, id, fields, issues);
        if (hasErrors && ride?.status === 'confirmed') await setRideStatus(db, id, 'review');
      }
      if (approve) {
        const result = await approveRide(db, rideId);
        if (!result.ok) {
          Alert.alert('Saved, not approved yet', result.reason);
          if (isNew) router.replace({ pathname: '/ride/[id]', params: { id: rideId } });
          return;
        }
      }
      router.back();
    } catch (e) {
      const duplicate = e instanceof Error && /UNIQUE/i.test(e.message);
      Alert.alert(
        'Couldn’t save',
        duplicate ? 'There’s already a ride for this person on this date.' : 'Something went wrong saving this ride.',
      );
    } finally {
      setBusy(false);
    }
  };

  const confirmThen = (title: string, message: string, action: string, run: () => Promise<void>) =>
    Alert.alert(title, message, [
      { text: 'Back', style: 'cancel' },
      {
        text: action,
        style: 'destructive',
        onPress: async () => {
          await run();
          router.back();
        },
      },
    ]);

  if (!loaded) return <Screen>{null}</Screen>;
  if (!isNew && !ride) {
    return (
      <Screen>
        <Body>This ride no longer exists.</Body>
      </Screen>
    );
  }

  const shownIssues = problems ?? ride?.issues ?? [];

  return (
    <Screen>
      <Stack.Screen options={{ title: isNew ? 'New ride' : (ride?.passengerName ?? 'Ride') }} />

      {ride ? <Pill tone={ride.status === 'confirmed' ? 'success' : ride.status === 'cancelled' ? 'danger' : 'warning'} text={STATUS_LABEL[ride.status]} /> : null}
      <IssueList issues={shownIssues} />

      <Section title="Rider">
        <Field label="Name" value={form.name} onChangeText={set('name')} autoCapitalize="words" />
        <Field label="Phone" value={form.phone} onChangeText={set('phone')} keyboardType="phone-pad" />
        <Field label="Number of persons" value={form.persons} onChangeText={set('persons')} keyboardType="number-pad" />
      </Section>

      <Section title="Pickup">
        <Field label="Date" value={form.date} onChangeText={set('date')} hint="Like 2026-11-29" autoCapitalize="none" />
        <Field label="From" value={form.start} onChangeText={set('start')} hint="Like 9:30 AM" autoCapitalize="characters" />
        <Field label="Until (optional)" value={form.end} onChangeText={set('end')} hint="Like 9:45 AM" autoCapitalize="characters" />
        <Segmented<LegChoice>
          label="Trips"
          value={form.legs}
          onChange={(v) => setForm((f) => ({ ...f, legs: v }))}
          options={[
            { value: 'to', label: 'To church' },
            { value: 'both', label: 'Both ways' },
            { value: 'from', label: 'Home only' },
          ]}
        />
        <Field label="Pickup address" value={form.address} onChangeText={set('address')} multiline />
      </Section>

      <ButtonRow>
        <Button title={busy ? 'Saving…' : 'Save'} onPress={() => save(false)} disabled={busy} />
        {isNew || ride?.status !== 'confirmed' ? (
          <Button variant="primary" title="Save and approve" onPress={() => save(true)} disabled={busy} />
        ) : null}
      </ButtonRow>

      {regular ? (
        <Card>
          <Body>
            Saved rider: {regular.name}
            {regular.spotSaved ? ' · exact pickup spot saved' : ''}
          </Body>
          <ButtonRow>
            <Button small title="Open rider" onPress={() => router.push({ pathname: '/rider/[id]', params: { id: regular.id } })} />
          </ButtonRow>
        </Card>
      ) : null}

      {ride?.rawText ? (
        <Section title="Original text">
          {showRaw ? <Body muted size={14}>{ride.rawText}</Body> : null}
          <ButtonRow>
            <Button small variant="ghost" title={showRaw ? 'Hide original text' : 'Show original text'} onPress={() => setShowRaw((v) => !v)} />
          </ButtonRow>
        </Section>
      ) : null}

      {ride ? (
        <ButtonRow>
          {ride.status === 'confirmed' ? (
            <Button
              variant="danger"
              title="Cancel this ride"
              onPress={() => confirmThen('Cancel this ride?', 'It will come off your run.', 'Cancel ride', () => cancelRide(db, ride.id))}
            />
          ) : null}
          {ride.status === 'cancelled' ? (
            <Button title="Restore to Inbox" onPress={async () => { await setRideStatus(db, ride.id, 'review'); router.back(); }} />
          ) : null}
          <Button
            variant="danger"
            title="Delete"
            onPress={() => confirmThen('Delete this ride?', 'This can’t be undone.', 'Delete', () => deleteRide(db, ride.id))}
          />
        </ButtonRow>
      ) : null}
    </Screen>
  );
}
