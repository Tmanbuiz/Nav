// Made-up riders only.
import { buildStopRecords, stopId, type StopForSiri } from './siri';
import { formatDateLong, formatSpokenWindow } from './time';

const base: StopForSiri = {
  assignmentId: 'a1',
  leg: 'to-church',
  status: 'pending',
  passengerName: 'Jane Example',
  pickupAddress: '100 Example Street, Fredericton, NB',
  windowStart: '09:30',
  windowEnd: '09:45',
  serviceDate: '2026-11-29',
  statusUpdatedAt: '2026-11-28T15:00:00.000Z',
};

test('spoken dates and windows', () => {
  expect(formatDateLong('2026-11-29')).toBe('Sunday, November 29');
  expect(formatSpokenWindow('09:30', '09:45')).toBe('between 9:30 and 9:45 AM');
  expect(formatSpokenWindow('11:30', '12:15')).toBe('between 11:30 AM and 12:15 PM');
  expect(formatSpokenWindow('09:30', '09:30')).toBe('at 9:30 AM');
  expect(formatSpokenWindow(null, null)).toBe('');
});

test('records carry everything the Swift intents read, in driving order per leg', () => {
  const records = buildStopRecords([
    base,
    { ...base, assignmentId: 'a2', passengerName: 'John Sample', status: 'done' },
    { ...base, leg: 'from-church' },
  ]);
  expect(records.map((r) => [r.id, r.metadata.order, r.metadata.leg, r.metadata.status])).toEqual([
    ['a1|to-church', '1', 'to-church', 'pending'],
    ['a2|to-church', '2', 'to-church', 'done'],
    ['a1|from-church', '1', 'from-church', 'pending'],
  ]);
  expect(records[0]).toEqual({
    id: stopId('a1', 'to-church'),
    title: 'Jane Example',
    subtitle: '100 Example Street, Fredericton, NB',
    synonyms: ['Jane'],
    metadata: {
      assignmentId: 'a1',
      leg: 'to-church',
      status: 'pending',
      order: '1',
      address: '100 Example Street, Fredericton, NB',
      windowSpoken: 'between 9:30 and 9:45 AM',
      date: '2026-11-29',
      dateSpoken: 'Sunday, November 29',
      statusUpdatedAt: String(Date.parse('2026-11-28T15:00:00.000Z') / 1000),
    },
    hideInSpotlight: true,
  });
});

test('blank names and addresses still make valid records', () => {
  const [record] = buildStopRecords([{ ...base, passengerName: '  ', pickupAddress: null, statusUpdatedAt: 'bad' }]);
  expect(record?.title).toBe('Rider');
  expect(record?.subtitle).toBeUndefined();
  expect(record?.synonyms).toBeUndefined();
  expect(record?.metadata.address).toBe('');
  expect(record?.metadata.statusUpdatedAt).toBe('0');
});
