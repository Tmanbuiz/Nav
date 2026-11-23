// Siri and Shortcuts actions against real SQLite. Made-up riders only.
import { countInbox, listRidesByStatus, listTripsForDate, setTripStatus } from '@/db/repo';
import { migrate } from '@/db/schema';
import { saveSettings } from '@/db/settings';
import { openTestDb } from '@/db/test-db';

import { handleInvocation, loadStopRecords } from './intents';
import { approveRide } from './rides';

jest.mock('@/services/geo', () => ({
  geocode: jest.fn(async () => null),
  currentSpot: jest.fn(),
}));

const FOOTER = 'View Location on Google Maps Provide updates through the Church App . Kind regards, Church Administration Team';

function sms(name: string, phone: string, date: string, type = 'two-way') {
  return (
    `Transportation Assignment Dear Sample Driver, You have been assigned to provide transportation for the following member: ` +
    `Name: ${name} Number of Persons: 1 Phone Number: ${phone} Service Date: ${date} Pickup Time: 9:30 AM - 9:45 AM ` +
    `Transport Type: ${type} Pickup Address: 100 Example Street, Fredericton, NB ${FOOTER}`
  );
}

/** A service date that is always in the future, so the stop list includes it. */
const DATE = '2099-11-29';

async function setup() {
  const db = openTestDb();
  await migrate(db);
  await saveSettings(db, { driverName: 'Sample Driver' });
  return db;
}

test('the Shortcut action imports a text into the Inbox, and a replay changes nothing', async () => {
  const db = await setup();
  const inv = { id: 'inv-1', name: 'addAssignmentText', params: { text: sms('Jane Example', '+15065550101', DATE) } };

  expect(await handleInvocation(db, inv)).toBe('done');
  expect(await listRidesByStatus(db, 'review')).toHaveLength(1);

  // iOS can deliver the same action again: nothing new is created.
  expect(await handleInvocation(db, inv)).toBe('done');
  expect(await countInbox(db)).toBe(1);

  // Even a cancellation notice (not de-duplicated by ride) is only recorded once.
  const cancel = {
    id: 'inv-2',
    name: 'addAssignmentText',
    params: {
      text:
        'Transportation Assignment Cancelled Dear Sample Driver, the following assignment was cancelled: ' +
        `Name: Jane Example Phone Number: +15065550101 Service Date: ${DATE}`,
    },
  };
  await handleInvocation(db, cancel);
  await handleInvocation(db, cancel);
  expect(await countInbox(db)).toBe(2);
});

test('bad or unknown actions are discarded, not retried forever', async () => {
  const db = await setup();
  expect(await handleInvocation(db, { id: 'x1', name: 'addAssignmentText', params: { text: '   ' } })).toBe('discard');
  expect(await handleInvocation(db, { id: 'x2', name: 'addAssignmentText', params: {} })).toBe('discard');
  expect(await handleInvocation(db, { id: 'x3', name: 'somethingRetired', params: {} })).toBe('discard');
  expect(
    await handleInvocation(db, { id: 'x4', name: 'setTripStatus', params: { assignmentId: 'a', leg: 'sideways', status: 'done' } }),
  ).toBe('discard');
  expect(
    await handleInvocation(db, { id: 'x5', name: 'setTripStatus', params: { assignmentId: 'gone', leg: 'to-church', status: 'done' } }),
  ).toBe('discard');
});

test('Siri’s stop list follows the run, and "picked up" applies once', async () => {
  const db = await setup();
  expect(await loadStopRecords(db)).toEqual([]);

  await handleInvocation(db, { id: 'i1', name: 'addAssignmentText', params: { text: sms('Jane Example', '+15065550101', DATE) } });
  await handleInvocation(db, {
    id: 'i2',
    name: 'addAssignmentText',
    params: { text: sms('John Sample', '+15065550102', DATE, 'pick-up') },
  });
  // Rides in review are not on the run yet.
  expect(await loadStopRecords(db)).toEqual([]);

  for (const ride of await listRidesByStatus(db, 'review')) {
    expect(await approveRide(db, ride.id)).toEqual({ ok: true });
  }

  const records = await loadStopRecords(db);
  expect(records.map((r) => [r.title, r.metadata.leg, r.metadata.order, r.metadata.status])).toEqual([
    ['Jane Example', 'to-church', '1', 'pending'],
    ['John Sample', 'to-church', '2', 'pending'],
    ['Jane Example', 'from-church', '1', 'pending'],
  ]);
  expect(records[0]?.metadata.windowSpoken).toBe('between 9:30 and 9:45 AM');
  expect(records.every((r) => r.hideInSpotlight)).toBe(true);

  const jane = records[0]!;
  const pickedUp = {
    id: 'siri-1',
    name: 'setTripStatus',
    params: { assignmentId: jane.metadata.assignmentId, leg: 'to-church', status: 'done' },
  };
  expect(await handleInvocation(db, pickedUp)).toBe('done');
  const trips = await listTripsForDate(db, DATE);
  expect(trips.find((t) => t.assignmentId === jane.metadata.assignmentId && t.leg === 'to-church')?.status).toBe('done');

  // Undo in the app, then the same Siri action arrives again: it must not re-apply.
  await setTripStatus(db, jane.metadata.assignmentId!, 'to-church', 'pending');
  expect(await handleInvocation(db, pickedUp)).toBe('done');
  const after = await listTripsForDate(db, DATE);
  expect(after.find((t) => t.assignmentId === jane.metadata.assignmentId && t.leg === 'to-church')?.status).toBe('pending');

  // The app's newer change carries a newer timestamp, so Siri's earlier mark no longer hides the stop.
  const refreshed = await loadStopRecords(db);
  expect(Number(refreshed[0]?.metadata.statusUpdatedAt)).toBeGreaterThan(0);
});
