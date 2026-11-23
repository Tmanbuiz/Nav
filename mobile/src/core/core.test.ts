// Made-up riders and coordinates only.
import { planImport, sameAddress, type ExistingAssignment } from './importer';
import { directionsUrl, fillTemplate, firstName, singleStopUrl, smsUrl, telUrl } from './maps';
import { parseAssignmentMessages, parseAssignmentSms } from './parser/assignmentParser';
import { distanceKm, estimateDriveMinutes, planSchedule, suggestOrder } from './route';
import {
  addDays,
  formatClock,
  formatDate,
  formatMinutes,
  formatWindow,
  isISODate,
  nextSunday,
  parseClockInput,
  toMinutes,
  todayISO,
} from './time';

const FOOTER = 'View Location on Google Maps Provide updates through the Church App . Kind regards, Church Administration Team';

function sms(name: string, phone: string, time = '9:30 AM - 9:45 AM', address = '100 Example Street, Fredericton, NB, Canada', type = 'two-way') {
  return (
    `Transportation Assignment Dear Sample Driver, You have been assigned to provide transportation for the following member: ` +
    `Name: ${name} Number of Persons: 1 Phone Number: ${phone} Service Date: 2026-11-22 Pickup Time: ${time} ` +
    `Transport Type: ${type} Pickup Address: ${address} ${FOOTER}`
  );
}

describe('time', () => {
  test('dates', () => {
    expect(todayISO(new Date(2026, 10, 22, 9, 30))).toBe('2026-11-22');
    expect(formatDate('2026-11-22')).toBe('Sun, Nov 22');
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
    expect(isISODate('2026-11-22')).toBe(true);
    expect(isISODate('2026-02-30')).toBe(false);
    expect(nextSunday('2026-11-22')).toBe('2026-11-22');
    expect(nextSunday('2026-11-23')).toBe('2026-11-29');
  });

  test('clock times', () => {
    expect(formatClock('09:30')).toBe('9:30 AM');
    expect(formatClock('12:05')).toBe('12:05 PM');
    expect(formatClock('00:15')).toBe('12:15 AM');
    expect(formatMinutes(toMinutes('13:45'))).toBe('1:45 PM');
    expect(formatWindow('09:30', '09:45')).toBe('9:30 - 9:45 AM');
    expect(formatWindow('11:30', '12:15')).toBe('11:30 AM - 12:15 PM');
    expect(formatWindow('09:30', '09:30')).toBe('9:30 AM');
    expect(parseClockInput('9:30')).toBe('09:30');
    expect(parseClockInput('9:30 pm')).toBe('21:30');
    expect(parseClockInput('12:30 PM')).toBe('12:30');
    expect(parseClockInput('25:00')).toBeNull();
  });
});

describe('maps links', () => {
  const church = { address: 'Example Church, 1 Church St, Fredericton, NB' };
  const stops = [
    { address: '100 Example Street, Fredericton, NB' },
    { address: 'Maple Hall, College Dr', lat: 45.9455, lng: -66.6413 },
  ];

  test('Apple Maps: repeated waypoints in order, ending at church', () => {
    const link = directionsUrl('apple', { stops, destination: church });
    expect(link?.url).toBe(
      'https://maps.apple.com/directions?destination=Example%20Church,%201%20Church%20St,%20Fredericton,%20NB' +
        '&waypoint=100%20Example%20Street,%20Fredericton,%20NB&waypoint=45.945500,-66.641300&mode=driving',
    );
    expect(link?.skipped).toBe(0);
  });

  test('Google Maps: pipe-separated waypoints, capped at 9', () => {
    const many = Array.from({ length: 11 }, (_, i) => ({ address: `${i + 1} Example St` }));
    const link = directionsUrl('google', { origin: church, stops: many, destination: church });
    expect(link?.url.startsWith('https://www.google.com/maps/dir/?api=1&origin=')).toBe(true);
    expect(link?.url).toContain('waypoints=1%20Example%20St%7C2%20Example%20St');
    expect(link?.url.endsWith('&travelmode=driving')).toBe(true);
    expect(link?.skipped).toBe(2);
  });

  test('stops without an address are skipped and counted', () => {
    const link = directionsUrl('apple', { stops: [{ address: null }], destination: church });
    expect(link?.skipped).toBe(1);
    expect(directionsUrl('apple', { stops, destination: { address: '' } })).toBeNull();
  });

  test('single stop, call and text links', () => {
    expect(singleStopUrl('google', { address: '1 A St' })).toBe(
      'https://www.google.com/maps/dir/?api=1&destination=1%20A%20St&travelmode=driving',
    );
    expect(telUrl('+1 (506) 555-0101')).toBe('tel:+15065550101');
    expect(smsUrl('+15065550101', "I'm on my way", 'ios')).toBe("sms:+15065550101&body=I'm%20on%20my%20way");
    expect(smsUrl('+15065550101', 'Hi', 'android')).toBe('sms:+15065550101?body=Hi');
    expect(fillTemplate('Hi {first}, it is {driver}. {unknown}', { first: 'Jane', driver: 'Sam' })).toBe(
      'Hi Jane, it is Sam. {unknown}',
    );
    expect(firstName('  Jane Example ')).toBe('Jane');
  });
});

