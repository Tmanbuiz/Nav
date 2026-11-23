// The share sheet against real SQLite, with the native share and the screenshot reader faked.
// Made-up riders only.
import { redirectSystemPath } from '@/app/+native-intent';
import { getRide, listOpenNotices, listRidesByStatus } from '@/db/repo';
import { migrate } from '@/db/schema';
import { saveSettings } from '@/db/settings';
import { openTestDb } from '@/db/test-db';

import { importPendingShare, pendingShare, recentSharedImport } from './share';

type Payload = { shareType: string; value: string; mimeType?: string };

const mockShare: { payloads: Payload[]; cleared: number } = { payloads: [], cleared: 0 };
const mockPictures: Record<string, string | (() => string)> = {};

jest.mock('expo-sharing', () => ({
  getSharedPayloads: jest.fn(() => mockShare.payloads),
  clearSharedPayloads: jest.fn(() => {
    mockShare.payloads = [];
    mockShare.cleared += 1;
  }),
}));

jest.mock('./screenshot-text', () => ({
  readScreenshotText: jest.fn(async (uri: string) => {
    const picture = mockPictures[uri];
    if (picture === undefined) throw new Error('unreadable');
    return typeof picture === 'function' ? picture() : picture;
  }),
}));

jest.mock('@/services/geo', () => ({
  geocode: jest.fn(async () => null),
  currentSpot: jest.fn(),
}));

const FOOTER = 'View Location on Google Maps Provide updates through the Church App . Kind regards, Church Administration Team';
const DATE = '2099-11-29';

function sms(name: string, phone: string, time = '9:30 AM - 9:45 AM') {
  return (
    `Transportation Assignment Dear Sample Driver, You have been assigned to provide transportation for the following member: ` +
    `Name: ${name} Number of Persons: 1 Phone Number: ${phone} Service Date: ${DATE} Pickup Time: ${time} ` +
    `Transport Type: two-way Pickup Address: 100 Example Street, Fredericton, NB ${FOOTER}`
  );
}

/** How a screenshot reads: the phone's own text around the message, broken into short lines. */
function screenshotOf(message: string) {
  const words = message.split(' ');
  const lines: string[] = ['9:41', 'Church Office', 'Text Message', 'Today 9:12 AM'];
  for (let i = 0; i < words.length; i += 6) lines.push(words.slice(i, i + 6).join(' '));
  lines.push('Delivered');
  return lines.join('\n');
}

async function setup() {
  const db = openTestDb();
  await migrate(db);
  await saveSettings(db, { driverName: 'Sample Driver' });
  mockShare.payloads = [];
  mockShare.cleared = 0;
  for (const key of Object.keys(mockPictures)) delete mockPictures[key];
  return db;
}

test('the share link opens the import screen; other links are left alone', () => {
  expect(redirectSystemPath({ path: 'churchride://expo-sharing', initial: true })).toBe('/import?shared=1');
  expect(redirectSystemPath({ path: 'churchride://import?text=Hi', initial: false })).toBe('churchride://import?text=Hi');
});

test('shared texts and screenshots go to the Inbox, screenshot rides are flagged, and the share is cleared', async () => {
  const db = await setup();
  mockPictures['file:///shared/john.png'] = screenshotOf(sms('John Sample', '+15065550102'));
  mockPictures['file:///shared/blank.png'] = '';
  mockShare.payloads = [
    { shareType: 'text', value: sms('Jane Example', '+15065550101'), mimeType: 'text/plain' },
    { shareType: 'image', value: 'file:///shared/john.png', mimeType: 'image/png' },
    { shareType: 'image', value: 'file:///shared/blank.png', mimeType: 'image/png' },
    { shareType: 'image', value: 'file:///shared/broken.png', mimeType: 'image/png' },
    { shareType: 'url', value: 'https://example.com', mimeType: 'text/html' },
  ];

  // Two screens asking at once share one run.
  const [result, same] = await Promise.all([importPendingShare(db), importPendingShare(db)]);
  expect(same).toBe(result);
  expect(result?.summary).toEqual({ created: 2, changed: 0, duplicates: 0, notices: 0, ignored: 0 });
  expect(result?.unreadable).toBe(2);
  expect(result?.skipped).toBe(1);
  expect(result?.text).toContain('Name: Jane Example');
  expect(result?.text).toContain('Today 9:12 AM');

  const rides = await listRidesByStatus(db, 'review');
  const jane = rides.find((r) => r.passengerName === 'Jane Example');
  const john = rides.find((r) => r.passengerName === 'John Sample');
  expect(jane?.source).toBe('share');
  expect(jane?.issues).toEqual([]);
  expect(john?.source).toBe('screenshot');
  expect(john?.phone).toBe('+15065550102');
  expect(john?.pickupAddress).toBe('100 Example Street, Fredericton, NB');
  expect(john?.issues.map((i) => i.code)).toEqual(['screenshot']);

  expect(mockShare.cleared).toBe(1);
  expect(pendingShare()).toEqual([]);
  expect(recentSharedImport()).toBe(result);
  expect(recentSharedImport(Date.now() + 3 * 60_000)).toBeNull();
  expect(await importPendingShare(db)).toBeNull();
});

test('a screenshot never changes a saved ride: a difference becomes a notice', async () => {
  const db = await setup();
  mockShare.payloads = [{ shareType: 'text', value: sms('Jane Example', '+15065550101') }];
  await importPendingShare(db);
  const [jane] = await listRidesByStatus(db, 'review');

  mockPictures['file:///shared/jane.png'] = screenshotOf(sms('Jane Example', '+15065550101', '8:30 AM - 9:45 AM'));
  mockShare.payloads = [{ shareType: 'image', value: 'file:///shared/jane.png' }];
  const result = await importPendingShare(db);
  expect(result?.summary).toEqual({ created: 0, changed: 0, duplicates: 0, notices: 1, ignored: 0 });

  const saved = await getRide(db, jane!.id);
  expect(saved?.windowStart).toBe('09:30');
  expect(saved?.source).toBe('share');
  const [notice] = await listOpenNotices(db);
  expect(notice?.assignmentId).toBe(jane!.id);
  expect(notice?.details).toMatch(/^The screenshot doesn’t match the saved ride: pickup time\. The saved ride wasn’t changed/);
});

test('something shared while a share is being read is imported too, before the share is cleared', async () => {
  const db = await setup();
  mockPictures['file:///shared/first.png'] = () => {
    // A second share lands while the first picture is being read.
    mockShare.payloads = [{ shareType: 'text', value: sms('John Sample', '+15065550102') }];
    return screenshotOf(sms('Jane Example', '+15065550101'));
  };
  mockShare.payloads = [{ shareType: 'image', value: 'file:///shared/first.png' }];

  const result = await importPendingShare(db);
  expect(result?.summary.created).toBe(2);
  expect((await listRidesByStatus(db, 'review')).map((r) => r.source).sort()).toEqual(['screenshot', 'share']);
  expect(mockShare.cleared).toBe(1);
  expect(pendingShare()).toEqual([]);
});
