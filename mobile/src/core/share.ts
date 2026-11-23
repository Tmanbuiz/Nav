/**
 * What arrives from the iOS share sheet, sorted into what ChurchRide can import.
 * The native side (reading and clearing the share, reading pictures) is in services/share.ts.
 */

/** expo-sharing's SharePayload, restated so core stays free of Expo imports. */
export interface SharedPayload {
  /** The text itself, or a file URI for pictures and files. */
  value: string;
  shareType: string;
  mimeType?: string;
}

export interface SortedShare {
  /** Shared texts, in the order they came. */
  texts: string[];
  /** File URIs of shared pictures, such as screenshots of the texts. */
  images: string[];
  /** Items ChurchRide doesn't read: links, videos, other files, empty texts. */
  skipped: number;
}

export function sortSharedPayloads(payloads: SharedPayload[]): SortedShare {
  const sorted: SortedShare = { texts: [], images: [], skipped: 0 };
  for (const p of payloads) {
    const mime = (p.mimeType ?? '').toLowerCase();
    if (p.shareType === 'text' && p.value.trim()) {
      sorted.texts.push(p.value.trim());
    } else if ((p.shareType === 'image' || (p.shareType === 'file' && mime.startsWith('image/'))) && p.value) {
      sorted.images.push(p.value);
    } else {
      sorted.skipped += 1;
    }
  }
  return sorted;
}

/** True for the link the share extension opens ChurchRide with: churchride://expo-sharing */
export function isShareLink(url: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\/expo-sharing(?:[/?#]|$)/i.test(url.trim());
}

/** The same share, item for item. Lets the app clear only what it has imported. */
export function sameShare(a: SharedPayload[], b: SharedPayload[]): boolean {
  return (
    a.length === b.length &&
    a.every((p, i) => p.value === b[i]?.value && p.shareType === b[i]?.shareType)
  );
}
