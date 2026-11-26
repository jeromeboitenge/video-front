import { useCallback, useEffect, useRef, useState } from 'react';
import { Cloud, Download, Trash2, X } from 'lucide-react';
import { cancelRenderJob, createRenderJob, deleteRenderJob, downloadRenderJob, listRenderJobs, uploadCloudMedia, type CloudProject, type RenderFormat, type RenderJob, type RenderKind, type RenderRequest } from './api';
import { readMedia } from './mediaStore';
import type { ProjectDocument } from './model';

const FORMAT_OPTIONS: { value: `${RenderKind}:${RenderFormat}`; label: string }[] = [
  { value: 'video:mp4', label: 'Video · MP4 (H.264 + AAC)' },
  { value: 'video:webm', label: 'Video · WebM (VP9 + Opus)' },
  { value: 'video:gif', label: 'Animated GIF (no audio, ≤15 fps)' },
  { value: 'frame:png', label: 'Still frame at playhead · PNG' },
  { value: 'frame:jpeg', label: 'Still frame at playhead · JPEG' },
  { value: 'image:png', label: 'Image · PNG' },
  { value: 'image:jpeg', label: 'Image · JPEG' },
  { value: 'image:webp', label: 'Image · WebP' },
  { value: 'audio:m4a', label: 'Audio only · M4A (AAC)' },
  { value: 'audio:wav', label: 'Audio only · WAV' },
];
type Choice = (typeof FORMAT_OPTIONS)[number]['value'];
type Preset = { id: string; label: string; choice: Choice; quality: NonNullable<RenderRequest['quality']>; box?: [number, number]; resolution?: number; aspect?: [number, number]; fps?: number };
/** One-click export settings. `box` is the maximum output size; `aspect` is the platform's expected frame shape. */
export const EXPORT_PRESETS: Preset[] = [
  { id: 'vertical', label: 'TikTok · Reels · Shorts — 1080×1920 MP4', choice: 'video:mp4', quality: 'high', box: [1080, 1920], aspect: [9, 16] },
  { id: 'youtube', label: 'YouTube 1080p — 1920×1080 MP4', choice: 'video:mp4', quality: 'high', box: [1920, 1080], aspect: [16, 9] },
  { id: 'square', label: 'Instagram square — 1080×1080 MP4', choice: 'video:mp4', quality: 'high', box: [1080, 1080], aspect: [1, 1] },
  { id: 'portrait', label: 'Instagram portrait 4:5 — 1080×1350 MP4', choice: 'video:mp4', quality: 'high', box: [1080, 1350], aspect: [4, 5] },
  { id: 'gif', label: 'Animated GIF — 480 px, 15 fps', choice: 'video:gif', quality: 'standard', box: [480, 480], fps: 15 },
  { id: 'thumbnail', label: 'Thumbnail at playhead — 1280 px JPEG', choice: 'frame:jpeg', quality: 'high', box: [1280, 1280] },
  { id: 'draft', label: 'Quick draft — 50% MP4', choice: 'video:mp4', quality: 'draft', resolution: 0.5 },
];

/** Output scale for a preset: fit inside its box, never upscale, and stay within the API's 25–100% range. */
export function presetResolution(preset: Preset, width: number, height: number): number {
  if (preset.resolution) return preset.resolution;
  if (!preset.box) return 1;
  const scale = Math.min(1, preset.box[0] / width, preset.box[1] / height);
  return Math.max(0.25, Math.round(scale * 1000) / 1000);
}

export function presetAspectWarning(preset: Preset, width: number, height: number): string {
  if (!preset.aspect) return '';
  const expected = preset.aspect[0] / preset.aspect[1];
  if (Math.abs(width / height - expected) < 0.01) return '';
  return `Your canvas is ${width}×${height}; this platform expects ${preset.aspect[0]}:${preset.aspect[1]}. Change the canvas size in the inspector, or the platform will letterbox or crop it.`;
}

const STATUS_LABEL: Record<RenderJob['status'], string> = { queued: 'Queued', running: 'Rendering', completed: 'Ready', failed: 'Failed', cancelled: 'Cancelled' };

type Props = {
  project: ProjectDocument;
  signedIn: boolean;
  cloudProjectId?: string;
  /** Current playhead (seconds), used for still-frame exports. */
  playhead?: number;
  selectedImageAssetId?: string;
  /** Saves the document to the account (creating the account project if needed) and returns the saved project. */
  saveToCloud: (document: ProjectDocument) => Promise<CloudProject>;
  /** Replaces the editor document (used after local-only media is uploaded and linked). */
  onProjectChange: (document: ProjectDocument) => void;
  onDownload: (blob: Blob, filename: string) => void;
};

