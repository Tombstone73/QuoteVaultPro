import { applyThumbnailContract } from '../lib/thumbnailContract';
import { describe, test, expect } from '@jest/globals';

describe('thumbnail contract', () => {
  test('prefers PDF page[0].thumbUrl and populates thumbnailUrl', () => {
    const out = applyThumbnailContract({
      pages: [{ thumbUrl: '/objects/thumbs/pdf-page-1.png' }],
      thumbUrl: null,
      previewThumbnailUrl: null,
      thumbnailUrl: null,
    });

    expect(out.thumbnailUrl).toBe('/objects/thumbs/pdf-page-1.png');
    expect(out.previewThumbnailUrl).toBe('/objects/thumbs/pdf-page-1.png');
  });

  test('falls back to previewThumbnailUrl when provided', () => {
    const out = applyThumbnailContract({
      previewThumbnailUrl: '/objects/thumbs/already.png',
      thumbnailUrl: null,
    });

    expect(out.thumbnailUrl).toBe('/objects/thumbs/already.png');
    expect(out.previewThumbnailUrl).toBe('/objects/thumbs/already.png');
  });

  test('falls back to thumbUrl when provided', () => {
    const out = applyThumbnailContract({
      thumbUrl: '/objects/thumbs/legacy.png',
      thumbnailUrl: null,
      previewThumbnailUrl: null,
    });

    expect(out.thumbnailUrl).toBe('/objects/thumbs/legacy.png');
    expect(out.previewThumbnailUrl).toBe('/objects/thumbs/legacy.png');
  });

  test('leaves thumbnailUrl null when no thumbnail exists', () => {
    const out = applyThumbnailContract({
      thumbnailUrl: null,
      previewThumbnailUrl: null,
      thumbUrl: null,
      pages: null,
    });

    expect(out.thumbnailUrl).toBeNull();
    expect(out.previewThumbnailUrl).toBeNull();
  });
});
