import * as Clipboard from 'expo-clipboard';
import { router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert } from 'react-native';

import { Body, Button, ButtonRow, Card, Field, Pill, Screen, Section, Title } from '@/components/ui';
import type { ImportSummary } from '@/core/importer';
import { parseAssignmentMessages, type ParseResult } from '@/core/parser/assignmentParser';
import { formatDate, formatWindow, todayISO } from '@/core/time';
import { loadSettings, type Settings } from '@/db/settings';
import { aiConfigured, extractWithAi } from '@/services/ai';
import { importAiRides, importText } from '@/services/rides';

function addSummaries(a: ImportSummary | null, b: ImportSummary): ImportSummary {
  if (!a) return b;
  return {
    created: a.created + b.created,
    changed: a.changed + b.changed,
    duplicates: a.duplicates + b.duplicates,
    notices: a.notices + b.notices,
    ignored: a.ignored + b.ignored,
  };
}

function describe(summary: ImportSummary): string {
  const parts = [
    summary.created && `${summary.created} new`,
    summary.changed && `${summary.changed} changed`,
    summary.notices && `${summary.notices} cancellation or change notice${summary.notices > 1 ? 's' : ''}`,
    summary.duplicates && `${summary.duplicates} already saved`,
    summary.ignored && `${summary.ignored} other text${summary.ignored > 1 ? 's' : ''} ignored`,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'Nothing found';
}

function PreviewItem({ result }: { result: ParseResult }) {
  if (result.kind === 'not-an-assignment') return <Body muted>Not an assignment: will be ignored</Body>;
  if (result.kind === 'possible-change') {
    return (
      <Body>
        {result.hint === 'cancellation' ? 'Possible cancellation' : 'Possible change'}:{' '}
        {result.fields.passengerName ?? 'unknown rider'} · {formatDate(result.fields.serviceDate)}
      </Body>
    );
  }
  const flags = result.issues.length;
  return (
    <Body>
      {result.passengerName ?? 'No name'} · {formatDate(result.serviceDate)} ·{' '}
      {formatWindow(result.pickupWindow?.start, result.pickupWindow?.end)}
      {flags ? ` · ${flags} to check` : ''}
    </Body>
  );
}

export default function ImportScreen() {
  const params = useLocalSearchParams<{ text?: string }>();
  const linkText = typeof params.text === 'string' ? params.text : '';
  const db = useSQLiteContext();
  const [text, setText] = useState(linkText);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [busy, setBusy] = useState(false);
  // The last Shortcut link handled. Several texts arrive together, each as its own link.
  const lastLink = useRef<string | null>(null);

  useEffect(() => {
    loadSettings(db).then(setSettings);
  }, [db]);

  // Opened from the Shortcut (churchride://import?text=...): add straight to the Inbox.
  useEffect(() => {
    if (!linkText.trim() || lastLink.current === linkText) return;
    lastLink.current = linkText;
    importText(db, linkText, 'link')
      .then((s) => setSummary((prev) => addSummaries(prev, s)))
      .catch(() => Alert.alert('Couldn’t import that text'));
  }, [db, linkText]);

  const preview = useMemo(
    () =>
      text.trim()
        ? parseAssignmentMessages(text, {
            today: todayISO(),
            expectedDriverName: settings?.driverName.trim() || undefined,
            expectedProvince: settings?.province.trim() || undefined,
          })
        : [],
    [text, settings],
  );
  const recognized = preview.filter((r) => r.kind !== 'not-an-assignment').length;

  const paste = async () => {
    const clip = await Clipboard.getStringAsync();
    if (clip.trim()) {
      // Messages copies one text at a time, so each paste adds to the box.
      setText((current) => (current.trim() ? `${current.trimEnd()}\n\n${clip.trim()}` : clip.trim()));
      setSummary(null);
    } else {
      Alert.alert('Clipboard is empty', 'Copy the texts in Messages first (press and hold a text, then Copy).');
    }
  };

  const add = async () => {
    setBusy(true);
    try {
      setSummary(await importText(db, text, 'paste'));
    } catch {
      Alert.alert('Couldn’t import those texts');
    } finally {
      setBusy(false);
    }
  };

  const readWithAi = async () => {
    if (!settings) return;
    setBusy(true);
    try {
      const rides = await extractWithAi(text, settings);
      if (!rides.length) {
        Alert.alert('No rides found', 'The AI couldn’t find a ride in that text either. Add it by hand instead.');
        return;
      }
      setSummary(await importAiRides(db, rides, text));
    } catch (e) {
      Alert.alert('AI reading failed', e instanceof Error ? e.message : 'Try again later.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      {summary ? (
        <Card tone={summary.created || summary.changed || summary.notices ? 'success' : 'default'}>
          <Title>Done</Title>
          <Body>{describe(summary)}</Body>
          <ButtonRow>
            <Button variant="primary" title="Review in Inbox" onPress={() => router.dismissTo('/inbox')} />
            <Button
              title="Add more"
              onPress={() => {
                setText('');
                setSummary(null);
              }}
            />
          </ButtonRow>
        </Card>
      ) : null}

      <Section title="Assignment texts">
        <Body muted>
          In Messages, press and hold a text, tap Copy, then tap Paste here. Repeat for each text; they all go in one box.
        </Body>
        <Field
          label="Texts"
          multiline
          value={text}
          onChangeText={(v) => {
            setText(v);
            setSummary(null);
          }}
          placeholder="Transportation Assignment Dear …"
          autoCorrect={false}
          autoCapitalize="none"
        />
        <ButtonRow>
          <Button title="Paste" onPress={paste} />
          <Button
            variant="primary"
            title={busy ? 'Adding…' : recognized ? `Add ${recognized} to Inbox` : 'Add to Inbox'}
            onPress={add}
            disabled={busy || !recognized}
          />
        </ButtonRow>
      </Section>

      {preview.length ? (
        <Section title="What ChurchRide found">
          <Card>
            {preview.map((result, i) => (
              <PreviewItem key={i} result={result} />
            ))}
          </Card>
        </Section>
      ) : null}

      {text.trim() && !recognized && settings ? (
        <Card tone="warning">
          <Title>Not a text ChurchRide knows</Title>
          {aiConfigured(settings) ? (
            <>
              <Body muted>AI reading sends this text to your Cloudflare Worker and its AI service. Check every field afterwards.</Body>
              <ButtonRow>
                <Button title={busy ? 'Reading…' : 'Read with AI'} onPress={readWithAi} disabled={busy} />
              </ButtonRow>
            </>
          ) : (
            <Body muted>You can add the ride by hand, or set up AI reading in Settings.</Body>
          )}
          <ButtonRow>
            <Button title="Add a ride by hand" onPress={() => router.push({ pathname: '/ride/[id]', params: { id: 'new' } })} />
          </ButtonRow>
          <Pill text="Nothing is saved until you add it" />
        </Card>
      ) : null}
    </Screen>
  );
}
