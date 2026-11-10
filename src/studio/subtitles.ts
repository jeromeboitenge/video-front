import type { TextOverlay } from './model';

function parseTimestamp(value: string): number | undefined {
  const match = /^(\d{2}):(\d{2}):(\d{2})[,.](\d{3})$/.exec(value);
  if (!match) return undefined;
  const [, hours, minutePart, secondPart, milliseconds] = match;
  const minutes = Number(minutePart);
  const seconds = Number(secondPart);
  if (minutes > 59 || seconds > 59) return undefined;
  return Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds) + Number(milliseconds) / 1000;
}

function parseVttTimestamp(value: string): number | undefined {
  const match = /^(?:(\d{2,}):)?(\d{2}):(\d{2})\.(\d{3})$/.exec(value);
  if (!match) return undefined;
  const [, hoursPart, minutePart, secondPart, milliseconds] = match;
  const hours = hoursPart ? Number(hoursPart) : 0;
  const minutes = Number(minutePart);
  const seconds = Number(secondPart);
  if (seconds > 59 || (hoursPart && minutes > 59)) return undefined;
  return hours * 3600 + minutes * 60 + seconds + Number(milliseconds) / 1000;
}

function decodeVttText(value: string): string {
  return value
    .replace(/<[^>]*>/g, '')
    .replace(/&(?:amp|lt|gt|lrm|rlm|nbsp);|&#(?:\d+|x[\da-f]+);/gi, (entity) => {
      const named: Record<string, string> = {
        '&amp;': '&',
        '&lt;': '<',
        '&gt;': '>',
        '&lrm;': '\u200e',
        '&rlm;': '\u200f',
        '&nbsp;': '\u00a0',
      };
      if (named[entity.toLowerCase()]) return named[entity.toLowerCase()];
      const codePoint = entity.toLowerCase().startsWith('&#x')
        ? Number.parseInt(entity.slice(3, -1), 16)
        : Number.parseInt(entity.slice(2, -1), 10);
      return codePoint > 0 && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : entity;
    });
}

function makeCaption(text: string, start: number, end: number): Omit<TextOverlay, 'id'> {
  return {
    kind: 'caption',
    text,
    start,
    duration: end - start,
    position: 'bottom',
    fontSize: 42,
    color: '#ffffff',
  };
}

export function parseSubRip(source: string): Omit<TextOverlay, 'id'>[] {
  const contents = source.replace(/^\uFEFF/, '').trim();
  if (!contents) throw new Error('The subtitle file contains no captions.');
  const blocks = contents.split(/\r?\n\s*\r?\n/);
  const captions: Omit<TextOverlay, 'id'>[] = [];

  blocks.forEach((block, index) => {
    const lines = block.split(/\r?\n/).map((line) => line.trimEnd());
    const timingIndex = lines.findIndex((line) => line.includes('-->'));
    const timing = timingIndex >= 0 ? /^(\d{2}:\d{2}:\d{2}[,.]\d{3})\s+-->\s+(\d{2}:\d{2}:\d{2}[,.]\d{3})(?:\s+.*)?$/.exec(lines[timingIndex].trim()) : null;
    const start = timing ? parseTimestamp(timing[1]) : undefined;
    const end = timing ? parseTimestamp(timing[2]) : undefined;
    const text = timingIndex >= 0 ? lines.slice(timingIndex + 1).join('\n').trim() : '';

    if (start === undefined || end === undefined || end <= start || !text) {
      throw new Error(`Subtitle block ${index + 1} has an invalid time range or no text.`);
    }

    captions.push(makeCaption(text, start, end));
  });

  if (!captions.length) throw new Error('The subtitle file contains no captions.');
  return captions;
}

