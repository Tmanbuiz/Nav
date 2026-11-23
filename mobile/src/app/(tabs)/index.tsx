import { router } from 'expo-router';
import { useSQLiteContext, type SQLiteDatabase } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet } from 'react-native';

import { placeFor, StopCard } from '@/components/stop-card';
import { Body, Button, ButtonRow, Card, Empty, Header, Pill, Screen, Section, Title } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { directionsUrl, type Place } from '@/core/maps';
import type { Leg } from '@/core/parser/assignmentParser';
import { planSchedule, type Point } from '@/core/route';
import { formatClock, formatDate, formatMinutes, todayISO, toMinutes } from '@/core/time';
import {
  countInbox,
  listTripsForDate,
  listUpcomingDates,
  setTripOrder,
  setTripStatus,
  stopPoint,
  type Trip,
  type TripStatus,
} from '@/db/repo';
import { loadSettings, type Settings } from '@/db/settings';
import { useDataVersion } from '@/hooks/use-data-version';
import { openExternal } from '@/services/open';
import { suggestDayOrder } from '@/services/rides';

interface DayData {
  dates: string[];
  date: string | null;
  trips: Trip[];
  settings: Settings;
  inbox: number;
}

async function loadDay(db: SQLiteDatabase, wanted: string | null): Promise<DayData> {
  const [dates, settings, inbox] = await Promise.all([
    listUpcomingDates(db, todayISO()),
    loadSettings(db),
    countInbox(db),
  ]);
  const date = wanted && dates.includes(wanted) ? wanted : (dates[0] ?? null);
  const trips = date ? await listTripsForDate(db, date) : [];
  return { dates, date, trips, settings, inbox };
}

function pointOf(lat: number | null, lng: number | null): Point | null {
  return lat !== null && lng !== null ? { lat, lng } : null;
}

