import { isShareLink } from '@/core/share';

/**
 * After you pick ChurchRide in the share sheet, the share extension opens the app with
 * churchride://expo-sharing. Send that to the import screen, which reads what was shared.
 * Every other link (such as churchride://import?text=…) goes where it says.
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  return isShareLink(path) ? '/import?shared=1' : path;
}
