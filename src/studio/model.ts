import type { AppliedEffect } from './effects';

export type ToolId = 'media' | 'audio' | 'text' | 'captions' | 'elements' | 'effects' | 'transitions' | 'ai';
export type Track = { id: string; name: string; kind: 'video' | 'audio' | 'text'; color: string; muted: boolean; hidden: boolean; locked: boolean };
export type MediaAsset = { id: string; name: string; kind: 'video' | 'image' | 'audio'; mimeType: string; size: number; cloudId?: string };
export type TimelineClip = { id: string; assetId: string; trackId: string; start: number; duration: number; sourceOffset: number };
export type ProjectDocument = { version: 1; project: { id: string; name: string }; canvas: { width: number; height: number; fps: number; background: string }; tracks: Track[]; clips: TimelineClip[]; assets: MediaAsset[]; effects: AppliedEffect[]; settings: Record<string, unknown> };

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

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
    !document.clips.every((clip) => isRecord(clip) && typeof clip.id === 'string' && typeof clip.assetId === 'string' && typeof clip.trackId === 'string' && Number.isFinite(clip.start) && Number.isFinite(clip.duration) && Number.isFinite(clip.sourceOffset)) ||
    !Array.isArray(document.assets) ||
    !document.assets.every((asset) => isRecord(asset) && typeof asset.id === 'string' && typeof asset.name === 'string' && ['video', 'image', 'audio'].includes(String(asset.kind)) && typeof asset.mimeType === 'string' && Number.isFinite(asset.size) && (asset.cloudId === undefined || typeof asset.cloudId === 'string')) ||
    (document.effects !== undefined && (!Array.isArray(document.effects) || !document.effects.every((effect) => isRecord(effect) && typeof effect.id === 'string' && typeof effect.assetId === 'string' && assets.some((asset) => isRecord(asset) && asset.id === effect.assetId) && ['vivid', 'monochrome', 'vintage', 'soft-focus', 'warm-glow', 'cool-tone', 'vignette'].includes(String(effect.type)) && typeof effect.strength === 'number' && Number.isFinite(effect.strength) && effect.strength >= 0 && effect.strength <= 100 && typeof effect.enabled === 'boolean'))) ||
    !document.settings ||
    !isRecord(document.settings)
  ) {
    throw new Error('This project document is not a supported Frameforge version.');
  }
  return { ...document, effects: document.effects ?? [] } as ProjectDocument;
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
  clips: [], assets: [], effects: [], settings: {},
});

export const formatTime = (seconds: number) => `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${Math.floor(seconds % 60).toString().padStart(2, '0')}.${Math.floor((seconds % 1) * 10)}`;
