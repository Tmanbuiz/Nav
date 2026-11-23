/// <reference types="node" />
/**
 * Runs the real storage code and SQL against SQLite (Node's built-in engine) through a
 * small adapter with expo-sqlite's async method names. Made-up riders only.
 */
import { approveRide, importText, suggestDayOrder } from '@/services/rides';

import {
  cancelRide,
  countInbox,
  exportAll,
  getRegular,
  getRide,
  isInvocationProcessed,
  listOpenNotices,
  listRegulars,
  listRidesByStatus,
  listTripsForDate,
  listUpcomingDates,
  saveRegularSpot,
  setTripOrder,
  setTripStatus,
  setTripStatusOnce,
  stopPoint,
  updateRegular,
} from './repo';
import { migrate } from './schema';
import { openTestDb } from './test-db';
import { loadSettings, saveSettings } from './settings';

jest.mock('@/services/geo', () => ({
  // Fake geocoder: a few known made-up places, everything else unknown.
  geocode: jest.fn(async (address: string | null) => {
    const places: Record<string, { lat: number; lng: number }> = {
      '1 Church Street, Fredericton, NB': { lat: 45.96, lng: -66.64 },
      '100 Example Street, Fredericton, NB, Canada': { lat: 45.95, lng: -66.65 },
      '200 Sample Road, Fredericton, NB, Canada': { lat: 45.97, lng: -66.63 },
      '766 Example Street, Vancouver, BC, Canada': { lat: 49.26, lng: -123.1 },
    };
    return (address && places[address]) ?? null;
  }),
  currentSpot: jest.fn(),
}));

const FOOTER = 'View Location on Google Maps Provide updates through the Church App . Kind regards, Church Administration Team';
const DATE = '2099-11-22';

function sms(name: string, phone: string, address: string, type = 'two-way', time = '9:30 AM - 9:45 AM') {
  return (
    `Transportation Assignment Dear Sample Driver, You have been assigned to provide transportation for the following member: ` +
    `Name: ${name} Number of Persons: 1 Phone Number: ${phone} Service Date: ${DATE} Pickup Time: ${time} ` +
    `Transport Type: ${type} Pickup Address: ${address} ${FOOTER}`
  );
}

const JANE = sms('Jane Example', '+15065550101', '100 Example Street, Fredericton, NB, Canada');
const JOHN = sms('John Sample', '+15065550102', '200 Sample Road, Fredericton, NB, Canada', 'pick-up');
const HALL = sms('Ann Sample', '+15065550103', 'Maple Hall Residence, College Drive, Fredericton, NB', 'pick-up');
const AWAY = sms('Ben Sample', '+15065550104', '766 Example Street, Vancouver, BC, Canada');

async function setup() {
  const db = openTestDb();
  await migrate(db);
  await saveSettings(db, { driverName: 'Sample Driver', churchAddress: '1 Church Street, Fredericton, NB' });
  return db;
}

test('migrations run once and are idempotent', async () => {
  const db = await setup();
  await migrate(db);
  const version = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  expect(version?.user_version).toBe(3);
});

