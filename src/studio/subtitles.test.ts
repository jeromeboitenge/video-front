import { describe, expect, it } from 'vitest';
import { parseSubRip } from './subtitles';

describe('SubRip subtitle import', () => {
  it('parses timed captions into positioned overlays', () => {
    expect(parseSubRip('\uFEFF1\r\n00:00:01,250 --> 00:00:03,000\r\nHello\r\nworld\r\n\r\n2\r\n00:00:04.000 --> 00:00:05.500\r\nNext line')).toEqual([
      { kind: 'caption', text: 'Hello\nworld', start: 1.25, duration: 1.75, position: 'bottom', fontSize: 42, color: '#ffffff' },
      { kind: 'caption', text: 'Next line', start: 4, duration: 1.5, position: 'bottom', fontSize: 42, color: '#ffffff' },
    ]);
  });

  it('rejects malformed subtitle blocks instead of silently dropping captions', () => {
    expect(() => parseSubRip('1\n00:00:02,000 --> 00:00:01,000\nBackwards')).toThrow('Subtitle block 1');
    expect(() => parseSubRip('')).toThrow('contains no captions');
  });
});
