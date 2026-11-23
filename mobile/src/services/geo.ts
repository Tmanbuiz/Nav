import * as Location from 'expo-location';

import type { Point } from '@/core/route';

/** Address text to coordinates with the phone's own geocoder (Apple's on iPhone). Null if not found. */
export async function geocode(address: string | null | undefined): Promise<Point | null> {
  const text = address?.trim();
  if (!text) return null;
  try {
    const results = await Location.geocodeAsync(text);
    const first = results[0];
    return first ? { lat: first.latitude, lng: first.longitude } : null;
  } catch {
    return null;
  }
}

export type SpotResult = { ok: true; point: Point; accuracy: number | null } | { ok: false; reason: string };

/** The phone's current location, for "save this spot" while standing at a rider's door. */
export async function currentSpot(): Promise<SpotResult> {
  try {
    const permission = await Location.requestForegroundPermissionsAsync();
    if (permission.status !== 'granted') {
      return { ok: false, reason: 'Location permission is off. Turn it on for ChurchRide in Settings.' };
    }
    const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
    return {
      ok: true,
      point: { lat: position.coords.latitude, lng: position.coords.longitude },
      accuracy: position.coords.accuracy ?? null,
    };
  } catch {
    return { ok: false, reason: 'Couldn’t get your location. Try again outside or near a window.' };
  }
}
