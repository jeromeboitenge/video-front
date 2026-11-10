import { getCloudMediaContent } from './api';
import { effectStyle, type AppliedEffect, type ColorAdjustment } from './effects';
import { clipOpacityAt, clipSourceTimeAt, clipTransformAt, clipVisualOpacityAt, MAX_CLIP_SPEED, MIN_CLIP_SPEED, type MediaAsset, type ProjectDocument, type TimelineClip, type Track } from './model';
import { readMedia } from './mediaStore';

type ExportClip = {
  clip: TimelineClip;
  asset: MediaAsset;
  track: Track;
  trackIndex: number;
};

export type ExportPlan = {
  duration: number;
  fps: number;
  video: ExportClip[];
  audio: ExportClip[];
};

export function audioGainFor(clip: TimelineClip, track: Track): number {
  return track.muted ? 0 : clip.volume ?? 1;
}

export function audioGainAt(clip: TimelineClip, track: Track, time: number): number {
  return audioGainFor(clip, track) * clipOpacityAt(clip, time);
}

export function applyClipTransform(
  context: Pick<CanvasRenderingContext2D, 'translate' | 'rotate' | 'scale'>,
  clip: TimelineClip,
  width: number,
  height: number,
  time = 0,
): void {
  const transform = clipTransformAt(clip, time);
  context.translate(width / 2 + transform.x, height / 2 + transform.y);
  context.rotate(transform.rotation * Math.PI / 180);
  context.scale(transform.scale, transform.scale);
}

export function createExportPlan(project: ProjectDocument): ExportPlan {
  const tracks = new Map(project.tracks.map((track, index) => [track.id, { track, index }]));
  const assets = new Map(project.assets.map((asset) => [asset.id, asset]));
  const video: ExportClip[] = [];
  const audio: ExportClip[] = [];

  for (const clip of project.clips) {
    const asset = assets.get(clip.assetId);
    const entry = tracks.get(clip.trackId);
    if (!asset || !entry) throw new Error('A timeline clip refers to missing media or a missing track.');
    if (!Number.isFinite(clip.start) || clip.start < 0 || !Number.isFinite(clip.duration) || clip.duration <= 0 || !Number.isFinite(clip.start + clip.duration) || !Number.isFinite(clip.sourceOffset) || clip.sourceOffset < 0 || !Number.isFinite(clip.speed ?? 1) || (clip.speed ?? 1) < MIN_CLIP_SPEED || (clip.speed ?? 1) > MAX_CLIP_SPEED) {
      throw new Error(`The clip "${asset.name}" has invalid timing.`);
    }

    const item = { clip, asset, track: entry.track, trackIndex: entry.index };
    if (entry.track.kind === 'video' && asset.kind !== 'audio' && !entry.track.hidden) video.push(item);
    if (entry.track.kind === 'audio' && (asset.kind === 'audio' || asset.kind === 'video')) audio.push(item);
  }

  const duration = Math.max(
    project.clips.reduce((end, clip) => Math.max(end, clip.start + clip.duration), 0),
    project.textOverlays.reduce((end, overlay) => Math.max(end, overlay.start + overlay.duration), 0),
  );
  if (duration <= 0) throw new Error('Add a timeline clip, title, or caption before exporting.');
  if (!Number.isFinite(project.canvas.fps) || project.canvas.fps <= 0 || project.canvas.fps > 120) throw new Error('The project frame rate must be between 1 and 120 fps.');
  if (!Number.isFinite(project.canvas.width) || project.canvas.width <= 0 || !Number.isFinite(project.canvas.height) || project.canvas.height <= 0) {
    throw new Error('The project canvas dimensions must be greater than zero.');
  }
  video.sort((a, b) => a.trackIndex - b.trackIndex || a.clip.start - b.clip.start);
  audio.sort((a, b) => a.trackIndex - b.trackIndex || a.clip.start - b.clip.start);
  if (!video.length && !audio.length && !project.textOverlays.length) throw new Error('Add a visible video/image clip, audio clip, title, or caption before exporting.');
  return { duration, fps: project.canvas.fps, video, audio };
}

function objectUrlFor(blob: Blob): string {
  return URL.createObjectURL(blob);
}

