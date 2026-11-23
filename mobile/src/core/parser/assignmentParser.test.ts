// Tests use made-up passengers. The wording copies the church's real template.
import {
  findProvince,
  legsForType,
  makeDedupeKey,
  normalizePhone,
  parseAssignmentMessages,
  parseAssignmentSms,
  type Assignment,
  type ParseResult,
} from './assignmentParser';

const FOOTER =
  'View Location on Google Maps Provide updates through the Church App . Thank you for serving in the ' +
  'Transportation Ministry. Kind regards, Church Administration Team Example Church';

interface Sample {
  name: string;
  persons: string;
  phone: string;
  date: string;
  time: string;
  type: string;
  address: string;
}

const BASE: Sample = {
  name: 'Jane Example',
  persons: '1',
  phone: '+15065550101',
  date: '2026-11-22',
  time: '9:30 AM - 9:45 AM',
  type: 'pick-up',
  address: 'Maple Hall Residence, College Drive, Fredericton, New Brunswick, Canada',
};

function sms(overrides: Partial<Sample> = {}, driver = 'Sample Driver'): string {
  const f = { ...BASE, ...overrides };
  return (
    `Transportation Assignment Dear ${driver}, You have been assigned to provide transportation for the ` +
    `following member: Name: ${f.name} Number of Persons: ${f.persons} Phone Number: ${f.phone} ` +
    `Service Date: ${f.date} Pickup Time: ${f.time} Transport Type: ${f.type} ` +
    `Pickup Address: ${f.address} ${FOOTER}`
  );
}

function asAssignment(r: ParseResult | undefined): Assignment {
  expect(r?.kind).toBe('assignment');
  return r as Assignment;
}

const codes = (a: Assignment) => a.issues.map((i) => i.code);

const OPTS = { expectedDriverName: 'Sample Driver', today: '2026-11-22', expectedProvince: 'NB' };

describe('parseAssignmentSms', () => {
  test('reads the standard template (named place, pick-up)', () => {
    const a = asAssignment(parseAssignmentSms(sms(), OPTS));
    expect(a.driverName).toBe('Sample Driver');
    expect(a.passengerName).toBe('Jane Example');
    expect(a.persons).toBe(1);
    expect(a.phone).toBe('+15065550101');
    expect(a.serviceDate).toBe('2026-11-22');
    expect(a.pickupWindow).toEqual({ start: '09:30', end: '09:45' });
    expect(a.transportType).toBe('pick-up');
    expect(a.legs).toEqual(['to-church']);
    expect(a.pickupAddress).toBe('Maple Hall Residence, College Drive, Fredericton, New Brunswick, Canada');
    expect(a.addressKind).toBe('place');
    expect(a.issues.map((i) => [i.code, i.severity])).toEqual([['place-address', 'review']]);
    expect(a.dedupeKey).toBe('2026-11-22|+15065550101');
  });

  test('reads two-way, street address, line breaks, en dash and formatted phone', () => {
    const text =
      'Transportation Assignment\nDear Sample Driver,\nYou have been assigned to provide transportation for the following member:\n' +
      'Name: John Sample\nNumber of Persons: 2\nPhone Number: (506) 555-0102\nService Date: 2026-11-22\n' +
      'Pickup Time: 9:30 AM – 9:45 AM\nTransport Type: Two-Way\n' +
      `Pickup Address: 100 Example Street, Fredericton, New Brunswick, Canada\n${FOOTER}`;
    const a = asAssignment(parseAssignmentSms(text, OPTS));
    expect(a.passengerName).toBe('John Sample');
    expect(a.persons).toBe(2);
    expect(a.phone).toBe('+15065550102');
    expect(a.pickupWindow).toEqual({ start: '09:30', end: '09:45' });
    expect(a.legs).toEqual(['to-church', 'from-church']);
    expect(a.pickupAddress).toBe('100 Example Street, Fredericton, New Brunswick, Canada');
    expect(a.addressKind).toBe('street');
    expect(a.issues).toEqual([]);
  });

  test('works when the fields come in a different order', () => {
    const text =
      'Transportation Assignment Dear Sample Driver, You have been assigned to provide transportation for the following member: ' +
      'Name: Jane Example Pickup Address: 100 Example Street, Fredericton Phone Number: +15065550101 ' +
      'Service Date: 2026-11-22 Transport Type: pick-up Pickup Time: 9:30 AM - 9:45 AM Number of Persons: 1 ' +
      FOOTER;
    const a = asAssignment(parseAssignmentSms(text, OPTS));
    expect(a.pickupAddress).toBe('100 Example Street, Fredericton');
    expect(a.persons).toBe(1);
    expect(a.pickupWindow).toEqual({ start: '09:30', end: '09:45' });
    expect(a.issues).toEqual([]);
  });

  test('handles AM/PM edge cases', () => {
    const win = (time: string) => asAssignment(parseAssignmentSms(sms({ time }), OPTS)).pickupWindow;
    expect(win('9:30 - 9:45 AM')).toEqual({ start: '09:30', end: '09:45' });
    expect(win('11:30 - 12:15 PM')).toEqual({ start: '11:30', end: '12:15' });
    expect(win('12:00 PM - 12:15 PM')).toEqual({ start: '12:00', end: '12:15' });
    expect(win('1:30 p.m.')).toEqual({ start: '13:30', end: '13:30' });
  });

  test('flags a missing phone number instead of inventing one', () => {
    const a = asAssignment(parseAssignmentSms(sms({ phone: '' }), OPTS));
    expect(a.phone).toBeNull();
    expect(a.issues).toContainEqual(expect.objectContaining({ code: 'missing-phone', severity: 'error' }));
    expect(a.dedupeKey).toBe('2026-11-22|jane example');
  });

  test('does not guess an unknown transport type', () => {
    const a = asAssignment(parseAssignmentSms(sms({ type: 'drop-off' }), OPTS));
    expect(a.transportType).toBe('drop-off');
    expect(a.legs).toEqual([]);
    expect(codes(a)).toContain('unknown-type');
  });

  test('flags a text addressed to another driver', () => {
    const a = asAssignment(parseAssignmentSms(sms({}, 'Someone Else'), OPTS));
    expect(codes(a)).toContain('other-driver');
  });

  test('flags past and impossible dates', () => {
    const past = asAssignment(parseAssignmentSms(sms(), { ...OPTS, today: '2026-11-23' }));
    expect(codes(past)).toContain('past-date');

    const bad = asAssignment(parseAssignmentSms(sms({ date: '2026-02-30' }), OPTS));
    expect(bad.serviceDate).toBeNull();
    expect(bad.issues).toContainEqual(expect.objectContaining({ code: 'bad-date', severity: 'error' }));
  });

  test('flags an address in another province, accepts NB with a postal code', () => {
    const away = asAssignment(
      parseAssignmentSms(sms({ type: 'two-way', address: '766 Example Street, Vancouver, BC, Canada' }), OPTS),
    );
    const flag = away.issues.find((i) => i.code === 'other-province');
    expect(flag?.severity).toBe('review');
    expect(flag?.message).toMatch(/BC, not NB/);

    const home = asAssignment(
      parseAssignmentSms(sms({ address: '10 Example Road, Fredericton, NB E3B 1A1, Canada' }), OPTS),
    );
    expect(home.issues).toEqual([]);
  });

  test('the same text twice gives the same key, so it is not saved twice', () => {
    const a = asAssignment(parseAssignmentSms(sms(), OPTS));
    const b = asAssignment(parseAssignmentSms(sms(), OPTS));
    expect(a.dedupeKey).toBe(b.dedupeKey);
  });

  test('treats a cancellation as a possible change, not a new assignment', () => {
    const text =
      'Transportation Assignment Cancelled Dear Sample Driver, The following assignment has been cancelled: ' +
      `Name: Jane Example Phone Number: +15065550101 Service Date: 2026-11-22 ${FOOTER}`;
    const r = parseAssignmentSms(text, OPTS);
    expect(r.kind).toBe('possible-change');
    if (r.kind !== 'possible-change') return;
    expect(r.hint).toBe('cancellation');
    expect(r.fields.dedupeKey).toBe('2026-11-22|+15065550101');
  });

  test('treats an updated assignment as a possible change', () => {
    const r = parseAssignmentSms(sms().replace('Transportation Assignment', 'Updated Transportation Assignment'), OPTS);
    expect(r.kind).toBe('possible-change');
    if (r.kind !== 'possible-change') return;
    expect(r.hint).toBe('update');
  });

  test('ignores other texts from the same number', () => {
    const r = parseAssignmentSms('Reminder: our Thanksgiving service starts at 10 AM this Sunday. See you there!', OPTS);
    expect(r.kind).toBe('not-an-assignment');
  });
});

