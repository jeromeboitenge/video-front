import { describe, expect, it, vi } from 'vitest';
import { computeWaveformPeaks, decodeAudioWaveform, waveformPeaksForClip } from './waveform';

describe('audio waveform extraction', () => {
  it('computes peak amplitudes across channels and normalized sample ranges', () => {
    const peaks = computeWaveformPeaks([
      new Float32Array([0.1, -0.5, 0.2, 0.1]),
      new Float32Array([0.3, 0.1, -0.8, 0.2]),
    ], 2);

    expect(peaks).toEqual([0.5, 0.8]);
  });

  it('maps clip source offsets and speed to the displayed waveform segment', () => {
    const waveform = { duration: 4, peaks: [0.1, 0.2, 0.7, 0.9] };
    const clip = { id: 'clip-1', assetId: 'asset-1', trackId: 'audio-1', start: 0, duration: 2, sourceOffset: 1, speed: 1 };

    expect(waveformPeaksForClip(waveform, clip, 2)).toEqual([0.2, 0.7]);
    expect(waveformPeaksForClip(waveform, { ...clip, speed: 2 }, 2)).toEqual([0.7, 0.9]);
  });

  it('rejects invalid bar counts and returns silence for empty channel data', () => {
    expect(() => computeWaveformPeaks([], 0)).toThrow('Waveform bar count must be a positive integer.');
    expect(computeWaveformPeaks([], 3)).toEqual([0, 0, 0]);
  });

  it('decodes browser audio and closes its Web Audio context', async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const decodeAudioData = vi.fn().mockResolvedValue({
      duration: 1,
      numberOfChannels: 1,
      getChannelData: () => new Float32Array([0.25, -0.75]),
    });
    const originalAudioContext = window.AudioContext;
    Object.defineProperty(window, 'AudioContext', {
      configurable: true,
      value: class {
        decodeAudioData = decodeAudioData;
        close = close;
      },
    });

    try {
      const blob = new Blob(['encoded audio']);
      Object.defineProperty(blob, 'arrayBuffer', { value: vi.fn().mockResolvedValue(new ArrayBuffer(8)) });
      const waveform = await decodeAudioWaveform(blob);
      expect(waveform.duration).toBe(1);
      expect(waveform.peaks).toHaveLength(256);
      expect(Math.max(...waveform.peaks)).toBe(0.75);
      expect(decodeAudioData).toHaveBeenCalledOnce();
      expect(close).toHaveBeenCalledOnce();
    } finally {
      Object.defineProperty(window, 'AudioContext', { configurable: true, value: originalAudioContext });
    }
  });
});
