/**
 * The day's run as Siri sees it. The app publishes these records to the native "stop" catalog
 * (expo-app-intents); the Swift intents in app-intents/ read them while the app is closed.
 * Keep the metadata keys in step with app-intents/ChurchRideStops.swift.
 */
import type { Leg } from './parser/assignmentParser';
import { formatDateLong, formatSpokenWindow } from './time';

export const STOP_CATALOG_KIND = 'stop';

export interface StopForSiri {
  assignmentId: string;
  leg: Leg;
  status: 'pending' | 'done' | 'no-show';
  passengerName: string | null;
  pickupAddress: string | null;
  windowStart: string | null;
  windowEnd: string | null;
  serviceDate: string;
  /** When the trip's status last changed in the app (ISO). Newer than a Siri mark wins. */
  statusUpdatedAt: string;
}

/** Same shape as expo-app-intents' AppIntentEntity, kept here so core stays free of Expo. */
export interface StopRecord {
  id: string;
  title: string;
  subtitle?: string;
  synonyms?: string[];
  metadata: Record<string, string>;
  hideInSpotlight: boolean;
}

export function stopId(assignmentId: string, leg: Leg): string {
  return `${assignmentId}|${leg}`;
}

/**
 * Builds catalog records in driving order. Pass each leg's stops in the order shown on the
 * Today screen; `order` counts within each leg. Rider names never go to Spotlight.
 */
export function buildStopRecords(stops: StopForSiri[]): StopRecord[] {
  const counters: Record<Leg, number> = { 'to-church': 0, 'from-church': 0 };
  return stops.map((s) => {
    counters[s.leg] += 1;
    const name = s.passengerName?.trim() || 'Rider';
    const first = name.split(/\s+/)[0] ?? name;
    const address = s.pickupAddress?.trim() ?? '';
    const updated = Date.parse(s.statusUpdatedAt);
    return {
      id: stopId(s.assignmentId, s.leg),
      title: name,
      ...(address ? { subtitle: address } : {}),
      ...(first !== name ? { synonyms: [first] } : {}),
      metadata: {
        assignmentId: s.assignmentId,
        leg: s.leg,
        status: s.status,
        order: String(counters[s.leg]),
        address,
        windowSpoken: formatSpokenWindow(s.windowStart, s.windowEnd),
        date: s.serviceDate,
        dateSpoken: formatDateLong(s.serviceDate),
        statusUpdatedAt: Number.isFinite(updated) ? String(Math.floor(updated / 1000)) : '0',
      },
      hideInSpotlight: true,
    };
  });
}