describe('route', () => {
  test('distance and drive estimate', () => {
    expect(distanceKm({ lat: 0, lng: 0 }, { lat: 0, lng: 1 })).toBeCloseTo(111.19, 1);
    expect(estimateDriveMinutes(0)).toBe(1);
    expect(estimateDriveMinutes(1.11)).toBe(3);
  });

  test('suggestOrder finds the shortest path and keeps unlocated stops last', () => {
    const stops = [{ lat: 0, lng: 0.03 }, { lat: 0, lng: 0.01 }, null, { lat: 0, lng: 0.02 }];
    expect(suggestOrder(stops, { start: { lat: 0, lng: 0 }, end: { lat: 0, lng: 0.04 } })).toEqual([1, 3, 0, 2]);
  });

  test('suggestOrder falls back to nearest neighbour past 8 stops', () => {
    const stops = Array.from({ length: 10 }, (_, i) => ({ lat: 0, lng: (10 - i) * 0.01 }));
    expect(suggestOrder(stops, { start: { lat: 0, lng: 0 } })).toEqual([9, 8, 7, 6, 5, 4, 3, 2, 1, 0]);
  });

  test('planSchedule: leave-by, arrivals, late flags', () => {
    const at = (lng: number) => ({ lat: 0, lng });
    const stops = [
      { point: at(0.01), windowStart: 570, windowEnd: 585 },
      { point: at(0.02), windowStart: 570, windowEnd: 585 },
      { point: at(0.5), windowStart: 570, windowEnd: 585 },
    ];
    const s = planSchedule(stops, { start: at(0.03), end: at(0.04) });
    expect(s.leaveBy).toBe(570 - estimateDriveMinutes(distanceKm(at(0.03), at(0.01))));
    expect(s.etas[0]).toBe(570);
    expect(s.etas[1]).toBe(570 + 2 + estimateDriveMinutes(distanceKm(at(0.01), at(0.02))));
    expect(s.late).toEqual([false, false, true]);
    expect(s.arriveEnd).not.toBeNull();
  });

  test('planSchedule stops estimating once a location is unknown', () => {
    const s = planSchedule([
      { point: null, windowStart: 570, windowEnd: 585 },
      { point: { lat: 0, lng: 0 }, windowStart: 570, windowEnd: 585 },
    ]);
    expect(s.etas).toEqual([570, null]);
    expect(s.leaveBy).toBeNull();
  });
});

describe('planImport', () => {
  const existing: ExistingAssignment[] = [
    {
      id: 'a1',
      dedupeKey: '2026-11-22|+15065550101',
      passengerName: 'Jane Example',
      phone: '+15065550101',
      persons: 1,
      serviceDate: '2026-11-22',
      windowStart: '09:30',
      windowEnd: '09:45',
      transportType: 'two-way',
      pickupAddress: '100 Example Street, Fredericton, NB, Canada',
      status: 'confirmed',
    },
  ];

  test('creates, skips duplicates, lets the newest copy in a paste win, ignores other texts', () => {
    const results = parseAssignmentMessages(
      [
        sms('Jane Example', '+15065550101'),
        sms('John Sample', '+15065550102'),
        sms('John Sample', '+15065550102'),
      ].join(' '),
    );
    results.push(parseAssignmentSms(sms('Jane Example', '+15065550101', '10:00 AM - 10:15 AM')));
    results.push(parseAssignmentSms('Service starts at 10 this Sunday.'));

    const plan = planImport(results, existing, []);
    expect(plan.actions.map((a) => a.type)).toEqual(['duplicate', 'duplicate', 'create', 'changed', 'ignored']);
    expect(plan.summary).toEqual({ created: 1, changed: 1, duplicates: 2, notices: 0, ignored: 1 });
  });

  test('an unchanged resend is a duplicate of the saved ride', () => {
    const plan = planImport([parseAssignmentSms(sms('Jane Example', '+15065550101'))], existing, []);
    expect(plan.actions[0]).toEqual(expect.objectContaining({ type: 'duplicate', existingId: 'a1' }));
  });

  test('a changed pickup time is flagged for review', () => {
    const plan = planImport([parseAssignmentSms(sms('Jane Example', '+15065550101', '10:00 AM - 10:15 AM'))], existing, []);
    const action = plan.actions[0];
    expect(action?.type).toBe('changed');
    if (action?.type !== 'changed') return;
    expect(action.existingId).toBe('a1');
    expect(action.changes).toEqual(['pickup time']);
    expect(action.issues.map((i) => i.code)).toContain('changed');
  });

  test('a cancellation becomes a notice linked to the ride', () => {
    const cancel = parseAssignmentSms(
      'Transportation Assignment Cancelled Dear Sample Driver, the following assignment was cancelled: ' +
        'Name: Jane Example Phone Number: +15065550101 Service Date: 2026-11-22',
    );
    const plan = planImport([cancel], existing, []);
    expect(plan.actions[0]).toEqual(expect.objectContaining({ type: 'notice', hint: 'cancellation', existingId: 'a1' }));
  });

  test('a saved pickup spot clears the named-place flag for that regular', () => {
    const address = 'Maple Hall Residence, College Drive, Fredericton, New Brunswick, Canada';
    const result = parseAssignmentSms(sms('Ann Sample', '+15065550103', undefined, address, 'pick-up'));
    const withSpot = planImport([result], [], [{ id: 'r1', phone: '+15065550103', pickupAddress: address, spotSaved: true }]);
    const withoutSpot = planImport([result], [], []);
    const created = withSpot.actions[0];
    expect(created?.type === 'create' && created.issues).toEqual([]);
    expect(created?.type === 'create' && created.regularId).toBe('r1');
    const plain = withoutSpot.actions[0];
    expect(plain?.type === 'create' && plain.issues.map((i) => i.code)).toEqual(['place-address']);
  });

  test('sameAddress ignores case, punctuation, street words and province spelling', () => {
    expect(sameAddress('100 Example Street, Fredericton, New Brunswick, Canada', '100 example st fredericton nb')).toBe(true);
    expect(sameAddress('100 Example Street', '102 Example Street')).toBe(false);
  });
});
