/**
 * Checks for rides typed or corrected by hand, and for AI-read texts.
 * Uses the same issue codes as the SMS parser so the app treats them alike.
 */
import {
  findProvince,
  legsForType,
  makeDedupeKey,
  normalizePhone,
  PROVINCE_CODES,
  type Assignment,
  type Issue,
  type Leg,
} from './parser/assignmentParser';
import { isHHMM, isISODate } from './time';

export interface RideFields {
  passengerName: string | null;
  phone: string | null;
  persons: number | null;
  serviceDate: string | null;
  windowStart: string | null;
  windowEnd: string | null;
  transportType: string | null;
  legs: Leg[];
  pickupAddress: string | null;
  addressKind: 'street' | 'place' | null;
  dedupeKey: string | null;
}

export interface RideInput {
  passengerName: string | null | undefined;
  phone: string | null | undefined;
  persons: string | number | null | undefined;
  serviceDate: string | null | undefined;
  windowStart: string | null | undefined;
  windowEnd: string | null | undefined;
  legs: Leg[];
  pickupAddress: string | null | undefined;
}

export interface ValidateOptions {
  today?: string;
  province?: string;
  /** The rider's exact pickup spot is saved for this address. */
  spotSaved?: boolean;
}

export function transportTypeForLegs(legs: Leg[]): string | null {
  const to = legs.includes('to-church');
  const from = legs.includes('from-church');
  if (to && from) return 'two-way';
  if (to) return 'pick-up';
  if (from) return 'return only';
  return null;
}

export function validateRide(input: RideInput, opts: ValidateOptions = {}): { fields: RideFields; issues: Issue[] } {
  const issues: Issue[] = [];
  const err = (field: string, code: Issue['code'], message: string) =>
    issues.push({ field, code, message, severity: 'error' });
  const flag = (field: string, code: Issue['code'], message: string) =>
    issues.push({ field, code, message, severity: 'review' });

  const passengerName = clean(input.passengerName);
  if (!passengerName) err('passengerName', 'missing-name', 'Add the rider’s name');

  const phone = normalizePhone(clean(input.phone));
  if (!phone) flag('phone', 'missing-phone', 'No phone number: you can’t call or text this rider');
  else if (!/^\+1\d{10}$/.test(phone)) flag('phone', 'unusual-phone', 'Unusual phone number: check it');

  const personsNum = typeof input.persons === 'number' ? input.persons : Number(clean(input.persons) ?? NaN);
  const persons = Number.isInteger(personsNum) && personsNum >= 1 ? personsNum : null;
  if (persons === null) err('persons', 'missing-persons', 'Number of persons must be 1 or more');

  const dateText = clean(input.serviceDate);
  const serviceDate = isISODate(dateText) ? dateText : null;
  if (!serviceDate) err('serviceDate', 'bad-date', 'Date must look like 2026-11-29');
  else if (opts.today && serviceDate < opts.today) flag('serviceDate', 'past-date', 'This date has already passed');

  const windowStart = isHHMM(input.windowStart) ? input.windowStart : null;
  const windowEnd = isHHMM(input.windowEnd) ? input.windowEnd : windowStart;
  if (!windowStart) err('pickupWindow', 'missing-time', 'Add a pickup time');
  else if (windowEnd && windowEnd < windowStart) {
    err('pickupWindow', 'window-order', 'Pickup window ends before it starts');
  }

  const legs = (['to-church', 'from-church'] as const).filter((l) => input.legs.includes(l));
  if (!legs.length) err('transportType', 'missing-type', 'Choose to church, from church, or both');

  const pickupAddress = clean(input.pickupAddress);
  let addressKind: RideFields['addressKind'] = null;
  if (!pickupAddress) {
    err('pickupAddress', 'missing-address', 'Add the pickup address');
  } else {
    addressKind = /^\d+[A-Za-z]?\b/.test(pickupAddress) ? 'street' : 'place';
    if (addressKind === 'place' && !opts.spotSaved) {
      flag('pickupAddress', 'place-address', 'Named place, not a street address: save the exact pickup spot once');
    }
    if (opts.province) {
      const expected = PROVINCE_CODES[opts.province.trim().toLowerCase()] ?? opts.province.trim().toUpperCase();
      const found = findProvince(pickupAddress);
      if (found && found !== expected) {
        flag('pickupAddress', 'other-province', `Address is in ${found}, not ${expected}: check it before driving`);
      }
    }
  }

  return {
    fields: {
      passengerName,
      phone,
      persons,
      serviceDate,
      windowStart,
      windowEnd,
      transportType: transportTypeForLegs(legs),
      legs,
      pickupAddress,
      addressKind,
      dedupeKey: makeDedupeKey(serviceDate, phone, passengerName),
    },
    issues,
  };
}

/** Shape the Cloudflare Worker returns for each ride it reads. */
export interface AiRide {
  passengerName?: unknown;
  persons?: unknown;
  phone?: unknown;
  serviceDate?: unknown;
  windowStart?: unknown;
  windowEnd?: unknown;
  transportType?: unknown;
  pickupAddress?: unknown;
}

/** Turns an AI-read ride into an assignment that always needs review. */
export function assignmentFromAi(ai: AiRide, raw: string, opts: ValidateOptions = {}): Assignment {
  const text = (v: unknown) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : null);
  const type = text(ai.transportType);
  const { fields, issues } = validateRide(
    {
      passengerName: text(ai.passengerName),
      phone: text(ai.phone),
      persons: text(ai.persons),
      serviceDate: text(ai.serviceDate),
      windowStart: text(ai.windowStart),
      windowEnd: text(ai.windowEnd),
      legs: legsForType(type) ?? [],
      pickupAddress: text(ai.pickupAddress),
    },
    opts,
  );
  return {
    kind: 'assignment',
    driverName: null,
    passengerName: fields.passengerName,
    persons: fields.persons,
    phone: fields.phone,
    serviceDate: fields.serviceDate,
    pickupWindow:
      fields.windowStart && fields.windowEnd ? { start: fields.windowStart, end: fields.windowEnd } : null,
    transportType: fields.transportType ?? (type ? type.toLowerCase() : null),
    legs: fields.legs,
    pickupAddress: fields.pickupAddress,
    addressKind: fields.addressKind,
    dedupeKey: fields.dedupeKey,
    issues: [
      { field: 'message', severity: 'review', code: 'ai-extracted', message: 'Read by AI: check every field' },
      ...issues,
    ],
    raw,
  };
}

function clean(v: string | number | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s : null;
}