/** Assets a server render needs, mirroring the backend's asset requirements. */
function requiredAssetIds(project: ProjectDocument, kind: RenderKind, assetId?: string, visualOnlyVideo = false): string[] {
  if (kind === 'image') {
    if (project.imageLayers.length) return project.imageLayers.filter((layer) => layer.visible && (layer.type ?? 'image') === 'image' && layer.assetId).map((layer) => layer.assetId!);
    return assetId ? [assetId] : [];
  }
  const tracks = new Map(project.tracks.map((track) => [track.id, track]));
  const assets = new Map(project.assets.map((asset) => [asset.id, asset]));
  const visualOnly = kind === 'frame' || visualOnlyVideo;
  return project.clips.filter((clip) => {
    const track = tracks.get(clip.trackId);
    const asset = assets.get(clip.assetId);
    if (!track || !asset) return false;
    if (kind === 'audio') return (track.kind === 'audio' && asset.kind !== 'image') || (track.kind === 'video' && !track.hidden && asset.kind === 'video');
    if (visualOnly) return track.kind === 'video' && !track.hidden && asset.kind !== 'audio';
    return (track.kind === 'video' && !track.hidden && asset.kind !== 'audio') || (track.kind === 'audio' && asset.kind !== 'image');
  }).map((clip) => clip.assetId);
}

