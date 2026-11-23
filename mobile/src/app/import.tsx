import * as Clipboard from 'expo-clipboard';
import { router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, AppState } from 'react-native';

import { Body, Button, ButtonRow, Card, Field, Pill, Screen, Section, Title } from '@/components/ui';
import { addSummaries, type ImportSummary } from '@/core/importer';
import { parseAssignmentMessages, type ParseResult } from '@/core/parser/assignmentParser';
import { formatDate, formatWindow, todayISO } from '@/core/time';
import { loadSettings, type Settings } from '@/db/settings';
import { aiConfigured, extractWithAi } from '@/services/ai';
import { importAiRides, importText } from '@/services/rides';
import { importPendingShare, pendingShare, recentSharedImport, type SharedImport } from '@/services/share';

function shareProblems(result: SharedImport): string | null {
  const parts = [
    result.unreadable &&
      (result.unreadable === 1
        ? 'One picture had no text ChurchRide could read.'
        : `${result.unreadable} pictures had no text ChurchRide could read.`),
    result.skipped &&
      (result.skipped === 1
        ? 'One item wasn’t a text or a picture, so it was skipped.'
        : `${result.skipped} items weren’t texts or pictures, so they were skipped.`),
  ].filter(Boolean);
  return parts.length ? parts.join(' ') : null;
}

function appendText(current: string, more: string): string {
  if (!more) return current;
  return current.trim() ? `${current.trimEnd()}\n\n${more}` : more;
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

interface Box {
  text: string;
  /** Everything in the box is already in the Inbox, so "Add" doesn't send it again. */
  added: boolean;
}

export default function ImportScreen() {
  const params = useLocalSearchParams<{ text?: string; shared?: string }>();
  const linkText = typeof params.text === 'string' ? params.text : '';
  const fromShareSheet = params.shared === '1';
  const db = useSQLiteContext();
  // Opened just after another screen imported the share: show that result here too.
  const [earlierShare] = useState(() => (fromShareSheet && !pendingShare().length ? recentSharedImport() : null));
  const [box, setBox] = useState<Box>(() => ({
    text: appendText(linkText, earlierShare?.text ?? ''),
    added: !!earlierShare && !linkText,
  }));
  const [settings, setSettings] = useState<Settings | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(earlierShare?.summary ?? null);
  const [shareNote, setShareNote] = useState<string | null>(() => (earlierShare ? shareProblems(earlierShare) : null));
  const [readingShare, setReadingShare] = useState(() => pendingShare().length > 0);
  const [busy, setBusy] = useState(false);
  // The last Shortcut link handled. Several texts arrive together, each as its own link.
  const lastLink = useRef<string | null>(null);
  const text = box.text;

  useEffect(() => {
    loadSettings(db).then(setSettings);
  }, [db]);

  // Opened from the Shortcut (churchride://import?text=...): add straight to the Inbox.
  useEffect(() => {
    if (!linkText.trim() || lastLink.current === linkText) return;
    lastLink.current = linkText;
    importText(db, linkText, 'link')
      .then((s) => {
        setSummary((prev) => addSummaries(prev, s));
        setBox((b) => (b.text === linkText ? { ...b, added: true } : b));
      })
      .catch(() => Alert.alert('Couldn’t import that text'));
  }, [db, linkText]);

  // Shared from another app with the share sheet: import it now, and again whenever ChurchRide
  // comes back to the front with something new.
  useEffect(() => {
    let alive = true;
    const takeShare = async () => {
      try {
        const result = await importPendingShare(db);
        if (!alive || !result) return;
        // Text already in the box stays. If it wasn't added yet, "Add" stays available for it.
        setBox((b) => ({ text: appendText(b.text, result.text), added: b.added || !b.text.trim() }));
        setSummary((prev) => addSummaries(prev, result.summary));
        setShareNote(shareProblems(result));
      } catch {
        if (alive) Alert.alert('Couldn’t import what you shared', 'It’s still waiting. Open this screen again to retry.');
      } finally {
        if (alive) setReadingShare(false);
      }
    };
    if (pendingShare().length) void takeShare();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active' || !pendingShare().length) return;
      setReadingShare(true);
      void takeShare();
    });
    return () => {
      alive = false;
      subscription.remove();
    };
  }, [db]);

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

  const startOver = (next: Box) => {
    setBox(next);
    setSummary(null);
    setShareNote(null);
  };

  const paste = async () => {
    const clip = await Clipboard.getStringAsync();
    if (clip.trim()) {
      // Messages copies one text at a time, so each paste adds to the box.
      setBox((b) => ({ text: appendText(b.text, clip.trim()), added: false }));
      setSummary(null);
      setShareNote(null);
    } else {
      Alert.alert('Clipboard is empty', 'Copy the texts in Messages first (press and hold a text, then Copy).');
    }
  };

  const markAdded = (sent: string) => setBox((b) => (b.text === sent ? { ...b, added: true } : b));

  const add = async () => {
    setBusy(true);
    try {
      setSummary(await importText(db, text, 'paste'));
      markAdded(text);
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
      markAdded(text);
    } catch (e) {
      Alert.alert('AI reading failed', e instanceof Error ? e.message : 'Try again later.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      {readingShare ? (
        <Card>
          <Title>Reading what you shared…</Title>
          <Body muted>Screenshots are read on this phone. Nothing is uploaded.</Body>
        </Card>
      ) : null}

      {summary ? (
        <Card tone={summary.created || summary.changed || summary.notices ? 'success' : 'default'}>
          <Title>Done</Title>
          <Body>{describe(summary)}</Body>
          <ButtonRow>
            <Button variant="primary" title="Review in Inbox" onPress={() => router.dismissTo('/inbox')} />
            <Button title="Add more" onPress={() => startOver({ text: '', added: false })} />
          </ButtonRow>
        </Card>
      ) : null}

      {shareNote ? (
        <Card tone="warning">
          <Body>{shareNote}</Body>
        </Card>
      ) : null}

      <Section title="Assignment texts">
        <Body muted>
          In Messages, press and hold a text, tap Copy, then tap Paste here. Repeat for each text; they all go in one box.
          From WhatsApp, Mail or Photos, you can also share texts and screenshots straight to ChurchRide.
        </Body>
        <Field
          label="Texts"
          multiline
          value={text}
          onChangeText={(v) => startOver({ text: v, added: false })}
          placeholder="Transportation Assignment Dear …"
          autoCorrect={false}
          autoCapitalize="none"
        />
        <ButtonRow>
          <Button title="Paste" onPress={paste} />
          <Button
            variant="primary"
            title={
              busy ? 'Adding…' : box.added ? 'Added to Inbox' : recognized ? `Add ${recognized} to Inbox` : 'Add to Inbox'
            }
            onPress={add}
            disabled={busy || !recognized || box.added}
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