export default function TodayScreen() {
  const db = useSQLiteContext();
  const version = useDataVersion();
  const [wanted, setWanted] = useState<string | null>(null);
  const [data, setData] = useState<DayData | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    loadDay(db, wanted).then((d) => {
      if (alive) setData(d);
    });
    return () => {
      alive = false;
    };
  }, [db, version, wanted]);

  if (!data) {
    return (
      <Screen tabs>
        <Header title="Today" />
      </Screen>
    );
  }

  const { dates, date, trips, settings, inbox } = data;
  const toChurch = trips.filter((t) => t.leg === 'to-church');
  const fromChurch = trips.filter((t) => t.leg === 'from-church');
  const pendingTo = toChurch.filter((t) => t.status === 'pending');
  const seatsUsed = toChurch.filter((t) => t.status !== 'no-show').reduce((n, t) => n + (t.ride.persons ?? 1), 0);
  const church = pointOf(settings.churchLat, settings.churchLng);
  const home = pointOf(settings.homeLat, settings.homeLng);
  const schedule = planSchedule(
    pendingTo.map((t) => ({
      point: stopPoint(t),
      windowStart: toMinutes(t.ride.windowStart),
      windowEnd: toMinutes(t.ride.windowEnd),
    })),
    { start: home, end: church },
  );
  const etaFor = (t: Trip) => {
    const i = pendingTo.indexOf(t);
    return i >= 0 ? (schedule.etas[i] ?? null) : null;
  };
  const lateFor = (t: Trip) => {
    const i = pendingTo.indexOf(t);
    return i >= 0 ? (schedule.late[i] ?? false) : false;
  };

  const move = (leg: Leg, list: Trip[], index: number, direction: -1 | 1) => {
    const ids = list.map((t) => t.assignmentId);
    const target = index + direction;
    const a = ids[index];
    const b = ids[target];
    if (a === undefined || b === undefined) return;
    ids[index] = b;
    ids[target] = a;
    setTripOrder(db, leg, ids);
  };

  const setStatus = (trip: Trip, status: TripStatus) => setTripStatus(db, trip.assignmentId, trip.leg, status);

  const suggest = async (leg: Leg) => {
    setBusy(true);
    try {
      const { unlocated } = await suggestDayOrder(db, trips, leg);
      if (unlocated) {
        Alert.alert(
          'Order suggested',
          `${unlocated} stop${unlocated > 1 ? 's' : ''} couldn’t be found on the map and went last. Check the order before you leave.`,
        );
      }
    } finally {
      setBusy(false);
    }
  };

  const startRoute = async (leg: Leg) => {
    const pending = (leg === 'to-church' ? toChurch : fromChurch).filter((t) => t.status === 'pending');
    if (!pending.length) {
      Alert.alert(leg === 'to-church' ? 'Everyone is picked up' : 'Everyone is dropped off');
      return;
    }
    const stops: Place[] = pending.map(placeFor);
    const churchPlace: Place | null = settings.churchAddress.trim() ? { address: settings.churchAddress } : null;
    let input: { stops: Place[]; destination: Place };
    if (leg === 'to-church' && churchPlace) {
      input = { stops, destination: churchPlace };
    } else {
      const last = stops[stops.length - 1] as Place;
      input = { stops: stops.slice(0, -1), destination: last };
    }
    const link = directionsUrl(settings.mapsApp, input);
    if (!link) {
      Alert.alert('No address to route to', 'Add the pickup addresses first.');
      return;
    }
    const go = () => openExternal(link.url);
    if (link.skipped) {
      Alert.alert(
        'Some stops left out',
        `${link.skipped} stop${link.skipped > 1 ? 's were' : ' was'} left out (no address, or past Google Maps’ 9-stop limit).`,
        [{ text: 'Open anyway', onPress: go }, { text: 'Cancel', style: 'cancel' }],
      );
    } else {
      go();
    }
  };

  const mapsName = settings.mapsApp === 'apple' ? 'Apple Maps' : 'Google Maps';

  return (
    <Screen tabs>
      <Header
        title={date ? formatDate(date) : 'Today'}
        subtitle={
          date
            ? `${toChurch.length} rider${toChurch.length === 1 ? '' : 's'} to church · ${fromChurch.length} home after`
            : undefined
        }
        right={<Button small variant="primary" title="Add texts" onPress={() => router.push('/import')} />}
      />

      {dates.length > 1 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.dates}>
          {dates.map((d) => (
            <Button key={d} small variant={d === date ? 'primary' : 'secondary'} title={formatDate(d)} onPress={() => setWanted(d)} />
          ))}
        </ScrollView>
      ) : null}

      {inbox > 0 ? (
        <Card tone="warning">
          <Body bold>
            {inbox} item{inbox > 1 ? 's' : ''} waiting in your Inbox
          </Body>
          <Body muted>New or changed rides only show here after you approve them.</Body>
          <ButtonRow>
            <Button small title="Open Inbox" onPress={() => router.navigate('/inbox')} />
          </ButtonRow>
        </Card>
      ) : null}

      {!date ? (
        <Empty
          title="No rides coming up"
          body="Copy the assignment texts from Messages (or set up the Shortcut in Settings), then add them here.">
          <ButtonRow>
            <Button variant="primary" title="Add texts" onPress={() => router.push('/import')} />
            <Button title="Add a ride by hand" onPress={() => router.push({ pathname: '/ride/[id]', params: { id: 'new' } })} />
          </ButtonRow>
        </Empty>
      ) : (
        <>
          <Section title="To church">
            <Card>
              <Title>
                {seatsUsed} of {settings.seats} seats
              </Title>
              {seatsUsed > settings.seats ? <Pill tone="danger" text="More riders than seats: tell the coordinator" /> : null}
              {schedule.leaveBy !== null ? <Body>Leave by about {formatMinutes(schedule.leaveBy)}</Body> : null}
              {schedule.arriveEnd !== null ? <Body>Reach church about {formatMinutes(schedule.arriveEnd)}</Body> : null}
              {schedule.leaveBy === null && pendingTo.length ? (
                <Body muted>
                  {home
                    ? 'Tap “Suggest order” to get leave-by and arrival estimates.'
                    : 'Add a start address in Settings to get a leave-by time.'}
                </Body>
              ) : null}
              <Body muted size={13}>
                Times are rough estimates from straight-line distance. Allow extra for river crossings.
              </Body>
              {!settings.churchAddress.trim() ? (
                <Body muted size={13}>Add your church’s address in Settings so the route ends there.</Body>
              ) : null}
              <ButtonRow>
                <Button variant="primary" title={`Start route in ${mapsName}`} onPress={() => startRoute('to-church')} disabled={!pendingTo.length} />
                <Button title={busy ? 'Working…' : 'Suggest order'} onPress={() => suggest('to-church')} disabled={busy || pendingTo.length < 2} />
              </ButtonRow>
            </Card>
            {toChurch.map((trip, index) => (
              <StopCard
                key={`${trip.assignmentId}-to`}
                trip={trip}
                position={index + 1}
                eta={etaFor(trip)}
                late={lateFor(trip)}
                settings={settings}
                canMoveUp={index > 0}
                canMoveDown={index < toChurch.length - 1}
                onMove={(direction) => move('to-church', toChurch, index, direction)}
                onStatus={(status) => setStatus(trip, status)}
              />
            ))}
          </Section>

          {fromChurch.length ? (
            <Section title={`After service (about ${formatClock(settings.serviceEnd)})`}>
              <Card>
                <ButtonRow>
                  <Button
                    variant="primary"
                    title={`Start return route in ${mapsName}`}
                    onPress={() => startRoute('from-church')}
                    disabled={!fromChurch.some((t) => t.status === 'pending')}
                  />
                  <Button
                    title="Suggest order"
                    onPress={() => suggest('from-church')}
                    disabled={busy || fromChurch.filter((t) => t.status === 'pending').length < 2}
                  />
                </ButtonRow>
              </Card>
              {fromChurch.map((trip, index) => (
                <StopCard
                  key={`${trip.assignmentId}-from`}
                  trip={trip}
                  position={index + 1}
                  eta={null}
                  late={false}
                  settings={settings}
                  canMoveUp={index > 0}
                  canMoveDown={index < fromChurch.length - 1}
                  onMove={(direction) => move('from-church', fromChurch, index, direction)}
                  onStatus={(status) => setStatus(trip, status)}
                />
              ))}
            </Section>
          ) : null}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  dates: { gap: Spacing.two },
});
