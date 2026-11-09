import { describe, expect, it, vi } from 'vitest';
import { clipDurationAtSpeed, clipOpacityAt, clipSourceTimeAt, clipTransformAt, makeProject, MAX_CANVAS_PIXELS, parseProjectDocument } from './model';
import { applyClipTransform, audioGainAt, audioGainFor, createExportPlan, drawEditedImage } from './export';

describe('video export plan', () => {
  it('draws image adjustments and vignette effects into the still-image export canvas', () => {
    const filterValues: string[] = [];
    const stops: [number, string][] = [];
    const gradient = { addColorStop: (offset: number, color: string) => stops.push([offset, color]) };
    const drawImage = vi.fn();
    const createRadialGradient = vi.fn(() => gradient);
    const context = {
      save: vi.fn(),
      restore: vi.fn(),
      drawImage,
      createRadialGradient,
      fillRect: vi.fn(),
      set filter(value: string) { filterValues.push(value); },
      set fillStyle(_value: string | CanvasGradient | CanvasPattern) {},
    } as unknown as CanvasRenderingContext2D;
    const source = {} as CanvasImageSource;

    drawEditedImage(context, source, 100, 200, 'image-1', [
      { id: 'vivid', assetId: 'image-1', type: 'vivid', strength: 100, enabled: true },
      { id: 'vignette', assetId: 'image-1', type: 'vignette', strength: 50, enabled: true },
    ], { exposure: 10, contrast: 0, saturation: 0, temperature: 0, tint: 0 });

    expect(filterValues).toEqual(['brightness(1.1) saturate(1.8)']);
    expect(drawImage).toHaveBeenCalledWith(source, 0, 0, 100, 200);
    expect(createRadialGradient).toHaveBeenCalledWith(50, 100, 32, 50, 100, 144);
    expect(stops).toEqual([[0, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,0.39)']]);
    expect(context.fillRect).toHaveBeenCalledWith(0, 0, 100, 200);
  });

  it('accepts supported canvas formats and rejects unsafe dimensions and frame rates', () => {
    const project = makeProject();
    project.canvas = { ...project.canvas, width: 1920, height: 1080, fps: 60 };
    expect(parseProjectDocument(project).canvas).toMatchObject({ width: 1920, height: 1080, fps: 60 });
    project.canvas.width = Math.ceil(Math.sqrt(MAX_CANVAS_PIXELS)) + 1;
    project.canvas.height = project.canvas.width;
    expect(() => parseProjectDocument(project)).toThrow('This project document is not a supported Frameforge version.');
    project.canvas.width = 1080;
    project.canvas.height = 1920;
    project.canvas.fps = 121;
    expect(() => parseProjectDocument(project)).toThrow('This project document is not a supported Frameforge version.');
  });

  it('maps timeline time to media time at clip speed and preserves source range when speed changes', () => {
    const clip = { id: 'clip', assetId: 'video', trackId: 'video-1', start: 5, duration: 4, sourceOffset: 2, speed: 1.5 };
    expect(clipSourceTimeAt(clip, 4)).toBe(2);
    expect(clipSourceTimeAt(clip, 7)).toBe(5);
    expect(clipDurationAtSpeed(clip, 3)).toBe(2);

    const project = makeProject();
    project.assets = [{ id: 'video', name: 'shot.mp4', kind: 'video', mimeType: 'video/mp4', size: 12 }];
    project.clips = [{ ...clip, trackId: 'video-1' }];
    expect(createExportPlan(project).video[0].clip.speed).toBe(1.5);
    project.clips[0].speed = 4.1;
    expect(() => parseProjectDocument(project)).toThrow('This project document is not a supported Frameforge version.');
    expect(() => createExportPlan(project)).toThrow('has invalid timing');
  });

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

  it('applies clip transforms around the canvas center for export', () => {
    const calls: number[][] = [];
    const context: Pick<CanvasRenderingContext2D, 'translate' | 'rotate' | 'scale'> = {
      translate: (x, y) => { calls.push([x, y]); },
      rotate: (angle) => { calls.push([angle]); },
      scale: (x, y) => { calls.push([x, y]); },
    };
    applyClipTransform(context, {
      id: 'clip', assetId: 'image', trackId: 'video-1', start: 0, duration: 1, sourceOffset: 0,
      x: 90, y: -45, scale: 1.5, rotation: 90,
    }, 1080, 1920);
    expect(calls[0]).toEqual([630, 915]);
    expect(calls[1]?.[0]).toBeCloseTo(Math.PI / 2);
    expect(calls[2]).toEqual([1.5, 1.5]);
  });

  it('interpolates keyframed transforms using clip-local time in preview and export', () => {
    const clip = {
      id: 'clip', assetId: 'image', trackId: 'video-1', start: 5, duration: 2, sourceOffset: 0,
      keyframes: [
        { time: 0, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
        { time: 1, x: 100, y: 40, scale: 2, rotation: 90, opacity: 0.5 },
      ],
    };
    expect(clipTransformAt(clip, 0.5)).toEqual({ x: 50, y: 20, scale: 1.5, rotation: 45, opacity: 0.75 });

    const calls: number[][] = [];
    const context: Pick<CanvasRenderingContext2D, 'translate' | 'rotate' | 'scale'> = {
      translate: (x, y) => { calls.push([x, y]); },
      rotate: (angle) => { calls.push([angle]); },
      scale: (x, y) => { calls.push([x, y]); },
    };
    applyClipTransform(context, clip, 1080, 1920, 0.5);
    expect(calls[0]).toEqual([590, 980]);
    expect(calls[1]?.[0]).toBeCloseTo(Math.PI / 4);
    expect(calls[2]).toEqual([1.5, 1.5]);
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