export function parseWebVtt(source: string): Omit<TextOverlay, 'id'>[] {
  const contents = source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const lines = contents.split('\n');
  if (!/^WEBVTT(?:[ \t].*)?$/.test(lines[0].trim())) {
    throw new Error('The subtitle file is missing the WEBVTT header.');
  }

  const blocks = contents.split(/\n[ \t]*\n/).slice(1);
  const captions: Omit<TextOverlay, 'id'>[] = [];
  let cueNumber = 0;

  for (const rawBlock of blocks) {
    const block = rawBlock.trim();
    if (!block) continue;
    if (/^(NOTE(?:[ \t]|$)|STYLE(?:[ \t]|$)|REGION(?:[ \t]|$))/.test(block)) continue;
    const blockLines = block.split('\n');
    const timingIndex = blockLines.findIndex((line) => line.includes('-->'));
    if (timingIndex < 0) throw new Error(`WebVTT cue ${cueNumber + 1} has no timing line.`);
    const timing = /^(\S+)\s+-->\s+(\S+)(?:[ \t]+.*)?$/.exec(blockLines[timingIndex].trim());
    const start = timing ? parseVttTimestamp(timing[1]) : undefined;
    const end = timing ? parseVttTimestamp(timing[2]) : undefined;
    const text = decodeVttText(blockLines.slice(timingIndex + 1).join('\n')).trim();
    cueNumber += 1;
    if (start === undefined || end === undefined || end <= start || !text) {
      throw new Error(`WebVTT cue ${cueNumber} has an invalid time range or no text.`);
    }
    captions.push(makeCaption(text, start, end));
  }

  if (!captions.length) throw new Error('The subtitle file contains no captions.');
  return captions;
}

function formatVttTimestamp(seconds: number): string {
  const milliseconds = Math.round(seconds * 1000);
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const remainingSeconds = Math.floor((milliseconds % 60_000) / 1000);
  const fraction = milliseconds % 1000;
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}.${fraction.toString().padStart(3, '0')}`;
}

function formatSubRipTimestamp(seconds: number): string {
  const milliseconds = Math.round(seconds * 1000);
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const remainingSeconds = Math.floor((milliseconds % 60_000) / 1000);
  const fraction = milliseconds % 1000;
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')},${fraction.toString().padStart(3, '0')}`;
}

export function serializeSubRip(overlays: readonly TextOverlay[]): string {
  const captions = overlays
    .filter((overlay) => overlay.kind === 'caption')
    .map((overlay) => {
      if (!Number.isFinite(overlay.start) || overlay.start < 0 || !Number.isFinite(overlay.duration) || overlay.duration <= 0 || !overlay.text.trim()) {
        throw new Error(`Caption "${overlay.text.slice(0, 40)}" has an invalid time range or no text.`);
      }
      return overlay;
    })
    .sort((a, b) => a.start - b.start);
  if (!captions.length) throw new Error('There are no captions to export.');

  return `${captions.map((caption, index) => {
    const start = formatSubRipTimestamp(caption.start);
    const end = formatSubRipTimestamp(caption.start + caption.duration);
    return `${index + 1}\r\n${start} --> ${end}\r\n${caption.text}`;
  }).join('\r\n\r\n')}\r\n`;
}

export function serializeWebVtt(overlays: readonly TextOverlay[]): string {
  const captions = overlays
    .filter((overlay) => overlay.kind === 'caption')
    .map((overlay) => {
      if (!Number.isFinite(overlay.start) || overlay.start < 0 || !Number.isFinite(overlay.duration) || overlay.duration <= 0 || !overlay.text.trim()) {
        throw new Error(`Caption "${overlay.text.slice(0, 40)}" has an invalid time range or no text.`);
      }
      return overlay;
    })
    .sort((a, b) => a.start - b.start);
  if (!captions.length) throw new Error('There are no captions to export.');

  return `WEBVTT\n\n${captions.map((caption) => {
    const start = formatVttTimestamp(caption.start);
    const end = formatVttTimestamp(caption.start + caption.duration);
    const text = caption.text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return `${start} --> ${end}\n${text}`;
  }).join('\n\n')}\n`;
}
