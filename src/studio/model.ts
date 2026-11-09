import type { AppliedEffect, ColorAdjustment } from './effects';

export type ToolId = 'media' | 'audio' | 'text' | 'captions' | 'elements' | 'effects' | 'transitions' | 'ai';
export type Track = { id: string; name: string; kind: 'video' | 'audio' | 'text'; color: string; muted: boolean; hidden: boolean; locked: boolean };
export type MediaAsset = { id: string; name: string; kind: 'video' | 'image' | 'audio'; mimeType: string; size: number; cloudId?: string };
export type VisualTransform = { x: number; y: number; scale: number; rotation: number; opacity: number };
export type ClipKeyframe = VisualTransform & { time: number };
export type TimelineClip = { id: string; assetId: string; trackId: string; start: number; duration: number; sourceOffset: number; speed?: number; volume?: number; x?: number; y?: number; scale?: number; rotation?: number; opacity?: number; keyframes?: ClipKeyframe[]; transitionIn?: number; transitionOut?: number };
export type TextOverlay = { id: string; kind: 'title' | 'caption'; text: string; start: number; duration: number; position: 'top' | 'center' | 'bottom'; fontSize: number; color: string; fontFamily?: 'Manrope' | 'Arial' | 'Georgia'; fontWeight?: 'normal' | 'bold'; italic?: boolean; outlineColor?: string; outlineWidth?: number };
export type ProjectDocument = { version: 1; project: { id: string; name: string }; canvas: { width: number; height: number; fps: number; background: string }; tracks: Track[]; clips: TimelineClip[]; assets: MediaAsset[]; effects: AppliedEffect[]; colorAdjustments: Record<string, ColorAdjustment>; textOverlays: TextOverlay[]; settings: Record<string, unknown> };

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const colorAdjustmentFields: (keyof ColorAdjustment)[] = ['exposure', 'contrast', 'saturation', 'temperature', 'tint'];
export const MIN_CLIP_SPEED = 0.25;
export const MAX_CLIP_SPEED = 4;

export function clipSourceTimeAt(clip: TimelineClip, timelineTime: number): number {
  return clip.sourceOffset + Math.max(0, timelineTime - clip.start) * (clip.speed ?? 1);
}

export function clipDurationAtSpeed(clip: TimelineClip, speed: number): number {
  return clip.duration * (clip.speed ?? 1) / speed;
}

function validKeyframes(value: unknown, duration: number): value is ClipKeyframe[] {
  if (!Array.isArray(value)) return false;
  return value.every((frame, index) => {
    if (!isRecord(frame) || !Number.isFinite(frame.time) || Number(frame.time) < 0 || Number(frame.time) > duration ||
      !Number.isFinite(frame.x) || Math.abs(Number(frame.x)) > 100000 ||
      !Number.isFinite(frame.y) || Math.abs(Number(frame.y)) > 100000 ||
      !Number.isFinite(frame.scale) || Number(frame.scale) < 0.1 || Number(frame.scale) > 5 ||
      !Number.isFinite(frame.rotation) || Math.abs(Number(frame.rotation)) > 3600 ||
      !Number.isFinite(frame.opacity) || Number(frame.opacity) < 0 || Number(frame.opacity) > 1) return false;
    return index === 0 || Number(frame.time) > Number((value[index - 1] as Record<string, unknown>).time);
  });
}

