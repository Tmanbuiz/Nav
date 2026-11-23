import { isShareLink, sameShare, sortSharedPayloads } from './share';

describe('share sheet', () => {
  test('texts and pictures are kept; links, videos and other files are skipped', () => {
    const sorted = sortSharedPayloads([
      { shareType: 'text', value: '  Transportation Assignment Dear Sample Driver, …  ', mimeType: 'text/plain' },
      { shareType: 'image', value: 'file:///shared/one.png', mimeType: 'image/png' },
      { shareType: 'file', value: 'file:///shared/two.heic', mimeType: 'image/heic' },
      { shareType: 'file', value: 'file:///shared/notes.pdf', mimeType: 'application/pdf' },
      { shareType: 'url', value: 'https://example.com', mimeType: 'text/html' },
      { shareType: 'video', value: 'file:///shared/clip.mov', mimeType: 'video/quicktime' },
      { shareType: 'text', value: '   ' },
    ]);
    expect(sorted).toEqual({
      texts: ['Transportation Assignment Dear Sample Driver, …'],
      images: ['file:///shared/one.png', 'file:///shared/two.heic'],
      skipped: 4,
    });
  });

  test('only the share extension’s link counts as a share', () => {
    expect(isShareLink('churchride://expo-sharing')).toBe(true);
    expect(isShareLink('churchride://expo-sharing/')).toBe(true);
    expect(isShareLink('churchride://import?text=expo-sharing')).toBe(false);
    expect(isShareLink('churchride://expo-sharing-extra')).toBe(false);
    expect(isShareLink('/import')).toBe(false);
  });

  test('sameShare compares item by item', () => {
    const a = [{ shareType: 'text', value: 'one' }];
    expect(sameShare(a, [{ shareType: 'text', value: 'one', mimeType: 'text/plain' }])).toBe(true);
    expect(sameShare(a, [{ shareType: 'text', value: 'two' }])).toBe(false);
    expect(sameShare(a, [])).toBe(false);
  });
});
