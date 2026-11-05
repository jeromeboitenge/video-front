import { describe, expect, it } from 'vitest';
import { makeProject } from './model';
import { createExportPlan } from './export';

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
    expect(() => createExportPlan(makeProject())).toThrow('Add at least one timeline clip before exporting.');
  });

  it('rejects clips that reference missing media or tracks', () => {
    const project = makeProject();
    project.clips = [{ id: 'invalid', assetId: 'missing', trackId: 'video-1', start: 0, duration: 1, sourceOffset: 0 }];
    expect(() => createExportPlan(project)).toThrow('A timeline clip refers to missing media or a missing track.');
  });
});
