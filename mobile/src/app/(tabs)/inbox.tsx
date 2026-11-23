import { router } from 'expo-router';
import { useSQLiteContext, type SQLiteDatabase } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { Alert } from 'react-native';

import { Body, Button, ButtonRow, Card, Empty, Header, IssueList, Pill, Screen, Section, Title } from '@/components/ui';
import { legsLabel } from '@/core/labels';
import { formatDate, formatWindow } from '@/core/time';
import {
  cancelRide,
  deleteRide,
  getRide,
  listOpenNotices,
  listRidesByStatus,
  resolveNotice,
  type Notice,
  type Ride,
} from '@/db/repo';
import { useDataVersion } from '@/hooks/use-data-version';
import { approveRide } from '@/services/rides';

interface InboxData {
  rides: Ride[];
  notices: { notice: Notice; ride: Ride | null }[];
}

async function loadInbox(db: SQLiteDatabase): Promise<InboxData> {
  const [rides, notices] = await Promise.all([listRidesByStatus(db, 'review'), listOpenNotices(db)]);
  const withRides = await Promise.all(
    notices.map(async (notice) => ({
      notice,
      ride: notice.assignmentId ? await getRide(db, notice.assignmentId) : null,
    })),
  );
  return { rides, notices: withRides };
}

export default function InboxScreen() {
  const db = useSQLiteContext();
  const version = useDataVersion();
  const [data, setData] = useState<InboxData | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    loadInbox(db).then((d) => {
      if (alive) setData(d);
    });
    return () => {
      alive = false;
    };
  }, [db, version]);

  const approve = async (ride: Ride) => {
    setBusy(ride.id);
    try {
      const result = await approveRide(db, ride.id);
      if (!result.ok) Alert.alert('Not approved yet', result.reason);
    } finally {
      setBusy(null);
    }
  };

  const approveAllClean = async (rides: Ride[]) => {
    setBusy('all');
    let held = 0;
    try {
      for (const ride of rides) {
        const result = await approveRide(db, ride.id);
        if (!result.ok) held += 1;
      }
    } finally {
      setBusy(null);
    }
    if (held) Alert.alert('Some rides need a look', `${held} ride${held > 1 ? 's were' : ' was'} held back. Check the flags.`);
  };

  const discard = (ride: Ride) =>
    Alert.alert('Discard this ride?', `${ride.passengerName ?? 'This ride'} will be removed from ChurchRide.`, [
      { text: 'Keep', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: () => deleteRide(db, ride.id) },
    ]);

  const rides = data?.rides ?? [];
  const notices = data?.notices ?? [];
  const clean = rides.filter((r) => r.issues.length === 0);

  return (
    <Screen tabs>
      <Header
        title="Inbox"
        subtitle="New and changed rides wait here until you approve them."
        right={<Button small variant="primary" title="Add texts" onPress={() => router.push('/import')} />}
      />

      {data && !rides.length && !notices.length ? (
        <Empty title="Nothing to review" body="When new assignment texts come in, they’ll show up here first.">
          <ButtonRow>
            <Button title="Add a ride by hand" onPress={() => router.push({ pathname: '/ride/[id]', params: { id: 'new' } })} />
          </ButtonRow>
        </Empty>
      ) : null}

      {notices.length ? (
        <Section title="Changes from the church">
          {notices.map(({ notice, ride }) => (
            <Card key={notice.id} tone="warning">
              <Title>{notice.hint === 'cancellation' ? 'Possible cancellation' : 'Possible change'}</Title>
              <Body>
                {notice.passengerName ?? 'Unknown rider'} · {formatDate(notice.serviceDate)}
              </Body>
              <Body muted size={13}>
                {notice.rawText.slice(0, 220)}
                {notice.rawText.length > 220 ? '…' : ''}
              </Body>
              {!ride ? <Body muted>No matching ride found in ChurchRide.</Body> : null}
              <ButtonRow>
                {ride && notice.hint === 'cancellation' && ride.status !== 'cancelled' ? (
                  <Button
                    variant="danger"
                    title="Cancel this ride"
                    onPress={async () => {
                      await cancelRide(db, ride.id);
                      await resolveNotice(db, notice.id);
                    }}
                  />
                ) : null}
                {ride ? (
                  <Button title="Open ride" onPress={() => router.push({ pathname: '/ride/[id]', params: { id: ride.id } })} />
                ) : null}
                <Button variant="ghost" title="Dismiss" onPress={() => resolveNotice(db, notice.id)} />
              </ButtonRow>
            </Card>
          ))}
        </Section>
      ) : null}

      {rides.length ? (
        <Section
          title={`To review (${rides.length})`}
          right={
            clean.length > 1 ? (
              <Button small variant="ghost" title={busy === 'all' ? 'Approving…' : `Approve ${clean.length} with no flags`} disabled={!!busy} onPress={() => approveAllClean(clean)} />
            ) : null
          }>
          {rides.map((ride) => {
            const hasErrors = ride.issues.some((i) => i.severity === 'error');
            return (
              <Card key={ride.id} tone={hasErrors ? 'danger' : ride.issues.length ? 'warning' : 'default'}>
                <Title>{ride.passengerName ?? 'No name'}</Title>
                <Body>
                  {formatDate(ride.serviceDate)} · {formatWindow(ride.windowStart, ride.windowEnd)}
                </Body>
                <Body muted>
                  {legsLabel(ride.legs)}
                  {ride.persons ? ` · ${ride.persons} ${ride.persons === 1 ? 'person' : 'people'}` : ''}
                </Body>
                <Body>{ride.pickupAddress ?? 'No address'}</Body>
                {ride.phone ? <Body muted>{ride.phone}</Body> : null}
                {ride.source === 'ai' ? <Pill tone="warning" text="Read by AI" /> : null}
                <IssueList issues={ride.issues} />
                <ButtonRow>
                  <Button
                    variant="primary"
                    title={busy === ride.id ? 'Approving…' : 'Approve'}
                    disabled={hasErrors || !!busy}
                    onPress={() => approve(ride)}
                    accessibilityLabel={`Approve ride for ${ride.passengerName ?? 'rider'}`}
                  />
                  <Button title="Edit" onPress={() => router.push({ pathname: '/ride/[id]', params: { id: ride.id } })} />
                  <Button variant="danger" title="Discard" onPress={() => discard(ride)} />
                </ButtonRow>
              </Card>
            );
          })}
        </Section>
      ) : null}
    </Screen>
  );
}
