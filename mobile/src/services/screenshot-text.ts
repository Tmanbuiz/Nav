/**
 * Reads the text in a screenshot on the phone, with Apple's Vision framework
 * (screenshot-text/ScreenshotText.swift). Nothing is uploaded.
 * Missing in Expo Go: it needs your own build of the app.
 */
import { requireOptionalNativeModule } from 'expo';

interface ScreenshotTextModule {
  readLinesAsync(uri: string): Promise<string[]>;
}

const native = requireOptionalNativeModule<ScreenshotTextModule>('ScreenshotText');

export function canReadScreenshots(): boolean {
  return native !== null;
}

/** The picture's text, line by line, top to bottom. Empty when the picture has no text. */
export async function readScreenshotText(uri: string): Promise<string> {
  if (!native) throw new Error('Reading screenshots needs your own build of ChurchRide, not Expo Go.');
  const lines = await native.readLinesAsync(uri);
  return lines.join('\n').trim();
}
