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

    captions.push({
      kind: 'caption',
      text,
      start,
      duration: end - start,
      position: 'bottom',
      fontSize: 42,
      color: '#ffffff',
    });
  });

  if (!captions.length) throw new Error('The subtitle file contains no captions.');
  return captions;
}
