import { describe, expect, it } from 'vitest';
import { clipOpacityAt, makeProject } from './model';
import { audioGainAt, audioGainFor, createExportPlan } from './export';

describe('video export plan', () => {
  it('orders visible visual clips by track and includes audio tracks in duration', () => {
    const project = makeProject();
    project.assets = [
      { id: 'image', name: 'still.png', kind: 'image', mimeType: 'image/png', size: 12 },
      { id: 'sound', name: 'sound.wav', kind: 'audio', mimeType: 'audio/wav', size: 13 },
    ];
    project.clips = [
      { id: 'later-visual', assetId: 'image', trackId: 'video-1', start: 5, duration: 2, sourceOffset: 0 },
      { id: 'audio', assetId: 'sound', trackId: 'audio-1', start: 0, duration: 8, sourceOffset: 1 },
    ];

    const plan = createExportPlan(project);

    expect(plan.duration).toBe(8);
    expect(plan.video.map(({ clip }) => clip.id)).toEqual(['later-visual']);
    expect(plan.audio.map(({ clip }) => clip.id)).toEqual(['audio']);
  });

  it('fails with a clear message when the timeline is empty', () => {
    expect(() => createExportPlan(makeProject())).toThrow('Add a timeline clip, title, or caption before exporting.');
  });

  it('uses clip volume for export while honoring track mute', () => {
    const project = makeProject();
    const clip = { id: 'audio', assetId: 'sound', trackId: 'audio-1', start: 0, duration: 2, sourceOffset: 0, volume: 0.35, transitionIn: 1, transitionOut: 1 };
    const track = project.tracks.find(({ id }) => id === 'audio-1')!;
    expect(audioGainFor(clip, track)).toBe(0.35);
    expect(audioGainFor(clip, { ...track, muted: true })).toBe(0);
    expect(audioGainFor({ ...clip, volume: undefined }, track)).toBe(1);
    expect(audioGainAt(clip, track, 0)).toBe(0);
    expect(audioGainAt(clip, track, 0.5)).toBeCloseTo(0.175);
    expect(audioGainAt(clip, track, 1)).toBe(0.35);
    expect(audioGainAt(clip, track, 1.5)).toBeCloseTo(0.175);
    expect(audioGainAt(clip, track, 2)).toBe(0);
  });

  it('exports text-only sequences and extends duration to include overlays', () => {
    const project = makeProject();
    project.textOverlays = [{
      id: 'title-1', kind: 'title', text: 'Hello', start: 0, duration: 4, position: 'center', fontSize: 64, color: '#ffffff',
    }];
    expect(createExportPlan(project)).toMatchObject({ duration: 4, video: [], audio: [] });
  });

  it('calculates independent fade-in and fade-out opacity', () => {
    const clip = { id: 'clip', assetId: 'image', trackId: 'video-1', start: 2, duration: 4, sourceOffset: 0, transitionIn: 1, transitionOut: 1 };
    expect(clipOpacityAt(clip, 2)).toBe(0);
    expect(clipOpacityAt(clip, 2.5)).toBe(0.5);
    expect(clipOpacityAt(clip, 4)).toBe(1);
    expect(clipOpacityAt(clip, 5.5)).toBe(0.5);
    expect(clipOpacityAt(clip, 6)).toBe(0);
  });

  it('rejects clips that reference missing media or tracks', () => {
    const project = makeProject();
    project.clips = [{ id: 'invalid', assetId: 'missing', trackId: 'video-1', start: 0, duration: 1, sourceOffset: 0 }];
    expect(() => createExportPlan(project)).toThrow('A timeline clip refers to missing media or a missing track.');
  });
});
