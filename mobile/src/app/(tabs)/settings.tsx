import * as Clipboard from 'expo-clipboard';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { Alert } from 'react-native';

import { Body, Button, ButtonRow, Card, Field, Header, Screen, Section, Segmented } from '@/components/ui';
import { singleStopUrl, type MapsApp } from '@/core/maps';
import { formatClock, parseClockInput } from '@/core/time';
import { loadSettings, saveSettings, type Settings } from '@/db/settings';
import { checkAi } from '@/services/ai';
import { shareBackup } from '@/services/backup';
import { geocode } from '@/services/geo';
import { openExternal } from '@/services/open';

const LINK_START = 'churchride://import?text=';

export default function SettingsScreen() {
  const db = useSQLiteContext();
  const [draft, setDraft] = useState<Settings | null>(null);
  const [serviceEnd, setServiceEnd] = useState('');
  const [seats, setSeats] = useState('');
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    loadSettings(db).then((s) => {
      if (!alive) return;
      setDraft(s);
      setServiceEnd(formatClock(s.serviceEnd));
      setSeats(String(s.seats));
    });
    return () => {
      alive = false;
    };
  }, [db]);

  if (!draft) {
    return (
      <Screen tabs>
        <Header title="Settings" />
      </Screen>
    );
  }

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    setDirty(true);
    setDraft((d) => (d ? { ...d, [key]: value } : d));
  };

  const save = async () => {
    const end = parseClockInput(serviceEnd);
    const seatCount = Number(seats);
    if (!end) {
      Alert.alert('Check the service end time', 'Type it like 12:30 PM.');
      return;
    }
    if (!Number.isInteger(seatCount) || seatCount < 1 || seatCount > 15) {
      Alert.alert('Check the seats', 'Enter how many riders fit in your car, from 1 to 15.');
      return;
    }
    await saveSettings(db, { ...draft, serviceEnd: end, seats: seatCount });
    setDirty(false);
  };

  /** Looks up an address, saves its coordinates and offers to check it in Maps. */
  const locate = async (which: 'church' | 'home') => {
    const address = which === 'church' ? draft.churchAddress : draft.homeAddress;
    if (!address.trim()) {
      Alert.alert('Type the address first');
      return;
    }
    setBusy(which);
    try {
      const point = await geocode(address);
      if (!point) {
        Alert.alert('Not found', 'Try adding the city and province, like “Fredericton, NB”.');
        return;
      }
      const patch =
        which === 'church'
          ? { churchAddress: address, churchLat: point.lat, churchLng: point.lng }
          : { homeAddress: address, homeLat: point.lat, homeLng: point.lng };
      await saveSettings(db, patch);
      setDraft((d) => (d ? { ...d, ...patch } : d));
      Alert.alert('Found it', 'Saved. Check the pin is in the right place.', [
        { text: 'Check in Maps', onPress: () => openExternal(singleStopUrl(draft.mapsApp, { address: null, ...point })) },
        { text: 'OK' },
      ]);
    } finally {
      setBusy(null);
    }
  };

  const clearCoords = (which: 'church' | 'home') =>
    which === 'church' ? { churchLat: null, churchLng: null } : { homeLat: null, homeLng: null };

  return (
    <Screen tabs>
      <Header
        title="Settings"
        right={<Button small variant="primary" title={dirty ? 'Save' : 'Saved'} onPress={save} disabled={!dirty} />}
      />

      <Section title="You">
        <Field
          label="Your name, as the church’s texts write it"
          value={draft.driverName}
          onChangeText={(v) => set('driverName', v)}
          autoCapitalize="words"
          hint="Texts addressed to someone else get flagged."
        />
        <Field label="Rider seats in your car" value={seats} onChangeText={(v) => { setDirty(true); setSeats(v); }} keyboardType="number-pad" />
      </Section>

      <Section title="Church">
        <Field label="Church name" value={draft.churchName} onChangeText={(v) => set('churchName', v)} />
        <Field
          label="Church address"
          value={draft.churchAddress}
          onChangeText={(v) => {
            set('churchAddress', v);
            setDraft((d) => (d ? { ...d, ...clearCoords('church') } : d));
          }}
          hint={draft.churchLat !== null ? 'Location found.' : 'Routes end here. Tap “Find on map” after typing it.'}
        />
        <ButtonRow>
          <Button small title={busy === 'church' ? 'Looking…' : 'Find on map'} onPress={() => locate('church')} disabled={!!busy} />
        </ButtonRow>
        <Field label="Service usually ends" value={serviceEnd} onChangeText={(v) => { setDirty(true); setServiceEnd(v); }} hint="Like 12:30 PM" />
        <Field
          label="Province"
          value={draft.province}
          onChangeText={(v) => set('province', v)}
          autoCapitalize="characters"
          hint="Pickup addresses in another province get flagged."
        />
      </Section>

      <Section title="Where you leave from (optional)">
        <Field
          label="Start address"
          value={draft.homeAddress}
          onChangeText={(v) => {
            set('homeAddress', v);
            setDraft((d) => (d ? { ...d, ...clearCoords('home') } : d));
          }}
          hint="Only used on this phone, for the leave-by estimate."
        />
        <ButtonRow>
          <Button small title={busy === 'home' ? 'Looking…' : 'Find on map'} onPress={() => locate('home')} disabled={!!busy} />
        </ButtonRow>
      </Section>

      <Section title="Maps">
        <Segmented<MapsApp>
          value={draft.mapsApp}
          onChange={(v) => set('mapsApp', v)}
          options={[
            { value: 'apple', label: 'Apple Maps' },
            { value: 'google', label: 'Google Maps' },
          ]}
        />
        <Body muted size={13}>Apple Maps needs iOS 18.4 or later for routes with several stops.</Body>
      </Section>

      <Section title="Quick texts">
        <Field label="“On my way” text" value={draft.onMyWayText} onChangeText={(v) => set('onMyWayText', v)} multiline />
        <Field
          label="“I’m outside” text"
          value={draft.outsideText}
          onChangeText={(v) => set('outsideText', v)}
          multiline
          hint="{first} is the rider’s first name, {driver} is yours."
        />
      </Section>

      <Section title="Auto-import from Messages">
        <Card>
          <Body>One-time setup in the Shortcuts app:</Body>
          <Body muted>1. Save the church’s texting number as a contact.</Body>
          <Body muted>2. Shortcuts → Automation → + → Message. Sender: that contact. Choose “Run Immediately”.</Body>
          <Body muted>3. Add the action “URL Encode” and set it to the Shortcut Input (the message).</Body>
          <Body muted>4. Add “Open URLs” with the link start below, followed by the URL Encoded Text.</Body>
          <Body muted size={13}>
            New assignment texts then open ChurchRide and land in your Inbox for review. If the phone is locked, it
            finishes when you unlock.
          </Body>
          <ButtonRow>
            <Button
              small
              title="Copy link start"
              onPress={async () => {
                await Clipboard.setStringAsync(LINK_START);
                Alert.alert('Copied', LINK_START);
              }}
            />
          </ButtonRow>
        </Card>
      </Section>

      <Section title="AI reading (optional)">
        <Body muted size={13}>
          Only for texts ChurchRide can’t read on its own. Uses your Cloudflare Worker, which keeps the AI key off this
          phone. The text you choose to read is sent to the Worker and its AI service.
        </Body>
        <Field
          label="Worker URL"
          value={draft.aiUrl}
          onChangeText={(v) => set('aiUrl', v)}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          placeholder="https://churchride-ai.yourname.workers.dev"
        />
        <Field
          label="App token"
          value={draft.aiToken}
          onChangeText={(v) => set('aiToken', v)}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
        />
        <ButtonRow>
          <Button
            small
            title={busy === 'ai' ? 'Checking…' : 'Test connection'}
            disabled={!!busy}
            onPress={async () => {
              setBusy('ai');
              try {
                const result = await checkAi(draft);
                Alert.alert(result.ok ? 'Connected' : 'Not connected', result.message);
              } finally {
                setBusy(null);
              }
            }}
          />
        </ButtonRow>
      </Section>

      <Section title="Backup">
        <Body muted size={13}>
          Everything is stored only on this phone. Export a backup now and then (it leaves out the AI token).
        </Body>
        <ButtonRow>
          <Button
            title={busy === 'backup' ? 'Preparing…' : 'Export backup'}
            disabled={!!busy}
            onPress={async () => {
              setBusy('backup');
              try {
                await shareBackup(db);
              } catch (e) {
                Alert.alert('Backup failed', e instanceof Error ? e.message : 'Try again.');
              } finally {
                setBusy(null);
              }
            }}
          />
        </ButtonRow>
      </Section>

      <Button variant="primary" title={dirty ? 'Save settings' : 'All changes saved'} onPress={save} disabled={!dirty} />
    </Screen>
  );
}