export function ServerExportPanel({ project, signedIn, cloudProjectId, playhead = 0, selectedImageAssetId, saveToCloud, onProjectChange, onDownload }: Props) {
  const [presetId, setPresetId] = useState('custom');
  const [choice, setChoice] = useState<Choice>('video:mp4');
  const [fps, setFps] = useState<number | undefined>(undefined);
  const [resolution, setResolution] = useState(1);
  const [quality, setQuality] = useState<NonNullable<RenderRequest['quality']>>('standard');
  const [includeAudio, setIncludeAudio] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [jobs, setJobs] = useState<RenderJob[]>([]);
  const [projectId, setProjectId] = useState('');
  const pollTimer = useRef<number | null>(null);
  const [kind, format] = choice.split(':') as [RenderKind, RenderFormat];
  const preset = EXPORT_PRESETS.find((item) => item.id === presetId);
  const aspectWarning = preset ? presetAspectWarning(preset, project.canvas.width, project.canvas.height) : '';
  const outputWidth = Math.round(project.canvas.width * resolution / 2) * 2;
  const outputHeight = Math.round(project.canvas.height * resolution / 2) * 2;
  const resolutionChoices = [...new Set([1, 0.75, 0.5, 0.25, resolution])].sort((a, b) => b - a);
  function applyPreset(id: string) {
    setPresetId(id);
    const next = EXPORT_PRESETS.find((item) => item.id === id);
    if (!next) { setFps(undefined); return; }
    setChoice(next.choice);
    setQuality(next.quality);
    setResolution(presetResolution(next, project.canvas.width, project.canvas.height));
    setFps(next.fps);
  }
  const active = jobs.some((job) => job.status === 'queued' || job.status === 'running');

  const refresh = useCallback(async (id: string) => {
    try { setJobs(await listRenderJobs(id)); } catch (caught) { setError((caught as Error).message); }
  }, []);

  useEffect(() => {
    if (!signedIn || !cloudProjectId) return;
    setProjectId(cloudProjectId);
    void refresh(cloudProjectId);
  }, [signedIn, cloudProjectId, refresh]);

  useEffect(() => {
    if (!active || !projectId) return;
    pollTimer.current = window.setTimeout(() => void refresh(projectId), 1000);
    return () => { if (pollTimer.current) window.clearTimeout(pollTimer.current); };
  }, [active, jobs, projectId, refresh]);

  async function startRender() {
    setError('');
    try {
      // 1. Upload any media that only exists in this browser, so the server can read it.
      let document = project;
      const needed = new Set(requiredAssetIds(project, kind, selectedImageAssetId, format === 'gif' || !includeAudio));
      if (kind === 'frame' && !needed.size && !project.textOverlays.length) throw new Error('Add a clip, title, or caption to the timeline before exporting a frame.');
      if (kind === 'image' && !needed.size && !project.imageLayers.length) throw new Error('Select an image in Media or add image-editor layers before exporting an image.');
      const localOnly = project.assets.filter((asset) => needed.has(asset.id) && !asset.cloudId);
      if (localOnly.length) {
        const links: Record<string, string> = {};
        for (const [index, asset] of localOnly.entries()) {
          setBusy(`Uploading media ${index + 1} of ${localOnly.length}…`);
          const blob = await readMedia(asset.id);
          if (!blob) throw new Error(`"${asset.name}" is not stored on this device. Reimport it before rendering.`);
          links[asset.id] = (await uploadCloudMedia(new File([blob], asset.name, { type: asset.mimeType }))).id;
        }
        document = { ...project, assets: project.assets.map((asset) => links[asset.id] ? { ...asset, cloudId: links[asset.id] } : asset) };
        onProjectChange(document);
      }
      // 2. Save the exact document being rendered.
      setBusy('Saving project…');
      const saved = await saveToCloud(document);
      setProjectId(saved.id);
      // 3. Queue the render job; progress is polled from the server.
      setBusy('Queuing render…');
      const request: RenderRequest = { kind, format, resolution, quality, include_audio: includeAudio && format !== 'gif' };
      if (fps && kind === 'video') request.fps = Math.min(fps, project.canvas.fps);
      if (kind === 'frame') request.time = Math.round(playhead * 1000) / 1000;
      if (kind === 'image' && !project.imageLayers.length && selectedImageAssetId) request.asset_id = selectedImageAssetId;
      if (kind === 'image' && format === 'jpeg') request.background = 'canvas';
      const job = await createRenderJob(saved.id, request);
      setJobs((current) => [job, ...current.filter((item) => item.id !== job.id)]);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy('');
    }
  }

  async function download(job: RenderJob) {
    setError('');
    try { onDownload(await downloadRenderJob(job.id), job.output_name ?? `export.${job.output_format}`); }
    catch (caught) { setError((caught as Error).message); }
  }

  async function cancel(job: RenderJob) {
    try { const updated = await cancelRenderJob(job.id); setJobs((current) => current.map((item) => item.id === job.id ? updated : item)); }
    catch (caught) { setError((caught as Error).message); }
  }

  async function remove(job: RenderJob) {
    try { await deleteRenderJob(job.id); setJobs((current) => current.filter((item) => item.id !== job.id)); }
    catch (caught) { setError((caught as Error).message); }
  }

  if (!signedIn) return <section className="server-export" aria-label="Server render"><div className="server-export-head"><Cloud size={14}/><strong>Server render (MP4, PNG, audio)</strong></div><p className="export-note">Sign in from the account menu to render MP4/WebM video, images, and audio with FFmpeg on the server.</p></section>;

  return <section className="server-export" aria-label="Server render">
    <div className="server-export-head"><Cloud size={14}/><strong>Server render</strong><small>FFmpeg · runs in the background</small></div>
    <label className="server-export-preset">Preset<select aria-label="Export preset" value={presetId} onChange={(event) => applyPreset(event.target.value)}>
      <option value="custom">Custom settings</option>
      {EXPORT_PRESETS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
    </select></label>
    {aspectWarning && <p className="server-export-warning" role="note">{aspectWarning}</p>}
    <div className="server-export-grid">
      <label>Format<select aria-label="Server export format" value={choice} onChange={(event) => { setPresetId('custom'); setChoice(event.target.value as Choice); }}>{FORMAT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
      <label>Resolution<select aria-label="Server export resolution" value={resolution} onChange={(event) => { setPresetId('custom'); setResolution(Number(event.target.value)); }}>
        {resolutionChoices.map((value) => <option key={value} value={value}>{Math.round(value * 100)}% · {Math.round(project.canvas.width * value)}×{Math.round(project.canvas.height * value)}</option>)}
      </select></label>
      <label>Quality<select aria-label="Server export quality" value={quality} onChange={(event) => { setPresetId('custom'); setQuality(event.target.value as typeof quality); }}><option value="high">High</option><option value="standard">Standard</option><option value="draft">Draft (fast)</option></select></label>
      {kind === 'video' && format !== 'gif' && <label className="server-export-check"><input type="checkbox" checked={includeAudio} onChange={(event) => setIncludeAudio(event.target.checked)}/> Include audio</label>}
    </div>
    <p className="server-export-summary">Output {kind === 'audio' ? 'audio only' : `${outputWidth}×${outputHeight}`}{kind === 'video' ? ` · ${Math.min(fps ?? project.canvas.fps, format === 'gif' ? 15 : 120, project.canvas.fps)} fps` : ''}{kind === 'frame' ? ` · frame at ${playhead.toFixed(2)} s` : ''}</p>
    <button className="modal-submit" disabled={!!busy} onClick={() => void startRender()}>{busy || (kind === 'frame' ? `Export ${format.toUpperCase()} frame on server` : `Render ${format.toUpperCase()} on server`)}</button>
    {error && <p className="export-error" role="alert">{error}</p>}
    {jobs.length > 0 && <ul className="server-export-jobs" aria-label="Server exports">
      {jobs.map((job) => <li key={job.id} className={`server-export-job ${job.status}`}>
        <div><strong>{job.output_format.toUpperCase()}</strong><span>{STATUS_LABEL[job.status]}{job.status === 'running' ? ` · ${Math.round(job.progress * 100)}%` : ''}{job.status === 'completed' && job.output_size ? ` · ${(job.output_size / 1048576).toFixed(2)} MB` : ''}</span></div>
        {(job.status === 'running' || job.status === 'queued') && <div className="export-progress-bar" role="progressbar" aria-valuenow={Math.round(job.progress * 100)} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${Math.round(job.progress * 100)}%` }}/></div>}
        {job.status === 'failed' && <p className="export-error">{job.error}</p>}
        <div className="server-export-actions">
          {job.status === 'completed' && <button aria-label={`Download ${job.output_name ?? job.output_format}`} onClick={() => void download(job)}><Download size={13}/>Download</button>}
          {(job.status === 'running' || job.status === 'queued') && <button aria-label="Cancel server render" onClick={() => void cancel(job)}><X size={13}/>Cancel</button>}
          {job.status !== 'running' && job.status !== 'queued' && <button aria-label={`Delete export ${job.id}`} onClick={() => void remove(job)}><Trash2 size={13}/></button>}
        </div>
      </li>)}
    </ul>}
  </section>;
}