export function parseProjectDocument(value: unknown): ProjectDocument {
  if (!isRecord(value)) throw new Error('Project document is missing or invalid.');
  const document = value as Partial<ProjectDocument>;
  const assets = Array.isArray(document.assets) ? document.assets : [];
  if (
    document.version !== 1 ||
    !document.project ||
    typeof document.project.id !== 'string' ||
    typeof document.project.name !== 'string' ||
    !document.canvas ||
    !Number.isFinite(document.canvas.width) ||
    !Number.isFinite(document.canvas.height) ||
    !Number.isFinite(document.canvas.fps) ||
    typeof document.canvas.background !== 'string' ||
    !Array.isArray(document.tracks) ||
    !document.tracks.every((track) => isRecord(track) && typeof track.id === 'string' && typeof track.name === 'string' && ['video', 'audio', 'text'].includes(String(track.kind)) && typeof track.color === 'string' && typeof track.muted === 'boolean' && typeof track.hidden === 'boolean' && typeof track.locked === 'boolean') ||
    !Array.isArray(document.clips) ||
    !document.clips.every((clip) => isRecord(clip) && typeof clip.id === 'string' && typeof clip.assetId === 'string' && typeof clip.trackId === 'string' && Number.isFinite(clip.start) && Number.isFinite(clip.duration) && Number.isFinite(clip.sourceOffset) && (clip.speed === undefined || (Number.isFinite(clip.speed) && Number(clip.speed) >= MIN_CLIP_SPEED && Number(clip.speed) <= MAX_CLIP_SPEED)) && (clip.volume === undefined || (Number.isFinite(clip.volume) && Number(clip.volume) >= 0 && Number(clip.volume) <= 1)) && (clip.x === undefined || (Number.isFinite(clip.x) && Math.abs(Number(clip.x)) <= 100000)) && (clip.y === undefined || (Number.isFinite(clip.y) && Math.abs(Number(clip.y)) <= 100000)) && (clip.scale === undefined || (Number.isFinite(clip.scale) && Number(clip.scale) >= 0.1 && Number(clip.scale) <= 5)) && (clip.rotation === undefined || (Number.isFinite(clip.rotation) && Math.abs(Number(clip.rotation)) <= 3600)) && (clip.opacity === undefined || (Number.isFinite(clip.opacity) && Number(clip.opacity) >= 0 && Number(clip.opacity) <= 1)) && (clip.keyframes === undefined || validKeyframes(clip.keyframes, Number(clip.duration))) && (clip.transitionIn === undefined || (Number.isFinite(clip.transitionIn) && Number(clip.transitionIn) >= 0 && Number(clip.transitionIn) <= Number(clip.duration) / 2)) && (clip.transitionOut === undefined || (Number.isFinite(clip.transitionOut) && Number(clip.transitionOut) >= 0 && Number(clip.transitionOut) <= Number(clip.duration) / 2))) ||
    !Array.isArray(document.assets) ||
    !document.assets.every((asset) => isRecord(asset) && typeof asset.id === 'string' && typeof asset.name === 'string' && ['video', 'image', 'audio'].includes(String(asset.kind)) && typeof asset.mimeType === 'string' && Number.isFinite(asset.size) && (asset.cloudId === undefined || typeof asset.cloudId === 'string')) ||
    (document.effects !== undefined && (!Array.isArray(document.effects) || !document.effects.every((effect) => isRecord(effect) && typeof effect.id === 'string' && typeof effect.assetId === 'string' && assets.some((asset) => isRecord(asset) && asset.id === effect.assetId) && ['vivid', 'monochrome', 'vintage', 'soft-focus', 'warm-glow', 'cool-tone', 'vignette'].includes(String(effect.type)) && typeof effect.strength === 'number' && Number.isFinite(effect.strength) && effect.strength >= 0 && effect.strength <= 100 && typeof effect.enabled === 'boolean'))) ||
    (document.textOverlays !== undefined && (!Array.isArray(document.textOverlays) || !document.textOverlays.every((overlay) => isRecord(overlay) && typeof overlay.id === 'string' && ['title', 'caption'].includes(String(overlay.kind)) && typeof overlay.text === 'string' && overlay.text.trim().length > 0 && Number.isFinite(overlay.start) && Number(overlay.start) >= 0 && Number.isFinite(overlay.duration) && Number(overlay.duration) > 0 && ['top', 'center', 'bottom'].includes(String(overlay.position)) && Number.isFinite(overlay.fontSize) && Number(overlay.fontSize) >= 14 && Number(overlay.fontSize) <= 160 && typeof overlay.color === 'string' && (overlay.fontFamily === undefined || ['Manrope', 'Arial', 'Georgia'].includes(String(overlay.fontFamily))) && (overlay.fontWeight === undefined || ['normal', 'bold'].includes(String(overlay.fontWeight))) && (overlay.italic === undefined || typeof overlay.italic === 'boolean') && (overlay.outlineColor === undefined || typeof overlay.outlineColor === 'string') && (overlay.outlineWidth === undefined || (Number.isFinite(overlay.outlineWidth) && Number(overlay.outlineWidth) >= 0 && Number(overlay.outlineWidth) <= 12))))) ||
    (document.colorAdjustments !== undefined && (!isRecord(document.colorAdjustments) || Object.entries(document.colorAdjustments).some(([assetId, adjustment]) => !assets.some((asset) => isRecord(asset) && asset.id === assetId) || !isRecord(adjustment) || colorAdjustmentFields.some((field) => !Number.isFinite(adjustment[field]) || Number(adjustment[field]) < -100 || Number(adjustment[field]) > 100)))) ||
    !document.settings ||
    !isRecord(document.settings)
  ) {
    throw new Error('This project document is not a supported Frameforge version.');
  }
  return { ...document, effects: document.effects ?? [], colorAdjustments: document.colorAdjustments ?? {}, textOverlays: document.textOverlays ?? [] } as ProjectDocument;
}