async function loadAsset(asset: MediaAsset, signal: AbortSignal): Promise<Blob> {
  const localBlob = await readMedia(asset.id);
  if (localBlob) return localBlob;
  if (asset.cloudId && sessionStorage.getItem('frameforge:access-token')) return getCloudMediaContent(asset.cloudId);
  if (signal.aborted) throw new DOMException('Export cancelled.', 'AbortError');
  throw new Error(`"${asset.name}" is unavailable on this device. Reimport it before exporting.`);
}

export function drawEditedImage(
  context: CanvasRenderingContext2D,
  source: CanvasImageSource,
  width: number,
  height: number,
  assetId: string,
  effects: AppliedEffect[],
  adjustment: ColorAdjustment | undefined,
): void {
  const effect = effectStyle(effects, assetId, adjustment);
  context.save();
  context.filter = effect.filter ?? 'none';
  context.drawImage(source, 0, 0, width, height);
  context.restore();

  if (effect.vignette > 0) {
    const gradient = context.createRadialGradient(width / 2, height / 2, height * 0.16, width / 2, height / 2, height * 0.72);
    gradient.addColorStop(0, 'rgba(0,0,0,0)');
    gradient.addColorStop(1, `rgba(0,0,0,${effect.vignette * 0.78})`);
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);
  }
}

export async function renderEditedImage(asset: MediaAsset, project: ProjectDocument): Promise<Blob> {
  if (asset.kind !== 'image') throw new Error('PNG export is only available for image assets.');
  if (typeof createImageBitmap !== 'function') throw new Error('This browser does not support image export. Use a current version of Chrome, Edge, or Firefox.');

  if (project.imageLayers.length) return renderImageComposition(project);

  const bitmap = await createImageBitmap(await loadAsset(asset, new AbortController().signal));
  try {
    if (!bitmap.width || !bitmap.height) throw new Error(`Could not decode "${asset.name}" for export.`);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not initialize the image rendering canvas.');
    drawEditedImage(context, bitmap, canvas.width, canvas.height, asset.id, project.effects, project.colorAdjustments[asset.id]);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('The browser could not encode the edited image as PNG.')), 'image/png');
    });
  } finally {
    bitmap.close();
  }
}

async function renderImageComposition(project: ProjectDocument): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = project.canvas.width;
  canvas.height = project.canvas.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not initialize the image composition canvas.');
  const assets = new Map(project.assets.map((asset) => [asset.id, asset]));
  for (const layer of project.imageLayers) {
    if (!layer.visible) continue;
    const asset = assets.get(layer.assetId);
    if (!asset) continue;
    const bitmap = await createImageBitmap(await loadAsset(asset, new AbortController().signal));
    try {
      const ratio = Math.min(canvas.width / bitmap.width, canvas.height / bitmap.height);
      const width = bitmap.width * ratio;
      const height = bitmap.height * ratio;
      const effect = effectStyle(project.effects, asset.id, project.colorAdjustments[asset.id]);
      context.save();
      context.globalAlpha = layer.opacity;
      context.globalCompositeOperation = layer.blendMode === 'normal' ? 'source-over' : layer.blendMode;
      context.filter = effect.filter ?? 'none';
      context.translate(canvas.width / 2 + layer.x * canvas.width / 100, canvas.height / 2 + layer.y * canvas.height / 100);
      context.rotate(layer.rotation * Math.PI / 180);
      context.scale(layer.scale, layer.scale);
      context.beginPath();
      context.rect(
        canvas.width * (layer.cropLeft ?? 0),
        canvas.height * (layer.cropTop ?? 0),
        canvas.width * (1 - (layer.cropLeft ?? 0) - (layer.cropRight ?? 0)),
        canvas.height * (1 - (layer.cropTop ?? 0) - (layer.cropBottom ?? 0)),
      );
      context.clip();
      context.drawImage(bitmap, -width / 2, -height / 2, width, height);
      context.restore();
      if (effect.vignette > 0) {
        const gradient = context.createRadialGradient(canvas.width / 2, canvas.height / 2, canvas.height * 0.16, canvas.width / 2, canvas.height / 2, canvas.height * 0.72);
        gradient.addColorStop(0, 'rgba(0,0,0,0)');
        gradient.addColorStop(1, `rgba(0,0,0,${effect.vignette * 0.78})`);
        context.fillStyle = gradient;
        context.fillRect(0, 0, canvas.width, canvas.height);
      }
    } finally {
      bitmap.close();
    }
  }
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('The browser could not encode the image composition as PNG.')), 'image/png');
  });
}

