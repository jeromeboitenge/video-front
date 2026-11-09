import { describe, expect, it } from 'vitest';
import { parseSubRip, parseWebVtt, serializeWebVtt } from './subtitles';

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

describe('WebVTT subtitle interchange', () => {
  it('parses cue identifiers, metadata, cue settings, entities, and multiline text', () => {
    expect(parseWebVtt('WEBVTT - English\nKind: captions\nLanguage: en\n\nNOTE generated captions\nignored\n\ncue-1\n00:01.250 --> 00:03.000 align:start position:10%\n<v Ada>Hello &amp; welcome</v>\n<i>to Frameforge</i>')).toEqual([
      { kind: 'caption', text: 'Hello & welcome\nto Frameforge', start: 1.25, duration: 1.75, position: 'bottom', fontSize: 42, color: '#ffffff' },
    ]);
  });

  it('parses long timestamps and rejects missing headers and malformed cues', () => {
    expect(parseWebVtt('WEBVTT\n\n01:02:03.000 --> 01:02:04.000\nLong form')).toMatchObject([
      { text: 'Long form', start: 3723, duration: 1 },
    ]);
    expect(() => parseWebVtt('00:00.000 --> 00:01.000\nNo header')).toThrow('WEBVTT header');
    expect(() => parseWebVtt('WEBVTT\n\n00:02.000 --> 00:01.000\nBackwards')).toThrow('WebVTT cue 1');
    expect(() => parseWebVtt('WEBVTT\n\n')).toThrow('contains no captions');
  });

  it('exports captions in time order and excludes titles', () => {
    expect(serializeWebVtt([
      { id: 'later', kind: 'caption', text: 'Later', start: 3.125, duration: 1, position: 'bottom', fontSize: 42, color: '#ffffff' },
      { id: 'title', kind: 'title', text: 'Title', start: 0, duration: 2, position: 'center', fontSize: 64, color: '#ffffff' },
      { id: 'first', kind: 'caption', text: 'Safe <text> & symbols', start: 1, duration: 0.5, position: 'bottom', fontSize: 42, color: '#ffffff' },
    ])).toBe('WEBVTT\n\n00:00:01.000 --> 00:00:01.500\nSafe &lt;text&gt; &amp; symbols\n\n00:00:03.125 --> 00:00:04.125\nLater\n');
    expect(() => serializeWebVtt([])).toThrow('There are no captions');
  });
});
