import type { TimelineClip } from './model';

export type VideoThumbnails = { duration: number; frames: { time: number; src: string }[] };

const SAMPLE_COUNT = 10;
const THUMB_HEIGHT = 48;

function once(target: HTMLMediaElement, event: string, timeoutMs = 8000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => { cleanup(); reject(new Error(`Timed out waiting for ${event}`)); }, timeoutMs);
    const ok = () => { cleanup(); resolve(); };
    const fail = () => { cleanup(); reject(new Error('The video could not be decoded for thumbnails.')); };
    const cleanup = () => { window.clearTimeout(timer); target.removeEventListener(event, ok); target.removeEventListener('error', fail); };
    target.addEventListener(event, ok, { once: true });
    target.addEventListener('error', fail, { once: true });
  });
}

/** Decodes evenly spaced frames of a video into small JPEG data URLs for the timeline filmstrip. */
export async function extractVideoThumbnails(url: string, count = SAMPLE_COUNT, height = THUMB_HEIGHT): Promise<VideoThumbnails> {
  const video = document.createElement('video');
  video.muted = true;
  video.preload = 'auto';
  video.playsInline = true;
  video.src = url;
  try {
    await once(video, 'loadeddata');
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    if (!duration || !video.videoWidth || !video.videoHeight) return { duration, frames: [] };
    const canvas = document.createElement('canvas');
    canvas.height = height;
    canvas.width = Math.max(1, Math.round(height * video.videoWidth / video.videoHeight));
    const context = canvas.getContext('2d');
    if (!context) return { duration, frames: [] };
    const frames: VideoThumbnails['frames'] = [];
    for (let index = 0; index < count; index += 1) {
      const time = Math.min(duration - 0.05, (index + 0.5) * duration / count);
      video.currentTime = Math.max(0, time);
      await once(video, 'seeked');
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      frames.push({ time, src: canvas.toDataURL('image/jpeg', 0.7) });
    }
    return { duration, frames };
  } finally {
    video.removeAttribute('src');
    video.load();
  }
}

/** Picks the sampled frame nearest to each tile's source time across the clip's trimmed range. */
export function filmstripFor(clip: TimelineClip, thumbnails: VideoThumbnails | undefined, tiles: number): string[] {
  if (!thumbnails?.frames.length || tiles < 1) return [];
  const speed = clip.speed ?? 1;
  const span = clip.duration * speed;
  return Array.from({ length: tiles }, (_, index) => {
    const sourceTime = clip.sourceOffset + (index + 0.5) * span / tiles;
    return thumbnails.frames.reduce((best, frame) => Math.abs(frame.time - sourceTime) < Math.abs(best.time - sourceTime) ? frame : best).src;
  });
}
