export type ToolId = 'media' | 'audio' | 'text' | 'captions' | 'elements' | 'effects' | 'transitions' | 'ai';
export type Track = { id: string; name: string; kind: 'video' | 'audio' | 'text'; color: string; muted: boolean; hidden: boolean; locked: boolean };
export type MediaAsset = { id: string; name: string; kind: 'video' | 'image' | 'audio'; mimeType: string; size: number };
export type TimelineClip = { id: string; assetId: string; trackId: string; start: number; duration: number; sourceOffset: number };
export type ProjectDocument = { version: 1; project: { id: string; name: string }; canvas: { width: number; height: number; fps: number; background: string }; tracks: Track[]; clips: TimelineClip[]; assets: MediaAsset[]; settings: Record<string, unknown> };

export const makeProject = (): ProjectDocument => ({
  version: 1,
  project: { id: crypto.randomUUID(), name: 'Untitled story' },
  canvas: { width: 1080, height: 1920, fps: 30, background: '#151619' },
  tracks: [
    { id: 'video-1', name: 'Video 1', kind: 'video', color: '#ad7dff', muted: false, hidden: false, locked: false },
    { id: 'text-1', name: 'Text & graphics', kind: 'text', color: '#49bca6', muted: false, hidden: false, locked: false },
    { id: 'audio-1', name: 'Audio 1', kind: 'audio', color: '#eaa65c', muted: false, hidden: false, locked: false },
  ],
  clips: [], assets: [], settings: {},
});

export const formatTime = (seconds: number) => `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${Math.floor(seconds % 60).toString().padStart(2, '0')}.${Math.floor((seconds % 1) * 10)}`;