function waitForMedia(media: HTMLMediaElement, assetName: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const onReady = () => { cleanup(); resolve(); };
    const onError = () => { cleanup(); reject(new Error(`Could not decode "${assetName}" for export.`)); };
    const cleanup = () => {
      media.removeEventListener('loadedmetadata', onReady);
      media.removeEventListener('error', onError);
    };
    if (media.readyState >= HTMLMediaElement.HAVE_METADATA) {
      resolve();
      return;
    }
    media.addEventListener('loadedmetadata', onReady, { once: true });
    media.addEventListener('error', onError, { once: true });
  });
}

function waitForSeek(media: HTMLMediaElement, seconds: number): Promise<void> {
  if (Math.abs(media.currentTime - seconds) < 0.04) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const onSeeked = () => { cleanup(); resolve(); };
    const onError = () => { cleanup(); reject(new Error('A media clip could not seek to its requested source time.')); };
    const cleanup = () => {
      media.removeEventListener('seeked', onSeeked);
      media.removeEventListener('error', onError);
    };
    media.addEventListener('seeked', onSeeked, { once: true });
    media.addEventListener('error', onError, { once: true });
    media.currentTime = seconds;
  });
}

function drawCover(context: CanvasRenderingContext2D, source: CanvasImageSource, sourceWidth: number, sourceHeight: number, width: number, height: number, clip: TimelineClip, time: number) {
  const scale = Math.max(width / sourceWidth, height / sourceHeight);
  const drawWidth = sourceWidth * scale;
  const drawHeight = sourceHeight * scale;
  applyClipTransform(context, clip, width, height, time);
  context.drawImage(source, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
}

export async function renderProjectVideo(
  project: ProjectDocument,
  onProgress: (progress: number) => void,
  signal: AbortSignal,
): Promise<Blob> {
  const plan = createExportPlan(project);
  if (typeof MediaRecorder === 'undefined' || typeof HTMLCanvasElement.prototype.captureStream !== 'function') {
    throw new Error('This browser does not support video rendering. Use a current version of Chrome, Edge, or Firefox.');
  }
  const mimeType = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find((type) => MediaRecorder.isTypeSupported(type));
  if (!mimeType) throw new Error('This browser does not support WebM video encoding.');

  const canvas = document.createElement('canvas');
  canvas.width = project.canvas.width;
  canvas.height = project.canvas.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not initialize the video rendering canvas.');

  const objectUrls: string[] = [];
  const mediaElements: HTMLMediaElement[] = [];
  const mediaEntries: { media: HTMLMediaElement; asset: MediaAsset }[] = [];
  const playback = new Map<ExportClip, HTMLMediaElement>();
  const gainNodes = new Map<ExportClip, GainNode>();
  const imageSources = new Map<string, HTMLImageElement>();
  let audioContext: AudioContext | undefined;
  let audioDestination: MediaStreamAudioDestinationNode | undefined;
  let outputStream: MediaStream | undefined;
  let recorder: MediaRecorder | undefined;

  try {
    const usedAssets = new Map<string, MediaAsset>();
    for (const item of [...plan.video, ...plan.audio]) usedAssets.set(item.asset.id, item.asset);
    const urls = new Map<string, string>();
    for (const asset of usedAssets.values()) {
      if (signal.aborted) throw new DOMException('Export cancelled.', 'AbortError');
      urls.set(asset.id, objectUrlFor(await loadAsset(asset, signal)));
      objectUrls.push(urls.get(asset.id)!);
    }

    const imageLoads: Promise<void>[] = [];
    for (const item of plan.video) {
      if (item.asset.kind === 'image' && !imageSources.has(item.asset.id)) {
        const image = new Image();
        const loaded = new Promise<void>((resolve, reject) => {
          image.onload = () => resolve();
          image.onerror = () => reject(new Error(`Could not decode "${item.asset.name}" for export.`));
        });
        image.src = urls.get(item.asset.id)!;
        imageSources.set(item.asset.id, image);
        imageLoads.push(loaded);
      } else if (item.asset.kind === 'video') {
        const video = document.createElement('video');
        video.preload = 'auto';
        video.playsInline = true;
        video.src = urls.get(item.asset.id)!;
        mediaElements.push(video);
        mediaEntries.push({ media: video, asset: item.asset });
        playback.set(item, video);
      }
    }

    const audioItems = [...plan.audio, ...plan.video.filter((item) => item.asset.kind === 'video')];
    if (audioItems.length) {
      audioContext = new AudioContext();
      audioDestination = audioContext.createMediaStreamDestination();
      await audioContext.resume();
      for (const item of audioItems) {
        const media = playback.get(item) ?? document.createElement('audio');
        if (!playback.has(item)) {
          media.preload = 'auto';
          media.src = urls.get(item.asset.id)!;
          mediaElements.push(media);
          mediaEntries.push({ media, asset: item.asset });
          playback.set(item, media);
        }
        const source = audioContext.createMediaElementSource(media);
        const gain = audioContext.createGain();
        gain.gain.value = 0;
        gainNodes.set(item, gain);
        source.connect(gain).connect(audioDestination);
      }
    }

    await Promise.all([
      ...imageLoads,
      ...mediaEntries.map(({ media, asset }) => waitForMedia(media, asset.name)),
    ]);
    if (signal.aborted) throw new DOMException('Export cancelled.', 'AbortError');

    for (const [item, media] of playback) {
      media.volume = 1;
      media.muted = false;
      media.playbackRate = item.clip.speed ?? 1;
      media.pause();
      await waitForSeek(media, clipSourceTimeAt(item.clip, item.clip.start));
    }

    const canvasStream = canvas.captureStream(plan.fps);
    const tracks = [...canvasStream.getVideoTracks()];
    if (audioDestination) tracks.push(...audioDestination.stream.getAudioTracks());
    outputStream = new MediaStream(tracks);
    const chunks: BlobPart[] = [];
    recorder = new MediaRecorder(outputStream, { mimeType });
    const stopped = new Promise<Blob>((resolve, reject) => {
      recorder!.addEventListener('dataavailable', (event) => {
        if (event.data.size) chunks.push(event.data);
      });
      recorder!.addEventListener('error', () => reject(new Error('The browser failed while encoding the video export.')), { once: true });
      recorder!.addEventListener('stop', () => resolve(new Blob(chunks, { type: mimeType })), { once: true });
    });
    void stopped.catch(() => {});

    const drawFrame = (time: number) => {
      context.fillStyle = project.canvas.background;
      context.fillRect(0, 0, canvas.width, canvas.height);
      for (const item of plan.video) {
        if (time < item.clip.start || time >= item.clip.start + item.clip.duration) continue;
        const effect = effectStyle(project.effects, item.asset.id, project.colorAdjustments[item.asset.id]);
        context.save();
        context.globalAlpha = clipVisualOpacityAt(item.clip, time);
        context.filter = effect.filter ?? 'none';
        if (item.asset.kind === 'image') {
          const image = imageSources.get(item.asset.id);
          if (image?.naturalWidth && image.naturalHeight) drawCover(context, image, image.naturalWidth, image.naturalHeight, canvas.width, canvas.height, item.clip, time - item.clip.start);
        } else {
          const video = playback.get(item) as HTMLVideoElement | undefined;
          if (video && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth && video.videoHeight) {
            drawCover(context, video, video.videoWidth, video.videoHeight, canvas.width, canvas.height, item.clip, time - item.clip.start);
          }
        }
        context.restore();
        if (effect.vignette > 0) {
          const gradient = context.createRadialGradient(canvas.width / 2, canvas.height / 2, canvas.height * 0.16, canvas.width / 2, canvas.height / 2, canvas.height * 0.72);
          gradient.addColorStop(0, 'rgba(0,0,0,0)');
          gradient.addColorStop(1, `rgba(0,0,0,${effect.vignette * 0.78})`);
          context.fillStyle = gradient;
          context.fillRect(0, 0, canvas.width, canvas.height);
        }
      }
      for (const overlay of project.textOverlays) {
        if (time < overlay.start || time >= overlay.start + overlay.duration) continue;
        const fontSize = Math.round(overlay.fontSize * canvas.width / 1080);
        context.save();
        const fontFamily = overlay.fontFamily ?? 'Manrope';
        const fontWeight = overlay.fontWeight ?? 'bold';
        context.font = `${overlay.italic ? 'italic ' : ''}${fontWeight} ${fontSize}px ${fontFamily}, sans-serif`;
        const lines = overlay.text.split('\n');
        const maxWidth = canvas.width * 0.88;
        const wrapped: string[] = [];
        for (const line of lines) {
          let current = '';
          for (const word of line.split(/\s+/)) {
            const candidate = current ? `${current} ${word}` : word;
            if (current && context.measureText(candidate).width > maxWidth) {
              wrapped.push(current);
              current = word;
            } else current = candidate;
          }
          if (current) wrapped.push(current);
        }
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.shadowColor = 'rgba(0,0,0,.7)';
        context.shadowBlur = Math.max(2, fontSize * 0.12);
        const lineHeight = fontSize * 1.2;
        const contentHeight = wrapped.length * lineHeight;
        const centerY = overlay.position === 'top'
          ? canvas.height * 0.14 + contentHeight / 2
          : overlay.position === 'bottom'
            ? canvas.height * 0.86 - contentHeight / 2
            : canvas.height / 2;
        if (overlay.kind === 'caption') {
          const boxWidth = Math.min(maxWidth, Math.max(...wrapped.map((line) => context.measureText(line).width)) + fontSize);
          context.shadowBlur = 0;
          context.fillStyle = 'rgba(0,0,0,.66)';
          context.fillRect((canvas.width - boxWidth) / 2, centerY - contentHeight / 2 - fontSize * 0.2, boxWidth, contentHeight + fontSize * 0.4);
        }
        const outlineWidth = (overlay.outlineWidth ?? 0) * canvas.width / 1080;
        if (outlineWidth > 0) {
          context.strokeStyle = overlay.outlineColor ?? '#111111';
          context.lineWidth = outlineWidth * 2;
          context.lineJoin = 'round';
          wrapped.forEach((line, index) => context.strokeText(line, canvas.width / 2, centerY - contentHeight / 2 + lineHeight * (index + 0.5), maxWidth));
        }
        context.fillStyle = overlay.color;
        wrapped.forEach((line, index) => context.fillText(line, canvas.width / 2, centerY - contentHeight / 2 + lineHeight * (index + 0.5), maxWidth));
        context.restore();
      }
    };

    recorder.start(1000);
    const startTime = performance.now();
    let lastProgressUpdate = 0;
    onProgress(0);
    let active = new Set<HTMLMediaElement>();
    while (true) {
      if (signal.aborted) throw new DOMException('Export cancelled.', 'AbortError');
      const frameStart = performance.now();
      const time = Math.min(plan.duration, (frameStart - startTime) / 1000);
      const nextActive = new Set<HTMLMediaElement>();
      for (const item of audioItems) {
        const media = playback.get(item);
        if (!media) continue;
        const activeAtTime = time >= item.clip.start && time < item.clip.start + item.clip.duration;
        const gain = gainNodes.get(item);
        if (gain && audioContext) {
          gain.gain.setTargetAtTime(activeAtTime ? audioGainAt(item.clip, item.track, time) : 0, audioContext.currentTime, 0.015);
        }
        if (!activeAtTime) continue;
        nextActive.add(media);
        if (!active.has(media)) {
          media.playbackRate = item.clip.speed ?? 1;
          await waitForSeek(media, clipSourceTimeAt(item.clip, time));
          try {
            await media.play();
          } catch (error) {
            throw new Error(`Could not play "${item.asset.name}" during export: ${(error as Error).message}`);
          }
        }
      }
      for (const media of active) if (!nextActive.has(media)) media.pause();
      active = nextActive;
      drawFrame(time);
      if (time - lastProgressUpdate >= 0.2) {
        onProgress(Math.min(1, time / plan.duration));
        lastProgressUpdate = time;
      }
      if (time >= plan.duration) break;
      const delay = Math.max(0, 1000 / plan.fps - (performance.now() - frameStart));
      await new Promise<void>((resolve) => window.setTimeout(resolve, delay));
    }
    onProgress(1);
    const completed = stopped;
    recorder.stop();
    const blob = await completed;
    if (!blob.size) throw new Error('The browser produced an empty video export.');
    return blob;
  } finally {
    if (recorder?.state === 'recording') recorder.stop();
    for (const media of mediaElements) {
      media.pause();
      media.removeAttribute('src');
      media.load();
    }
    outputStream?.getTracks().forEach((track) => track.stop());
    if (audioContext && audioContext.state !== 'closed') await audioContext.close();
    for (const url of objectUrls) URL.revokeObjectURL(url);
  }
}
