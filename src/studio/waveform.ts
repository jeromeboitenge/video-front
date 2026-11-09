import type { TimelineClip } from './model';

export type AudioWaveform = {
  duration: number;
  peaks: number[];
};

export function computeWaveformPeaks(channels: readonly Float32Array[], barCount = 256): number[] {
  if (!Number.isInteger(barCount) || barCount < 1) throw new Error('Waveform bar count must be a positive integer.');
  const sampleCount = channels.reduce((count, channel) => Math.max(count, channel.length), 0);
  if (!sampleCount) return Array.from({ length: barCount }, () => 0);

  return Array.from({ length: barCount }, (_, barIndex) => {
    const start = Math.floor(barIndex * sampleCount / barCount);
    const end = Math.max(start + 1, Math.floor((barIndex + 1) * sampleCount / barCount));
    let peak = 0;
    for (const channel of channels) {
      for (let sampleIndex = start; sampleIndex < Math.min(end, channel.length); sampleIndex += 1) {
        const sample = channel[sampleIndex];
        if (Number.isFinite(sample)) peak = Math.max(peak, Math.abs(sample));
      }
    }
    return Math.round(Math.min(1, peak) * 10000) / 10000;
  });
}

export function waveformPeaksForClip(waveform: AudioWaveform, clip: TimelineClip, barCount = 36): number[] {
  if (!Number.isInteger(barCount) || barCount < 1) throw new Error('Waveform bar count must be a positive integer.');
  if (!Number.isFinite(waveform.duration) || waveform.duration <= 0 || !waveform.peaks.length) {
    return Array.from({ length: barCount }, () => 0);
  }

  const sourceOffset = Math.max(0, clip.sourceOffset);
  const sourceDuration = clip.duration * (clip.speed ?? 1);
  return Array.from({ length: barCount }, (_, barIndex) => {
    const startTime = sourceOffset + sourceDuration * barIndex / barCount;
    const endTime = sourceOffset + sourceDuration * (barIndex + 1) / barCount;
    const first = Math.max(0, Math.min(waveform.peaks.length - 1, Math.floor(startTime / waveform.duration * waveform.peaks.length)));
    const afterLast = Math.max(first + 1, Math.min(waveform.peaks.length, Math.ceil(endTime / waveform.duration * waveform.peaks.length)));
    let peak = 0;
    for (let peakIndex = first; peakIndex < afterLast; peakIndex += 1) {
      peak = Math.max(peak, waveform.peaks[peakIndex]);
    }
    return startTime >= waveform.duration ? 0 : Math.min(1, Math.max(0, peak));
  });
}

export async function decodeAudioWaveform(blob: Blob): Promise<AudioWaveform> {
  if (typeof window === 'undefined' || !window.AudioContext) {
    throw new Error('Audio waveform decoding is not supported by this browser.');
  }

  const context = new window.AudioContext();
  try {
    const decoded = await context.decodeAudioData(await blob.arrayBuffer());
    if (!Number.isFinite(decoded.duration) || decoded.duration <= 0) {
      throw new Error('The audio file has no decodable duration.');
    }
    const channels = Array.from({ length: decoded.numberOfChannels }, (_, index) => decoded.getChannelData(index));
    return { duration: decoded.duration, peaks: computeWaveformPeaks(channels) };
  } finally {
    await context.close();
  }
}
