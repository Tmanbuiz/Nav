/**
 * Links that hand a route to Apple Maps or Google Maps, plus call and text links.
 *
 * Apple Maps: unified Maps URLs (iOS 18.4+): /directions with source, destination,
 * a repeatable waypoint parameter and mode. Apple Maps does not reorder stops.
 * Google Maps: Maps URLs (api=1) with waypoints separated by "|". Links opened in the
 * Google Maps app take up to 9 waypoints (3 in a mobile browser).
 */

export type MapsApp = 'apple' | 'google';

export interface Place {
  address: string | null;
  lat?: number | null;
  lng?: number | null;
}

export const GOOGLE_MAX_WAYPOINTS = 9;

/** Coordinates when the exact spot is known, otherwise the address text. */
export function placeParam(p: Place | null | undefined): string | null {
  if (!p) return null;
  if (typeof p.lat === 'number' && typeof p.lng === 'number') return `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;
  const a = p.address?.trim();
  return a ? a : null;
}

export interface DirectionsInput {
  /** Leave out to start from wherever the phone is. */
  origin?: Place | null;
  stops: Place[];
  destination: Place;
}

export interface DirectionsLink {
  url: string;
  /** Stops left out: no address, or past Google's waypoint limit. */
  skipped: number;
}

export function directionsUrl(app: MapsApp, input: DirectionsInput): DirectionsLink | null {
  const destination = placeParam(input.destination);
  if (!destination) return null;
  const origin = placeParam(input.origin);
  const located = input.stops.map(placeParam).filter((s): s is string => s !== null);
  let skipped = input.stops.length - located.length;

  if (app === 'apple') {
    const parts: string[] = [];
    if (origin) parts.push(`source=${enc(origin)}`);
    parts.push(`destination=${enc(destination)}`);
    for (const stop of located) parts.push(`waypoint=${enc(stop)}`);
    parts.push('mode=driving');
    return { url: `https://maps.apple.com/directions?${parts.join('&')}`, skipped };
  }

  const kept = located.slice(0, GOOGLE_MAX_WAYPOINTS);
  skipped += located.length - kept.length;
  const parts = ['api=1'];
  if (origin) parts.push(`origin=${enc(origin)}`);
  parts.push(`destination=${enc(destination)}`);
  if (kept.length) parts.push(`waypoints=${kept.map(enc).join('%7C')}`);
  parts.push('travelmode=driving');
  return { url: `https://www.google.com/maps/dir/?${parts.join('&')}`, skipped };
}

/** Directions from the phone's location to one place. */
export function singleStopUrl(app: MapsApp, place: Place): string | null {
  return directionsUrl(app, { stops: [], destination: place })?.url ?? null;
}

export function telUrl(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, '')}`;
}

/** iOS separates the body with "&", Android with "?". */
export function smsUrl(phone: string, body: string, platform: string): string {
  const number = phone.replace(/[^\d+]/g, '');
  const sep = platform === 'ios' ? '&' : '?';
  return `sms:${number}${sep}body=${enc(body)}`;
}

/** Replaces {first}, {name}, {driver} and similar placeholders. Unknown ones are left as typed. */
export function fillTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => vars[key] ?? whole);
}

export function firstName(name: string | null | undefined): string {
  return (name ?? '').trim().split(/\s+/)[0] ?? '';
}

/** Percent-encodes, but keeps commas readable as in Apple's own examples ("45.96,-66.64"). */
function enc(s: string): string {
  return encodeURIComponent(s).replace(/%2C/g, ',');
}
