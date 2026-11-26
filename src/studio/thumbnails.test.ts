import { describe, expect, it } from 'vitest';
import { filmstripFor } from './thumbnails';

const thumbs = { duration: 10, frames: Array.from({ length: 10 }, (_, i) => ({ time: i + 0.5, src: `f${i}` })) };

describe('timeline filmstrip', () => {
  it('maps tiles across the trimmed source range', () => {
    const clip = { id: 'c', assetId: 'a', trackId: 't', start: 0, duration: 4, sourceOffset: 2 };
    expect(filmstripFor(clip, thumbs, 4)).toEqual(['f2', 'f3', 'f4', 'f5']);
  });
  it('accounts for clip speed', () => {
    const clip = { id: 'c', assetId: 'a', trackId: 't', start: 0, duration: 2, sourceOffset: 0.2, speed: 4 };
    expect(filmstripFor(clip, thumbs, 2)).toEqual(['f2', 'f6']);
  });
  it('returns nothing without decoded frames', () => {
    expect(filmstripFor({ id: 'c', assetId: 'a', trackId: 't', start: 0, duration: 1, sourceOffset: 0 }, undefined, 3)).toEqual([]);
  });
});
