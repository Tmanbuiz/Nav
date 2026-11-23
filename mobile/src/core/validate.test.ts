import { assignmentFromAi, transportTypeForLegs, validateRide } from './validate';

const good = {
  passengerName: ' Jane Example ',
  phone: '(506) 555-0101',
  persons: '1',
  serviceDate: '2026-11-29',
  windowStart: '09:30',
  windowEnd: '09:45',
  legs: ['to-church', 'from-church'] as ('to-church' | 'from-church')[],
  pickupAddress: '100 Example Street, Fredericton, NB',
};

describe('validateRide', () => {
  test('a complete ride has no issues and normalized fields', () => {
    const { fields, issues } = validateRide(good, { today: '2026-11-22', province: 'NB' });
    expect(issues).toEqual([]);
    expect(fields).toEqual(
      expect.objectContaining({
        passengerName: 'Jane Example',
        phone: '+15065550101',
        persons: 1,
        transportType: 'two-way',
        addressKind: 'street',
        dedupeKey: '2026-11-29|+15065550101',
      }),
    );
  });

  test('missing pieces are errors; a missing phone is only a flag', () => {
    const { issues } = validateRide({
      ...good,
      passengerName: '',
      phone: '',
      persons: '0',
      serviceDate: '29/11/2026',
      windowStart: null,
      legs: [],
      pickupAddress: ' ',
    });
    const byCode = Object.fromEntries(issues.map((i) => [i.code, i.severity]));
    expect(byCode).toEqual({
      'missing-name': 'error',
      'missing-phone': 'review',
      'missing-persons': 'error',
      'bad-date': 'error',
      'missing-time': 'error',
      'missing-type': 'error',
      'missing-address': 'error',
    });
  });

  test('named place is flagged unless the spot is saved; other provinces are flagged', () => {
    const place = { ...good, pickupAddress: 'Maple Hall Residence, College Drive, Fredericton, NB' };
    expect(validateRide(place).issues.map((i) => i.code)).toEqual(['place-address']);
    expect(validateRide(place, { spotSaved: true }).issues).toEqual([]);
    const away = { ...good, pickupAddress: '766 Example Street, Vancouver, BC' };
    expect(validateRide(away, { province: 'NB' }).issues.map((i) => i.code)).toEqual(['other-province']);
  });

  test('window end defaults to start and must not be earlier', () => {
    expect(validateRide({ ...good, windowEnd: null }).fields.windowEnd).toBe('09:30');
    expect(validateRide({ ...good, windowEnd: '09:00' }).issues.map((i) => i.code)).toEqual(['window-order']);
  });

  test('transportTypeForLegs', () => {
    expect(transportTypeForLegs(['to-church'])).toBe('pick-up');
    expect(transportTypeForLegs(['from-church'])).toBe('return only');
    expect(transportTypeForLegs([])).toBeNull();
  });
});

describe('assignmentFromAi', () => {
  test('always needs review and keeps the raw text', () => {
    const a = assignmentFromAi(
      {
        passengerName: 'Jane Example',
        persons: 1,
        phone: '+15065550101',
        serviceDate: '2026-11-29',
        windowStart: '09:30',
        windowEnd: '09:45',
        transportType: 'two-way',
        pickupAddress: '100 Example Street, Fredericton, NB',
      },
      'original text',
    );
    expect(a.kind).toBe('assignment');
    expect(a.legs).toEqual(['to-church', 'from-church']);
    expect(a.pickupWindow).toEqual({ start: '09:30', end: '09:45' });
    expect(a.issues.map((i) => i.code)).toEqual(['ai-extracted']);
    expect(a.raw).toBe('original text');
  });

  test('junk values become errors, never guesses', () => {
    const a = assignmentFromAi({ passengerName: 42, persons: 'many', transportType: 'boat' }, 'x');
    const codes = a.issues.map((i) => i.code);
    expect(codes).toEqual(
      expect.arrayContaining(['ai-extracted', 'missing-persons', 'bad-date', 'missing-time', 'missing-type', 'missing-address']),
    );
    expect(a.legs).toEqual([]);
  });
});
