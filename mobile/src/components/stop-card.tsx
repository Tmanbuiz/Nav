import { router } from 'expo-router';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { fillTemplate, firstName, singleStopUrl, smsUrl, telUrl, type Place } from '@/core/maps';
import { formatMinutes, formatWindow } from '@/core/time';
import { hasSavedSpot, type Trip, type TripStatus } from '@/db/repo';
import type { Settings } from '@/db/settings';
import { openExternal as open } from '@/services/open';

import { Body, Button, ButtonRow, Card, Pill, Title } from './ui';

/** Where Maps should go for this stop: the saved door spot when there is one, else the address. */
export function placeFor(trip: Trip): Place {
  const spot = hasSavedSpot(trip) ? trip.regular : null;
  return { address: trip.ride.pickupAddress, lat: spot?.spotLat ?? null, lng: spot?.spotLng ?? null };
}

export function StopCard({
  trip,
  position,
  eta,
  late,
  settings,
  canMoveUp,
  canMoveDown,
  onMove,
  onStatus,
}: {
  trip: Trip;
  position: number;
  eta: number | null;
  late: boolean;
  settings: Settings;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMove: (direction: -1 | 1) => void;
  onStatus: (status: TripStatus) => void;
}) {
  const { ride, regular, leg, status } = trip;
  const toChurch = leg === 'to-church';
  const name = ride.passengerName ?? 'Rider';
  const phone = ride.phone;
  const vars = {
    first: firstName(name) || 'there',
    name,
    driver: firstName(settings.driverName) || 'your driver',
  };
  const saved = hasSavedSpot(trip);
  const done = status === 'done';
  const noShow = status === 'no-show';

  const text = (template: string) => (phone ? open(smsUrl(phone, fillTemplate(template, vars), Platform.OS)) : null);

  return (
    <Card tone={late && status === 'pending' ? 'warning' : 'default'} style={(done || noShow) && styles.finished}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open ${name}'s ride details`}
        onPress={() => router.push({ pathname: '/ride/[id]', params: { id: ride.id } })}>
        <Title>
          {position}. {name}
        </Title>
        <Body muted>
          {toChurch ? formatWindow(ride.windowStart, ride.windowEnd) : 'After service'}
          {ride.persons && ride.persons > 1 ? ` · ${ride.persons} people` : ''}
          {eta !== null && status === 'pending' ? ` · arrive ~${formatMinutes(eta)}` : ''}
        </Body>
        <Body>{ride.pickupAddress ?? 'No address'}</Body>
        {regular?.notes ? <Body muted>Note: {regular.notes}</Body> : null}
      </Pressable>

      <View style={styles.pills}>
        {done ? <Pill tone="success" text={toChurch ? 'Picked up' : 'Dropped off'} /> : null}
        {noShow ? <Pill tone="danger" text="No-show" /> : null}
        {late && status === 'pending' ? <Pill tone="warning" text="May be late (estimate)" /> : null}
        {saved ? <Pill tone="success" text="Exact spot saved" /> : null}
        {!saved && ride.addressKind === 'place' ? <Pill tone="warning" text="Confirm pickup spot" /> : null}
      </View>

      {status === 'pending' ? (
        <>
          <ButtonRow>
            {phone ? <Button small title="Call" onPress={() => open(telUrl(phone))} /> : null}
            {phone && toChurch ? <Button small title="On my way" onPress={() => text(settings.onMyWayText)} /> : null}
            {phone && toChurch ? <Button small title="I'm outside" onPress={() => text(settings.outsideText)} /> : null}
            <Button
              small
              title="Directions"
              onPress={() => open(singleStopUrl(settings.mapsApp, placeFor(trip)))}
              accessibilityLabel={`Directions to ${name}`}
            />
          </ButtonRow>
          <ButtonRow>
            <Button
              variant="primary"
              title={toChurch ? 'Picked up' : 'Dropped off'}
              onPress={() => onStatus('done')}
              accessibilityLabel={`Mark ${name} ${toChurch ? 'picked up' : 'dropped off'}`}
            />
            {toChurch ? (
              <Button variant="danger" title="No-show" onPress={() => onStatus('no-show')} accessibilityLabel={`Mark ${name} as a no-show`} />
            ) : null}
            <Button small variant="ghost" title="Move up" disabled={!canMoveUp} onPress={() => onMove(-1)} accessibilityLabel={`Move ${name} earlier`} />
            <Button small variant="ghost" title="Move down" disabled={!canMoveDown} onPress={() => onMove(1)} accessibilityLabel={`Move ${name} later`} />
          </ButtonRow>
        </>
      ) : (
        <ButtonRow>
          <Button small variant="ghost" title="Undo" onPress={() => onStatus('pending')} accessibilityLabel={`Undo status for ${name}`} />
        </ButtonRow>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  finished: { opacity: 0.7 },
});