describe('parseAssignmentMessages', () => {
  test('splits a paste of several texts into separate assignments', () => {
    const pasted = [
      sms(),
      sms({ name: 'John Sample', phone: '+15065550102', type: 'two-way', address: '100 Example Street, Fredericton, NB, Canada' }),
      sms({ name: 'Ann Sample', phone: '+15065550103', type: 'two-way', address: '766 Example Street, Vancouver, BC, Canada' }),
    ].join(' ');
    const results = parseAssignmentMessages(pasted, OPTS).map(asAssignment);
    expect(results.map((a) => [a.passengerName, a.legs.length, codes(a)])).toEqual([
      ['Jane Example', 1, ['place-address']],
      ['John Sample', 2, []],
      ['Ann Sample', 2, ['other-province']],
    ]);
  });

  test('a single text gives one result', () => {
    expect(parseAssignmentMessages(sms(), OPTS)).toHaveLength(1);
  });
});

describe('helpers', () => {
  test('findProvince reads codes, names and postal codes', () => {
    expect(findProvince('766 Example Street, Vancouver, BC, Canada')).toBe('BC');
    expect(findProvince('1 Main St, Fredericton, New Brunswick, Canada')).toBe('NB');
    expect(findProvince('1 Main St, Sackville NB E4L 1A1')).toBe('NB');
    expect(findProvince('1 Main St, Fredericton')).toBeNull();
  });

  test('normalizePhone and makeDedupeKey', () => {
    expect(normalizePhone('(506) 555-0101')).toBe('+15065550101');
    expect(normalizePhone('1-506-555-0101')).toBe('+15065550101');
    expect(normalizePhone('')).toBeNull();
    expect(makeDedupeKey('2026-11-22', null, ' Jane  Example ')).toBe('2026-11-22|jane example');
    expect(makeDedupeKey(null, '+15065550101', 'Jane')).toBeNull();
  });

  test('legsForType', () => {
    expect(legsForType('Two-Way')).toEqual(['to-church', 'from-church']);
    expect(legsForType('pick up')).toEqual(['to-church']);
    expect(legsForType('drop-off')).toBeNull();
  });
});