export const makeProject = (): ProjectDocument => ({
  version: 1,
  project: { id: crypto.randomUUID(), name: 'Untitled story' },
  canvas: { width: 1080, height: 1920, fps: 30, background: '#151619' },
  tracks: [
    { id: 'video-1', name: 'Video 1', kind: 'video', color: '#ad7dff', muted: false, hidden: false, locked: false },
    { id: 'text-1', name: 'Text & graphics', kind: 'text', color: '#49bca6', muted: false, hidden: false, locked: false },
    { id: 'audio-1', name: 'Audio 1', kind: 'audio', color: '#eaa65c', muted: false, hidden: false, locked: false },
  ],
  clips: [], assets: [], effects: [], colorAdjustments: {}, textOverlays: [], settings: {},
});

export const formatTime = (seconds: number) => `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${Math.floor(seconds % 60).toString().padStart(2, '0')}.${Math.floor((seconds % 1) * 10)}`;

export function clipOpacityAt(clip: TimelineClip, time: number): number {
  const fadeIn = clip.transitionIn ?? 0;
  const fadeOut = clip.transitionOut ?? 0;
  const fadeInOpacity = fadeIn > 0 ? Math.min(1, Math.max(0, (time - clip.start) / fadeIn)) : 1;
  const fadeOutOpacity = fadeOut > 0 ? Math.min(1, Math.max(0, (clip.start + clip.duration - time) / fadeOut)) : 1;
  return Math.min(fadeInOpacity, fadeOutOpacity);
}

export function clipVisualOpacityAt(clip: TimelineClip, time: number): number {
  return clipOpacityAt(clip, time) * clipTransformAt(clip, time - clip.start).opacity;
}

export function clipTransformAt(clip: TimelineClip, time: number): VisualTransform {
  const base: VisualTransform = {
    x: clip.x ?? 0,
    y: clip.y ?? 0,
    scale: clip.scale ?? 1,
    rotation: clip.rotation ?? 0,
    opacity: clip.opacity ?? 1,
  };
  const keyframes = clip.keyframes ?? [];
  if (!keyframes.length) return base;
  if (time <= keyframes[0].time) return keyframes[0];
  const last = keyframes[keyframes.length - 1];
  if (time >= last.time) return last;
  const nextIndex = keyframes.findIndex((keyframe) => keyframe.time >= time);
  const from = keyframes[nextIndex - 1];
  const to = keyframes[nextIndex];
  const ratio = (time - from.time) / (to.time - from.time);
  return {
    x: from.x + (to.x - from.x) * ratio,
    y: from.y + (to.y - from.y) * ratio,
    scale: from.scale + (to.scale - from.scale) * ratio,
    rotation: from.rotation + (to.rotation - from.rotation) * ratio,
    opacity: from.opacity + (to.opacity - from.opacity) * ratio,
  };
}

export function clipTransformStyle(clip: TimelineClip, time: number): string {
  const transform = clipTransformAt(clip, time);
  return `translate(${transform.x}px, ${transform.y}px) rotate(${transform.rotation}deg) scale(${transform.scale})`;
}