test('import → review → approve → today’s trips, end to end', async () => {
  const db = await setup();

  const summary = await importText(db, [JANE, JOHN, HALL, AWAY].join(' '), 'paste');
  expect(summary).toEqual({ created: 4, changed: 0, duplicates: 0, notices: 0, ignored: 0 });
  expect(await countInbox(db)).toBe(4);

  // Pasting the same texts again saves nothing new.
  expect((await importText(db, JANE, 'paste')).duplicates).toBe(1);

  const review = await listRidesByStatus(db, 'review');
  const byName = Object.fromEntries(review.map((r) => [r.passengerName ?? '', r] as const));
  expect(byName['Ann Sample']?.issues.map((i) => i.code)).toEqual(['place-address']);
  expect(byName['Ben Sample']?.issues.map((i) => i.code)).toEqual(['other-province']);

  // Clean rides approve and get trips; a church is geocoded and cached on the way.
  expect(await approveRide(db, byName['Jane Example']!.id)).toEqual({ ok: true });
  expect(await approveRide(db, byName['John Sample']!.id)).toEqual({ ok: true });
  expect(await approveRide(db, byName['Ann Sample']!.id)).toEqual({ ok: true });
  expect((await loadSettings(db)).churchLat).toBe(45.96);

  // The Vancouver pickup is held once with a distance flag...
  const held = await approveRide(db, byName['Ben Sample']!.id);
  expect(held.ok).toBe(false);
  const ben = (await listRidesByStatus(db, 'review')).find((r) => r.passengerName === 'Ben Sample');
  expect(ben?.issues.map((i) => i.code)).toEqual(['other-province', 'far-from-church']);
  // ...and only goes through on a deliberate second approve.
  expect(await approveRide(db, ben!.id)).toEqual({ ok: true });

  expect(await listUpcomingDates(db, '2099-01-01')).toEqual([DATE]);
  const trips = await listTripsForDate(db, DATE);
  const to = trips.filter((t) => t.leg === 'to-church');
  const from = trips.filter((t) => t.leg === 'from-church');
  expect(to).toHaveLength(4);
  expect(from.map((t) => t.ride.passengerName).sort()).toEqual(['Ben Sample', 'Jane Example']);
  expect(to.every((t) => t.regular !== null)).toBe(true);
  expect(await listRegulars(db)).toHaveLength(4);

  // Ordering puts located stops first; the unlocated residence goes last.
  const { unlocated } = await suggestDayOrder(db, trips, 'to-church');
  expect(unlocated).toBe(1);
  const ordered = (await listTripsForDate(db, DATE)).filter((t) => t.leg === 'to-church');
  expect(ordered[ordered.length - 1]?.ride.passengerName).toBe('Ann Sample');

  // Manual reorder and statuses stick.
  await setTripOrder(db, 'to-church', [...ordered].reverse().map((t) => t.assignmentId));
  await setTripStatus(db, ordered[0]!.assignmentId, 'to-church', 'done');
  const after = (await listTripsForDate(db, DATE)).filter((t) => t.leg === 'to-church');
  expect(after[0]?.ride.passengerName).toBe('Ann Sample');
  expect(after.find((t) => t.assignmentId === ordered[0]!.assignmentId)?.status).toBe('done');
});

test('texts arriving together import one at a time without clashing', async () => {
  const db = await setup();
  const [first, second, other] = await Promise.all([
    importText(db, JANE, 'link'),
    importText(db, JANE, 'link'),
    importText(db, JOHN, 'link'),
  ]);
  expect(first.created + second.created).toBe(1);
  expect(first.duplicates + second.duplicates).toBe(1);
  expect(other.created).toBe(1);
  expect(await listRidesByStatus(db, 'review')).toHaveLength(2);
});

test('Siri and Shortcut actions apply once, even when delivered twice', async () => {
  const db = await setup();
  const NOTHING = { created: 0, changed: 0, duplicates: 0, notices: 0, ignored: 0 };

  // The import and its action ID are saved together, so a second delivery is skipped outright.
  const add = { id: 'action-1', name: 'addAssignmentText' };
  expect((await importText(db, JANE, 'shortcut', add)).created).toBe(1);
  expect(await isInvocationProcessed(db, 'action-1')).toBe(true);
  expect(await importText(db, JANE, 'shortcut', add)).toEqual(NOTHING);

  const jane = (await listRidesByStatus(db, 'review'))[0]!;
  expect(jane.source).toBe('shortcut');
  expect(await approveRide(db, jane.id)).toEqual({ ok: true });

  // "Picked up" applies once. If the driver then undoes it in the app, a late copy of the
  // same action must not mark it done again.
  const pickedUp = { assignmentId: jane.id, leg: 'to-church' as const, status: 'done' as const, invocationId: 'action-2' };
  expect(await setTripStatusOnce(db, pickedUp)).toBe('applied');
  expect((await listTripsForDate(db, DATE)).find((t) => t.leg === 'to-church')?.status).toBe('done');
  await setTripStatus(db, jane.id, 'to-church', 'pending');
  expect(await setTripStatusOnce(db, pickedUp)).toBe('already-applied');
  const trip = (await listTripsForDate(db, DATE)).find((t) => t.leg === 'to-church');
  expect(trip?.status).toBe('pending');
  expect(trip?.updatedAt).not.toBe('');

  // An action for a ride that's gone is still recorded, so it isn't retried forever.
  const gone = { ...pickedUp, assignmentId: 'no-such-ride', invocationId: 'action-3' };
  expect(await setTripStatusOnce(db, gone)).toBe('no-such-trip');
  expect(await isInvocationProcessed(db, 'action-3')).toBe(true);
});

