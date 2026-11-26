import { useCallback, useEffect, useRef, useState } from 'react';
import { Cloud, Download, Trash2, X } from 'lucide-react';
import { cancelRenderJob, createRenderJob, deleteRenderJob, downloadRenderJob, listRenderJobs, uploadCloudMedia, type CloudProject, type RenderFormat, type RenderJob, type RenderKind, type RenderRequest } from './api';
import { readMedia } from './mediaStore';
import type { ProjectDocument } from './model';

const FORMAT_OPTIONS: { value: `${RenderKind}:${RenderFormat}`; label: string }[] = [
  { value: 'video:mp4', label: 'Video · MP4 (H.264 + AAC)' },
  { value: 'video:webm', label: 'Video · WebM (VP9 + Opus)' },
  { value: 'image:png', label: 'Image · PNG' },
  { value: 'image:jpeg', label: 'Image · JPEG' },
  { value: 'image:webp', label: 'Image · WebP' },
  { value: 'audio:m4a', label: 'Audio only · M4A (AAC)' },
  { value: 'audio:wav', label: 'Audio only · WAV' },
];
const STATUS_LABEL: Record<RenderJob['status'], string> = { queued: 'Queued', running: 'Rendering', completed: 'Ready', failed: 'Failed', cancelled: 'Cancelled' };

type Props = {
  project: ProjectDocument;
  signedIn: boolean;
  cloudProjectId?: string;
  selectedImageAssetId?: string;
  /** Saves the document to the account (creating the account project if needed) and returns the saved project. */
  saveToCloud: (document: ProjectDocument) => Promise<CloudProject>;
  /** Replaces the editor document (used after local-only media is uploaded and linked). */
  onProjectChange: (document: ProjectDocument) => void;
  onDownload: (blob: Blob, filename: string) => void;
};

/** Assets a server render needs, mirroring the backend's asset requirements. */
function requiredAssetIds(project: ProjectDocument, kind: RenderKind, assetId?: string): string[] {
  if (kind === 'image') {
    if (project.imageLayers.length) return project.imageLayers.filter((layer) => layer.visible && (layer.type ?? 'image') === 'image' && layer.assetId).map((layer) => layer.assetId!);
    return assetId ? [assetId] : [];
  }
  const tracks = new Map(project.tracks.map((track) => [track.id, track]));
  const assets = new Map(project.assets.map((asset) => [asset.id, asset]));
  return project.clips.filter((clip) => {
    const track = tracks.get(clip.trackId);
    const asset = assets.get(clip.assetId);
    if (!track || !asset) return false;
    if (kind === 'audio') return (track.kind === 'audio' && asset.kind !== 'image') || (track.kind === 'video' && !track.hidden && asset.kind === 'video');
    return (track.kind === 'video' && !track.hidden && asset.kind !== 'audio') || (track.kind === 'audio' && asset.kind !== 'image');
  }).map((clip) => clip.assetId);
}

export function ServerExportPanel({ project, signedIn, cloudProjectId, selectedImageAssetId, saveToCloud, onProjectChange, onDownload }: Props) {
  const [choice, setChoice] = useState<(typeof FORMAT_OPTIONS)[number]['value']>('video:mp4');
  const [resolution, setResolution] = useState(1);
  const [quality, setQuality] = useState<NonNullable<RenderRequest['quality']>>('standard');
  const [includeAudio, setIncludeAudio] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [jobs, setJobs] = useState<RenderJob[]>([]);
  const [projectId, setProjectId] = useState('');
  const pollTimer = useRef<number | null>(null);
  const [kind, format] = choice.split(':') as [RenderKind, RenderFormat];
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
      const needed = new Set(requiredAssetIds(project, kind, selectedImageAssetId));
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
      const request: RenderRequest = { kind, format, resolution, quality, include_audio: includeAudio };
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
    <div className="server-export-grid">
      <label>Format<select aria-label="Server export format" value={choice} onChange={(event) => setChoice(event.target.value as typeof choice)}>{FORMAT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
      <label>Resolution<select aria-label="Server export resolution" value={resolution} onChange={(event) => setResolution(Number(event.target.value))}>
        {[1, 0.75, 0.5, 0.25].map((value) => <option key={value} value={value}>{Math.round(value * 100)}% · {Math.round(project.canvas.width * value)}×{Math.round(project.canvas.height * value)}</option>)}
      </select></label>
      <label>Quality<select aria-label="Server export quality" value={quality} onChange={(event) => setQuality(event.target.value as typeof quality)}><option value="high">High</option><option value="standard">Standard</option><option value="draft">Draft (fast)</option></select></label>
      {kind === 'video' && <label className="server-export-check"><input type="checkbox" checked={includeAudio} onChange={(event) => setIncludeAudio(event.target.checked)}/> Include audio</label>}
    </div>
    <button className="modal-submit" disabled={!!busy} onClick={() => void startRender()}>{busy || `Render ${format.toUpperCase()} on server`}</button>
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