test('a screenshot that differs from a saved ride leaves it alone and stores a notice saying what differs', async () => {
  const db = await setup();
  await importText(db, JANE, 'paste');
  const [jane] = await listRidesByStatus(db, 'review');
  const other = sms('Jane Example', '+15065550101', '102 Example Street, Fredericton, NB', 'two-way', '8:30 AM - 9:45 AM');

  expect(await importText(db, other, 'screenshot')).toEqual({ created: 0, changed: 0, duplicates: 0, notices: 1, ignored: 0 });
  const ride = await getRide(db, jane!.id);
  expect(ride?.pickupAddress).toBe('100 Example Street, Fredericton, NB, Canada');
  expect(ride?.windowStart).toBe('09:30');
  const [notice] = await listOpenNotices(db);
  expect(notice).toEqual(
    expect.objectContaining({ hint: 'update', assignmentId: jane!.id, passengerName: 'Jane Example', serviceDate: DATE }),
  );
  expect(notice?.details).toBe(
    'The screenshot doesn’t match the saved ride: pickup time and pickup address. ' +
      'The saved ride wasn’t changed. Open it to compare, and edit it if the screenshot is right.',
  );
  expect(notice?.rawText).toBe(other);

  // A new rider in a screenshot is saved for review, marked as read from a picture.
  expect((await importText(db, JOHN, 'screenshot')).created).toBe(1);
  const john = (await listRidesByStatus(db, 'review')).find((r) => r.passengerName === 'John Sample');
  expect(john?.source).toBe('screenshot');
  expect(john?.issues.map((i) => i.code)).toEqual(['screenshot']);
});

test('a saved door spot is used for routing and cleared when the address changes', async () => {
  const db = await setup();
  await importText(db, HALL, 'paste');
  const [ride] = await listRidesByStatus(db, 'review');
  await approveRide(db, ride!.id);
  const [trip] = await listTripsForDate(db, DATE);
  const regularId = trip!.regular!.id;

  await saveRegularSpot(db, regularId, { lat: 45.945, lng: -66.641 });
  const [withSpot] = await listTripsForDate(db, DATE);
  expect(stopPoint(withSpot!)).toEqual({ lat: 45.945, lng: -66.641 });

  // Next week's text for the same rider no longer needs the place flag.
  const nextWeek = HALL.replace(DATE, '2099-11-29');
  await importText(db, nextWeek, 'paste');
  const next = (await listRidesByStatus(db, 'review')).find((r) => r.serviceDate === '2099-11-29');
  expect(next?.issues).toEqual([]);

  await updateRegular(db, regularId, { name: 'Ann Sample', pickupAddress: '5 New Street, Fredericton', notes: 'side door' });
  const moved = await getRegular(db, regularId);
  expect(moved?.spotSaved).toBe(false);
  expect(moved?.notes).toBe('side door');
});

test('a changed time sends a confirmed ride back to review; cancellations become notices', async () => {
  const db = await setup();
  await importText(db, JANE, 'paste');
  const [ride] = await listRidesByStatus(db, 'review');
  await approveRide(db, ride!.id);
  expect(await listTripsForDate(db, DATE)).toHaveLength(2);

  const changed = await importText(db, JANE.replace('9:30 AM - 9:45 AM', '10:00 AM - 10:15 AM'), 'link');
  expect(changed.changed).toBe(1);
  const [again] = await listRidesByStatus(db, 'review');
  expect(again?.windowStart).toBe('10:00');
  expect(again?.issues.map((i) => i.code)).toEqual(['changed']);
  expect(await listTripsForDate(db, DATE)).toHaveLength(0);
  await approveRide(db, again!.id);
  expect(await listTripsForDate(db, DATE)).toHaveLength(2);

  const cancel =
    'Transportation Assignment Cancelled Dear Sample Driver, the following assignment was cancelled: ' +
    `Name: Jane Example Phone Number: +15065550101 Service Date: ${DATE}`;
  expect((await importText(db, cancel, 'link')).notices).toBe(1);
  const [notice] = await listOpenNotices(db);
  expect(notice?.assignmentId).toBe(ride!.id);
  await cancelRide(db, ride!.id);
  expect(await listTripsForDate(db, DATE)).toHaveLength(0);
});

test('backup export leaves out the AI token', async () => {
  const db = await setup();
  await saveSettings(db, { aiToken: 'secret-token', aiUrl: 'https://example.workers.dev' });
  await importText(db, JANE, 'paste');
  const backup = await exportAll(db);
  const text = JSON.stringify(backup);
  expect(text).not.toContain('secret-token');
  expect(text).toContain('example.workers.dev');
  expect((backup.assignments as unknown[]).length).toBe(1);
});
