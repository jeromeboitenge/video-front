import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { AudioLines, Captions, ChevronDown, CircleHelp, Clapperboard, Cloud, Command, Copy, Download, Film, FolderOpen, Frame, Gauge, Image, Layers3, LockKeyhole, Maximize2, MoreHorizontal, Music2, PanelLeftClose, Pause, Play, Plus, Redo2, Scissors, Settings2, Shapes, Sparkles, Square, Trash2, Type, Undo2, Upload, Volume2, WandSparkles, ZoomIn, ZoomOut } from 'lucide-react';
import { clipOpacityAt, clipTransformStyle, clipVisualOpacityAt, formatTime, makeProject, parseProjectDocument, type MediaAsset, type ProjectDocument, type TextOverlay, type TimelineClip, type ToolId } from './model';
import { effectRegistry, effectStyle, type AppliedEffect, type EffectId } from './effects';
import { audioGainAt, renderProjectVideo } from './export';
import { authenticate, getCloudMediaContent, getCloudProject, listCloudProjects, saveCloudProject, uploadCloudMedia, type CloudProject } from './api';
import { readMedia, storeMedia } from './mediaStore';
import { CreativeToolsPanel } from './CreativeToolsPanel';
import './export.css';

const tools: { id: ToolId; label: string; icon: typeof Film }[] = [
  { id: 'media', label: 'Media', icon: Film }, { id: 'audio', label: 'Audio', icon: AudioLines }, { id: 'text', label: 'Text', icon: Type },
  { id: 'captions', label: 'Captions', icon: Captions }, { id: 'elements', label: 'Elements', icon: Shapes }, { id: 'effects', label: 'Effects', icon: Sparkles },
  { id: 'transitions', label: 'Transitions', icon: Layers3 }, { id: 'ai', label: 'AI studio', icon: WandSparkles },
];
const cloudProjectKey = (userId: string, localProjectId: string) => `frameforge:cloud-project:${userId}:${localProjectId}`;

type TimelinePreviewItem = {
  clip: TimelineClip;
  asset: MediaAsset;
  track: ProjectDocument['tracks'][number];
  trackIndex: number;
};

type TimelineDrag = {
  clipId: string;
  mode: 'move' | 'trim-start' | 'trim-end';
  originX: number;
  secondsPerPixel: number;
  fps: number;
  originalClip: TimelineClip;
  originalProject: ProjectDocument;
  changed: boolean;
};

function TimelineComposition({ items, mediaUrls, effects, overlays, playhead, onMediaElement, onMediaMetadata }: {
  items: TimelinePreviewItem[];
  mediaUrls: Record<string, string>;
  effects: AppliedEffect[];
  overlays: TextOverlay[];
  playhead: number;
  onMediaElement: (clipId: string, element: HTMLMediaElement | null) => void;
  onMediaMetadata: (clipId: string, duration: number) => void;
}) {
  const visuals = items.filter(({ asset, track }) => track.kind === 'video' && !track.hidden && asset.kind !== 'audio');
  return <div className="timeline-composition" data-testid="timeline-composition">
    {visuals.map(({ clip, asset }) => {
      const url = mediaUrls[asset.id];
      const style = effectStyle(effects, asset.id);
      return <div className="timeline-composition-layer" key={clip.id} data-clip-id={clip.id} aria-label={asset.name} style={{ opacity: clipVisualOpacityAt(clip, playhead) }}>
        {url && asset.kind === 'video' && <video ref={(element) => onMediaElement(clip.id, element)} src={url} style={{ filter: style.filter, transform: clipTransformStyle(clip) }} playsInline preload="auto" muted onLoadedMetadata={(event) => onMediaMetadata(clip.id, event.currentTarget.duration)}/>}
        {url && asset.kind === 'image' && <img src={url} alt={asset.name} style={{ filter: style.filter, transform: clipTransformStyle(clip) }}/>}
        {!url && <div className="timeline-media-unavailable">{asset.name}</div>}
        {style.vignette > 0 && <span className="timeline-media-vignette" style={{ background: `radial-gradient(ellipse at center, transparent 38%, rgba(0,0,0,${style.vignette * 0.78}) 100%)` }}/>}
      </div>;
    })}
    {!visuals.length && <div className="timeline-composition-empty">No visual clip at this time</div>}
    {overlays.filter((overlay) => playhead >= overlay.start && playhead < overlay.start + overlay.duration).map((overlay) => <div key={overlay.id} className={`timeline-text-overlay ${overlay.kind} position-${overlay.position}`} style={{ color: overlay.color, fontSize: `${Math.max(12, overlay.fontSize * 0.28)}px` }}>{overlay.text}</div>)}
    {items.filter(({ track, asset }) => track.kind === 'audio' && (asset.kind === 'audio' || asset.kind === 'video')).map(({ clip, asset }) => {
      const url = mediaUrls[asset.id];
      return url ? <audio key={clip.id} ref={(element) => onMediaElement(clip.id, element)} src={url} preload="auto" onLoadedMetadata={(event) => onMediaMetadata(clip.id, event.currentTarget.duration)}/> : null;
    })}
  </div>;
}

export default function App() {
  const [project, setProject] = useState<ProjectDocument>(() => {
    try {
      const previous = localStorage.getItem('frameforge:last-project');
      if (!previous) return makeProject();
      return parseProjectDocument(JSON.parse(previous));
    } catch { return makeProject(); }
  });
  const [activeTool, setActiveTool] = useState<ToolId>('media');
  const [playing, setPlaying] = useState(false);
  const [playhead, setPlayhead] = useState(0);
  const [previewMode, setPreviewMode] = useState<'asset' | 'timeline'>(() => project.clips.length ? 'timeline' : 'asset');
  const [previewMuted, setPreviewMuted] = useState(false);
  const [canvasZoom, setCanvasZoom] = useState(1);
  const [timelineZoom, setTimelineZoom] = useState(1);
  const [notice, setNotice] = useState('');
  const [mediaUrls, setMediaUrls] = useState<Record<string, string>>({});
  const [loadingAssetId, setLoadingAssetId] = useState<string | null>(null);
  const [importingMedia, setImportingMedia] = useState(false);
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [accountOpen, setAccountOpen] = useState(false);
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [currentUser, setCurrentUser] = useState<{ id: string; email: string } | null>(() => { try { const user = sessionStorage.getItem('frameforge:user'); return user ? JSON.parse(user) : null; } catch { return null; } });
  const [cloudProjectId, setCloudProjectId] = useState(() => {
    try { const user = JSON.parse(sessionStorage.getItem('frameforge:user') ?? 'null') as { id?: string } | null; return user?.id ? localStorage.getItem(cloudProjectKey(user.id, project.project.id)) ?? '' : ''; } catch { return ''; }
  });
  const [cloudProjects, setCloudProjects] = useState<CloudProject[]>([]);
  const [cloudProjectsLoading, setCloudProjectsLoading] = useState(false);
  const [cloudProjectsError, setCloudProjectsError] = useState('');
  const [openingCloudProjectId, setOpeningCloudProjectId] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState('');
  const [exportOpen, setExportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportError, setExportError] = useState('');
  const [localProjects, setLocalProjects] = useState<{ id: string; name: string; updatedAt: string }[]>(() => { try { return JSON.parse(localStorage.getItem('frameforge:projects-index') ?? '[]'); } catch { return []; } });
  const fileRef = useRef<HTMLInputElement>(null);
  const mediaUrlMap = useRef<Record<string, string>>({});
  const timelineMediaRefs = useRef(new Map<string, HTMLMediaElement>());
  const playheadRef = useRef(playhead);
  const undoStack = useRef<ProjectDocument[]>([]);
  const redoStack = useRef<ProjectDocument[]>([]);
  const timelineDrag = useRef<TimelineDrag | null>(null);
  const exportAbort = useRef<AbortController | null>(null);
  const [saved, setSaved] = useState(true);
  const lastClipEnd = Math.max(
    project.clips.reduce((end, clip) => Math.max(end, clip.start + clip.duration), 0),
    project.textOverlays.reduce((end, overlay) => Math.max(end, overlay.start + overlay.duration), 0),
  );
  const duration = Math.max(24, Math.ceil(lastClipEnd / 12) * 12);
  const selectedAsset = project.assets.find((asset) => asset.id === selectedAssetId);
  const selectedClip = project.clips.find((clip) => clip.id === selectedClipId);
  const selectedClipTrack = project.tracks.find((track) => track.id === selectedClip?.trackId);
  const sequenceDuration = lastClipEnd;
  const activeTimelineItems = useMemo(() => {
    const assets = new Map(project.assets.map((asset) => [asset.id, asset]));
    const tracks = new Map(project.tracks.map((track, trackIndex) => [track.id, { track, trackIndex }]));
    return project.clips.flatMap((clip) => {
      const asset = assets.get(clip.assetId);
      const trackEntry = tracks.get(clip.trackId);
      if (!asset || !trackEntry || playhead < clip.start || playhead >= clip.start + clip.duration) return [];
      return [{ clip, asset, ...trackEntry }];
    }).sort((a, b) => a.trackIndex - b.trackIndex || a.clip.start - b.clip.start);
  }, [project.assets, project.clips, project.tracks, playhead]);
  const activeTimelineKey = activeTimelineItems.map(({ clip, track }) => `${clip.id}:${track.muted}:${track.hidden}:${clip.volume ?? 1}:${clip.transitionIn ?? 0}:${clip.transitionOut ?? 0}`).join('|');
  const selectedEffects = project.effects.filter((effect) => effect.assetId === selectedAssetId);
  const previewEffect = selectedAsset ? effectStyle(project.effects, selectedAsset.id) : { vignette: 0 };
  const activeToolInfo = tools.find((tool) => tool.id === activeTool)!;
  const rulerMarks = useMemo(() => Array.from({ length: duration / 2 + 1 }, (_, i) => i * 2), [duration]);
  const setTimelineMediaElement = useCallback((clipId: string, element: HTMLMediaElement | null) => {
    if (element) timelineMediaRefs.current.set(clipId, element);
    else timelineMediaRefs.current.delete(clipId);
  }, []);

  useEffect(() => { playheadRef.current = playhead; }, [playhead]);

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      const drag = timelineDrag.current;
      if (!drag) return;
      const frame = 1 / drag.fps;
      const delta = Math.round((event.clientX - drag.originX) * drag.secondsPerPixel * drag.fps) / drag.fps;
      const clip = drag.originalClip;
      const asset = drag.originalProject.assets.find((item) => item.id === clip.assetId);
      const targetLane = [...document.querySelectorAll<HTMLElement>('.track-lane')].find((lane) => {
        const bounds = lane.getBoundingClientRect();
        return event.clientY >= bounds.top && event.clientY < bounds.bottom;
      });
      const targetTrack = drag.mode === 'move' && targetLane?.dataset.trackId
        ? drag.originalProject.tracks.find((track) => track.id === targetLane.dataset.trackId)
        : undefined;
      const canMoveToTrack = !!asset && !!targetTrack && !targetTrack.locked &&
        ((asset.kind === 'video' && (targetTrack.kind === 'video' || targetTrack.kind === 'audio')) ||
          (asset.kind === 'image' && targetTrack.kind === 'video') ||
          (asset.kind === 'audio' && targetTrack.kind === 'audio'));
      let updated: TimelineClip;
      if (drag.mode === 'move') {
        updated = {
          ...clip,
          trackId: canMoveToTrack ? targetTrack.id : clip.trackId,
          start: Math.max(0, Math.round((clip.start + delta) * drag.fps) / drag.fps),
        };
      } else if (drag.mode === 'trim-start') {
        const trim = Math.max(-clip.sourceOffset, Math.min(clip.duration - frame, delta));
        const duration = clip.duration - trim;
        updated = {
          ...clip,
          start: clip.start + trim,
          duration,
          sourceOffset: clip.sourceOffset + trim,
          transitionIn: Math.min(clip.transitionIn ?? 0, duration / 2) || undefined,
          transitionOut: Math.min(clip.transitionOut ?? 0, duration / 2) || undefined,
        };
      } else {
        const duration = Math.max(frame, clip.duration + delta);
        updated = {
          ...clip,
          duration,
          transitionIn: Math.min(clip.transitionIn ?? 0, duration / 2) || undefined,
          transitionOut: Math.min(clip.transitionOut ?? 0, duration / 2) || undefined,
        };
      }
      if (updated.trackId === clip.trackId && updated.start === clip.start && updated.duration === clip.duration && updated.sourceOffset === clip.sourceOffset) return;
      drag.changed = true;
      setProject({
        ...drag.originalProject,
        clips: drag.originalProject.clips.map((item) => item.id === drag.clipId ? updated : item),
      });
      if (drag.mode !== 'trim-end') setPlayhead(updated.start);
    };
    const onPointerUp = () => {
      const drag = timelineDrag.current;
      if (!drag) return;
      if (drag.changed) {
        undoStack.current.push(drag.originalProject);
        redoStack.current = [];
        setSaved(false);
      }
      timelineDrag.current = null;
    };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
    };
  }, []);

  useEffect(() => {
    if (!playing || previewMode !== 'timeline') return;
    if (sequenceDuration <= 0) {
      setPlaying(false);
      setNotice('Add a clip to the timeline before starting playback.');
      return;
    }
    const startAt = Math.min(playhead, sequenceDuration);
    let startedAt: number | undefined;
    let frame = 0;
    const tick = (now: number) => {
      startedAt ??= now;
      const time = Math.min(sequenceDuration, startAt + (now - startedAt) / 1000);
      setPlayhead(time);
      if (time >= sequenceDuration) {
        setPlaying(false);
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, previewMode, sequenceDuration]);

  useEffect(() => {
    const active = new Map(activeTimelineItems.map((item) => [item.clip.id, item]));
    const listeners: Array<{ media: HTMLMediaElement; listener: () => void }> = [];
    for (const [clipId, media] of timelineMediaRefs.current) {
      const item = active.get(clipId);
      if (!item || previewMode !== 'timeline') {
        media.pause();
        continue;
      }
      const synchronize = () => {
        const sourceTime = item.clip.sourceOffset + Math.max(0, playheadRef.current - item.clip.start);
        if (Number.isFinite(media.duration) && Math.abs(media.currentTime - sourceTime) > (playing ? 0.75 : 0.04)) {
          media.currentTime = Math.min(sourceTime, Number.isFinite(media.duration) ? media.duration : sourceTime);
        }
        media.muted = previewMuted || item.track.muted;
        media.volume = audioGainAt(item.clip, item.track, playheadRef.current);
        if (playing) {
          void media.play().catch((error: Error) => {
            setPlaying(false);
            setNotice(`Could not play "${item.asset.name}": ${error.message}`);
          });
        } else {
          media.pause();
        }
      };
      if (media.readyState >= HTMLMediaElement.HAVE_METADATA) synchronize();
      else {
        media.addEventListener('loadedmetadata', synchronize, { once: true });
        listeners.push({ media, listener: synchronize });
      }
    }
    return () => listeners.forEach(({ media, listener }) => media.removeEventListener('loadedmetadata', listener));
  }, [activeTimelineKey, mediaUrls, playing, previewMode, previewMuted, playing ? null : playhead]);

  useEffect(() => {
    for (const item of activeTimelineItems) {
      if (item.track.kind !== 'audio' || (item.asset.kind !== 'audio' && item.asset.kind !== 'video')) continue;
      const media = timelineMediaRefs.current.get(item.clip.id);
      if (media) media.volume = audioGainAt(item.clip, item.track, playhead);
    }
  }, [activeTimelineItems, playhead]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      localStorage.setItem('frameforge:last-project', JSON.stringify(project));
      localStorage.setItem(`frameforge:${project.project.id}`, JSON.stringify(project));
      const nextIndex = [{ id: project.project.id, name: project.project.name, updatedAt: new Date().toISOString() }, ...localProjects.filter((item) => item.id !== project.project.id)];
      setLocalProjects(nextIndex); localStorage.setItem('frameforge:projects-index', JSON.stringify(nextIndex));
      setSaved(true);
    }, 600);
    return () => window.clearTimeout(timer);
  }, [project]);

  useEffect(() => {
    const clippedAssetIds = new Set(project.clips.map((clip) => clip.assetId));
    const neededAssets = project.assets.filter((asset) => asset.id === selectedAssetId || clippedAssetIds.has(asset.id))
      .filter((asset) => !mediaUrlMap.current[asset.id]);
    if (!neededAssets.length) {
      setLoadingAssetId(null);
      return;
    }
    let active = true;
    const selectedIsLoading = neededAssets.some((asset) => asset.id === selectedAssetId);
    if (selectedIsLoading && selectedAssetId) setLoadingAssetId(selectedAssetId);
    void Promise.all(neededAssets.map(async (asset) => {
      try {
        const localBlob = await readMedia(asset.id);
        const blob = localBlob ?? (asset.cloudId && sessionStorage.getItem('frameforge:access-token')
          ? await getCloudMediaContent(asset.cloudId)
          : undefined);
        if (!blob) throw new Error('The original file is not available on this device.');
        if (!localBlob) await storeMedia(asset.id, blob);
        return { asset, url: URL.createObjectURL(blob) };
      } catch (error) {
        return { asset, error: (error as Error).message };
      }
    })).then((results) => {
      if (!active) {
        results.forEach((result) => { if ('url' in result && result.url) URL.revokeObjectURL(result.url); });
        return;
      }
      const restored = results.filter((result): result is { asset: MediaAsset; url: string } => 'url' in result);
      for (const result of restored) mediaUrlMap.current[result.asset.id] = result.url;
      if (restored.length) setMediaUrls({ ...mediaUrlMap.current });
      const failures = results.filter((result): result is { asset: MediaAsset; error: string } => 'error' in result);
      if (failures.length) setNotice(failures.map(({ asset, error }) => `"${asset.name}": ${error}`).join(' '));
    }).finally(() => {
      if (active && selectedIsLoading) setLoadingAssetId(null);
    });
    return () => { active = false; };
  }, [selectedAssetId, project.assets, project.clips]);

  useEffect(() => () => { Object.values(mediaUrlMap.current).forEach(URL.revokeObjectURL); }, []);

  useEffect(() => {
    if (!sessionStorage.getItem('frameforge:access-token') || !cloudProjectId) return;
    const timer = window.setTimeout(() => {
      void saveCloudProject(project.project.name, project, cloudProjectId).catch((error: Error) => setNotice(`Cloud save failed: ${error.message}`));
    }, 1400);
    return () => window.clearTimeout(timer);
  }, [project, cloudProjectId]);

  useEffect(() => {
    if (!projectMenuOpen || !currentUser) return;
    let active = true;
    setCloudProjectsLoading(true);
    setCloudProjectsError('');
    void listCloudProjects().then((items) => {
      if (active) setCloudProjects(items);
    }).catch((error: Error) => {
      if (active) setCloudProjectsError(error.message);
    }).finally(() => {
      if (active) setCloudProjectsLoading(false);
    });
    return () => { active = false; };
  }, [projectMenuOpen, currentUser]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); }
      else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') { event.preventDefault(); saveDraft(); }
      else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'd') { event.preventDefault(); duplicateSelectedClip(); }
      else if (event.code === 'Space' && !(event.target instanceof HTMLInputElement) && !(event.target instanceof HTMLTextAreaElement) && !(event.target instanceof HTMLSelectElement)) { event.preventDefault(); togglePlayback(); }
      else if (event.key.toLowerCase() === 's' && !(event.target instanceof HTMLInputElement) && !(event.target instanceof HTMLTextAreaElement) && !(event.target instanceof HTMLSelectElement)) splitSelectedClip();
      else if ((event.key === 'Delete' || event.key === 'Backspace') && !(event.target instanceof HTMLInputElement) && !(event.target instanceof HTMLTextAreaElement) && !(event.target instanceof HTMLSelectElement)) deleteSelectedClip();
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  });

  function commit(next: ProjectDocument) { undoStack.current.push(project); redoStack.current = []; setProject(next); setSaved(false); }
  function undo() { const prior = undoStack.current.pop(); if (prior) { redoStack.current.push(project); setProject(prior); setSaved(false); } }
  function redo() { const next = redoStack.current.pop(); if (next) { undoStack.current.push(project); setProject(next); setSaved(false); } }
  function togglePlayback() {
    if (playing) {
      setPlaying(false);
      return;
    }
    if (sequenceDuration <= 0) {
      setNotice('Add a clip to the timeline before starting playback.');
      return;
    }
    setPreviewMode('timeline');
    if (playhead >= sequenceDuration) setPlayhead(0);
    setPlaying(true);
  }
  function splitSelectedClip() {
    const clip = project.clips.find((item) => item.id === selectedClipId);
    if (!clip || playhead <= clip.start + 0.05 || playhead >= clip.start + clip.duration - 0.05) { setNotice('Place the playhead inside a selected clip to split it.'); return; }
    const firstDuration = playhead - clip.start;
    const secondDuration = clip.duration - firstDuration;
    const first: TimelineClip = { ...clip, duration: firstDuration, transitionIn: Math.min(clip.transitionIn ?? 0, firstDuration / 2), transitionOut: undefined };
    const second: TimelineClip = { ...clip, id: crypto.randomUUID(), start: playhead, duration: secondDuration, sourceOffset: clip.sourceOffset + firstDuration, transitionIn: undefined, transitionOut: Math.min(clip.transitionOut ?? 0, secondDuration / 2) };
    commit({ ...project, clips: project.clips.flatMap((item) => item.id === clip.id ? [first, second] : [item]) });
    setSelectedClipId(second.id); setPreviewMode('timeline'); setNotice('Clip split at the playhead.');
  }
  function deleteSelectedClip() {
    if (!selectedClipId) return;
    commit({ ...project, clips: project.clips.filter((clip) => clip.id !== selectedClipId) }); setSelectedClipId(null); setPreviewMode('timeline'); setPlaying(false); setNotice('Timeline clip removed.');
  }
  function duplicateSelectedClip() {
    const clip = project.clips.find((item) => item.id === selectedClipId);
    if (!clip) return;
    const duplicate = { ...clip, id: crypto.randomUUID(), start: clip.start + clip.duration + 0.15 };
    commit({ ...project, clips: [...project.clips, duplicate] }); setSelectedClipId(duplicate.id); setPreviewMode('timeline'); setPlayhead(duplicate.start); setNotice('Clip duplicated.');
  }
  function updateClipDuration(clipId: string, mediaDuration: number) {
    const clip = project.clips.find((item) => item.id === clipId);
    const asset = clip && project.assets.find((item) => item.id === clip.assetId);
    const defaultDuration = asset?.kind === 'audio' ? 8 : 4;
    if (clip && asset && clip.sourceOffset === 0 && Math.abs(clip.duration - defaultDuration) < 0.01 && Number.isFinite(mediaDuration) && mediaDuration > 0 && Math.abs(clip.duration - mediaDuration) > 0.25) {
      commit({ ...project, clips: project.clips.map((item) => item.id === clip.id ? { ...item, duration: mediaDuration, transitionIn: Math.min(item.transitionIn ?? 0, mediaDuration / 2), transitionOut: Math.min(item.transitionOut ?? 0, mediaDuration / 2) } : item) });
    }
  }
  function addEffect(type: EffectId) {
    if (!selectedAsset) {
      setNotice('Select an image or video in the media library before adding an effect.');
      return;
    }
    if (selectedAsset.kind === 'audio') {
      setNotice('Visual effects can be applied to images and videos, not audio.');
      return;
    }
    if (selectedEffects.some((effect) => effect.type === type)) return;
    const effect: AppliedEffect = { id: crypto.randomUUID(), assetId: selectedAsset.id, type, strength: 50, enabled: true };
    commit({ ...project, effects: [...project.effects, effect] });
    setNotice(`${effectRegistry.find((item) => item.id === type)?.name ?? type} effect added to ${selectedAsset.name}.`);
  }
  function updateEffect(effectId: string, patch: Partial<Pick<AppliedEffect, 'strength' | 'enabled'>>) {
    commit({ ...project, effects: project.effects.map((effect) => effect.id === effectId ? { ...effect, ...patch } : effect) });
  }
  function removeEffect(effectId: string) {
    commit({ ...project, effects: project.effects.filter((effect) => effect.id !== effectId) });
  }
  function addTextOverlays(overlays: TextOverlay[]) {
    if (!overlays.length) return;
    commit({ ...project, textOverlays: [...project.textOverlays, ...overlays] });
    setPreviewMode('timeline');
    setPlayhead(overlays[0].start);
    setNotice(`${overlays.length} ${overlays[0].kind === 'caption' ? 'caption' : 'title'}${overlays.length === 1 ? '' : 's'} added.`);
  }
  function updateTextOverlay(updated: TextOverlay) {
    commit({ ...project, textOverlays: project.textOverlays.map((overlay) => overlay.id === updated.id ? updated : overlay) });
  }
  function removeTextOverlay(id: string) {
    commit({ ...project, textOverlays: project.textOverlays.filter((overlay) => overlay.id !== id) });
  }
  function updateTransition(field: 'transitionIn' | 'transitionOut', value: number) {
    if (!selectedClip) return;
    commit({ ...project, clips: project.clips.map((clip) => clip.id === selectedClip.id ? { ...clip, [field]: value || undefined } : clip) });
  }
  function updateClipVolume(value: number) {
    if (!selectedClip) return;
    commit({ ...project, clips: project.clips.map((clip) => clip.id === selectedClip.id ? { ...clip, volume: value } : clip) });
  }
  function updateVisualTransform(patch: Partial<Pick<TimelineClip, 'x' | 'y' | 'scale' | 'rotation' | 'opacity'>>) {
    if (!selectedClip) return;
    const safePatch: typeof patch = {};
    if (patch.x !== undefined && Number.isFinite(patch.x)) safePatch.x = Math.max(-100000, Math.min(100000, patch.x));
    if (patch.y !== undefined && Number.isFinite(patch.y)) safePatch.y = Math.max(-100000, Math.min(100000, patch.y));
    if (patch.scale !== undefined && Number.isFinite(patch.scale)) safePatch.scale = Math.max(0.1, Math.min(5, patch.scale));
    if (patch.rotation !== undefined && Number.isFinite(patch.rotation)) safePatch.rotation = Math.max(-3600, Math.min(3600, patch.rotation));
    if (patch.opacity !== undefined && Number.isFinite(patch.opacity)) safePatch.opacity = Math.max(0, Math.min(1, patch.opacity));
    if (!Object.keys(safePatch).length) return;
    commit({ ...project, clips: project.clips.map((clip) => clip.id === selectedClip.id ? { ...clip, ...safePatch } : clip) });
  }
  function startTimelineDrag(event: ReactPointerEvent<HTMLButtonElement>, clip: TimelineClip) {
    if (event.button > 0) return;
    const handle = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>('[data-trim-handle]') : null;
    const content = event.currentTarget.closest<HTMLElement>('.timeline-content');
    const bounds = content?.getBoundingClientRect();
    if (!bounds?.width) return;
    event.preventDefault();
    event.stopPropagation();
    const track = project.tracks.find((item) => item.id === clip.trackId);
    if (track?.locked) return;
    const mode = handle?.dataset.trimHandle === 'start'
      ? 'trim-start'
      : handle?.dataset.trimHandle === 'end'
        ? 'trim-end'
        : 'move';
    setPlaying(false);
    setPreviewMode('timeline');
    setSelectedClipId(clip.id);
    setSelectedAssetId(clip.assetId);
    timelineDrag.current = {
      clipId: clip.id,
      mode,
      originX: event.clientX,
      secondsPerPixel: duration / bounds.width,
      fps: project.canvas.fps,
      originalClip: clip,
      originalProject: project,
      changed: false,
    };
  }
  async function importFiles(files: FileList | null) {
    if (!files?.length) return;
    const imports = Array.from(files).filter((file) => file.type.startsWith('video/') || file.type.startsWith('image/') || file.type.startsWith('audio/')).map((file) => ({ file, asset: { id: crypto.randomUUID(), name: file.name, kind: (file.type.startsWith('audio/') ? 'audio' : file.type.startsWith('image/') ? 'image' : 'video') as MediaAsset['kind'], mimeType: file.type, size: file.size } }));
    if (!imports.length) { setNotice('Choose a video, image, or audio file.'); return; }
    setImportingMedia(true);
    try { await Promise.all(imports.map(({ file, asset }) => storeMedia(asset.id, file))); }
    catch (error) { setNotice(`Media could not be saved in browser storage: ${(error as Error).message}`); setImportingMedia(false); return; }
    const uploadErrors: string[] = [];
    const cloudAssets = sessionStorage.getItem('frameforge:access-token')
      ? await Promise.all(imports.map(async ({ file, asset }) => {
        try {
          const remote = await uploadCloudMedia(file);
          return { ...asset, cloudId: remote.id };
        } catch (error) {
          uploadErrors.push(`${asset.name}: ${(error as Error).message}`);
          return asset;
        }
      }))
      : imports.map(({ asset }) => asset);
    const additions = cloudAssets;
    const clips = [...project.clips];
    for (const asset of additions) {
      const track = project.tracks.find((item) => asset.kind === 'audio' ? item.kind === 'audio' : item.kind === 'video');
      if (!track) continue;
      const start = clips.filter((clip) => clip.trackId === track.id).reduce((end, clip) => Math.max(end, clip.start + clip.duration), 0);
      clips.push({ id: crypto.randomUUID(), assetId: asset.id, trackId: track.id, start, duration: asset.kind === 'audio' ? 8 : 4, sourceOffset: 0 });
    }
    if (clips.length > project.clips.length) {
      const selectedClip = clips[project.clips.length];
      setSelectedClipId(selectedClip.id);
      setPlayhead(selectedClip.start);
      setPreviewMode('timeline');
    }
    const urls = Object.fromEntries(imports.map(({ file, asset }) => [asset.id, URL.createObjectURL(file)]));
    mediaUrlMap.current = { ...mediaUrlMap.current, ...urls };
    setMediaUrls({ ...mediaUrlMap.current });
    setSelectedAssetId(additions[0].id);
    commit({ ...project, assets: [...project.assets, ...additions], clips });
    setNotice(uploadErrors.length
      ? `${additions.length} media item${additions.length === 1 ? '' : 's'} added locally. Cloud upload failed for ${uploadErrors.join('; ')}.`
      : sessionStorage.getItem('frameforge:access-token')
        ? `${additions.length} media item${additions.length === 1 ? '' : 's'} saved on this device and uploaded to your account.`
        : `${additions.length} media item${additions.length === 1 ? '' : 's'} added and stored on this device.`);
    setImportingMedia(false);
  }
  function addAssetToTimeline(assetId: string) {
    const asset = project.assets.find((item) => item.id === assetId);
    if (!asset) return;
    const track = project.tracks.find((item) => asset.kind === 'audio' ? item.kind === 'audio' : item.kind === 'video');
    if (!track) { setNotice('Add a matching timeline track first.'); return; }
    const start = project.clips.filter((clip) => clip.trackId === track.id).reduce((end, clip) => Math.max(end, clip.start + clip.duration), 0);
    const clip: TimelineClip = { id: crypto.randomUUID(), assetId, trackId: track.id, start, duration: asset.kind === 'audio' ? 8 : 4, sourceOffset: 0 };
    commit({ ...project, clips: [...project.clips, clip] }); setSelectedAssetId(assetId); setSelectedClipId(clip.id); setPreviewMode('timeline'); setPlayhead(clip.start); setNotice(`${asset.name} added to ${track.name}.`);
  }
  async function saveDraft() {
    localStorage.setItem(`frameforge:${project.project.id}`, JSON.stringify(project)); setSaved(true);
    if (sessionStorage.getItem('frameforge:access-token')) {
      try { const savedProject = await saveCloudProject(project.project.name, project, cloudProjectId || undefined); setCloudProjectId(savedProject.id); if (currentUser) localStorage.setItem(cloudProjectKey(currentUser.id, project.project.id), savedProject.id); setNotice('Draft and uploaded media references saved on this device and to your account. Local-only media remains on this device.'); }
      catch (error) { setNotice(`Saved on this device. Cloud save failed: ${(error as Error).message}`); }
    } else setNotice('Draft saved on this device. Sign in from the account menu to save to your account.');
  }
  async function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setAuthBusy(true); setAuthError('');
    try {
      const user = await authenticate(authMode, email, password); setCurrentUser(user); sessionStorage.setItem('frameforge:user', JSON.stringify(user));
      const userProjectId = localStorage.getItem(cloudProjectKey(user.id, project.project.id)) ?? (currentUser?.id === user.id ? cloudProjectId : '');
      const savedProject = await saveCloudProject(project.project.name, project, userProjectId || undefined); setCloudProjectId(savedProject.id); localStorage.setItem(cloudProjectKey(user.id, project.project.id), savedProject.id);
      setAccountOpen(false); setPassword(''); setNotice(`Signed in as ${user.email}; project synced.`);
    } catch (error) { setAuthError((error as Error).message); }
    finally { setAuthBusy(false); }
  }
  function signOut() { sessionStorage.removeItem('frameforge:access-token'); sessionStorage.removeItem('frameforge:user'); setCurrentUser(null); setCloudProjectId(''); setAccountOpen(false); setNotice('Signed out. This device draft remains available.'); }
  function startNewProject() {
    localStorage.setItem(`frameforge:${project.project.id}`, JSON.stringify(project));
    setProject(makeProject()); setSelectedAssetId(null); setSelectedClipId(null); setPlaying(false); setPreviewMode('asset'); setPlayhead(0); setCloudProjectId(''); setProjectMenuOpen(false); setSaved(false);
  }
  function openLocalProject(id: string) {
    try { const savedProject = localStorage.getItem(`frameforge:${id}`); if (!savedProject) throw new Error('Project draft not found on this device.'); const restored = parseProjectDocument(JSON.parse(savedProject)); setProject(restored); setSelectedAssetId(null); setSelectedClipId(null); setPlaying(false); setPreviewMode('asset'); setPlayhead(0); setCloudProjectId(currentUser ? localStorage.getItem(cloudProjectKey(currentUser.id, id)) ?? '' : ''); setProjectMenuOpen(false); setSaved(true); }
    catch (error) { setNotice((error as Error).message); }
  }
  async function openCloudProject(id: string) {
    setOpeningCloudProjectId(id);
    try {
      const remote = await getCloudProject(id);
      const restored = parseProjectDocument(remote.document);
      localStorage.setItem(`frameforge:${project.project.id}`, JSON.stringify(project));
      setProject(restored);
      setSelectedAssetId(null);
      setSelectedClipId(null);
      setPlaying(false);
      setPreviewMode('asset');
      setPlayhead(0);
      setCloudProjectId(remote.id);
      if (currentUser) localStorage.setItem(cloudProjectKey(currentUser.id, restored.project.id), remote.id);
      setProjectMenuOpen(false);
      setSaved(true);
      setNotice(`Opened "${remote.name}". Cloud media restores when selected; local-only media must be reimported on another device.`);
    } catch (error) {
      setNotice(`Could not open account project: ${(error as Error).message}`);
    } finally {
      setOpeningCloudProjectId('');
    }
  }
  function renameProject() {
    const name = window.prompt('Project name', project.project.name)?.trim();
    if (name) commit({ ...project, project: { ...project.project, name: name.slice(0, 120) } });
    setProjectMenuOpen(false);
  }
  function downloadExport(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function exportFilename(extension: string) {
    const safeName = project.project.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'frameforge-project';
    return `${safeName}.${extension}`;
  }
  function downloadProjectFile() {
    downloadExport(new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' }), exportFilename('frameforge.json'));
    setNotice('Editable project file downloaded.');
  }
  async function startVideoExport() {
    const controller = new AbortController();
    exportAbort.current = controller;
    setExporting(true);
    setExportProgress(0);
    setExportError('');
    try {
      const blob = await renderProjectVideo(project, setExportProgress, controller.signal);
      downloadExport(blob, exportFilename('webm'));
      setExportOpen(false);
      setNotice('Rendered video downloaded as WebM.');
    } catch (error) {
      if (controller.signal.aborted) setExportError('Export cancelled.');
      else setExportError((error as Error).message);
    } finally {
      if (exportAbort.current === controller) exportAbort.current = null;
      setExporting(false);
    }
  }

  const toolTitle: Record<ToolId, string> = { media: 'Project media', audio: 'Audio library', text: 'Typography', captions: 'Captions', elements: 'Elements', effects: 'Effects', transitions: 'Transitions', ai: 'AI studio' };

  return <main className="studio">
    <header className="topbar">
      <div className="brand"><span className="brand-mark"><Clapperboard size={15}/></span><span>frameforge</span><span className="brand-divider"/><span className="studio-label">STUDIO</span></div>
      <div className="project-name">
        <button className="name-button" onClick={() => setProjectMenuOpen((open) => !open)}>{project.project.name}<ChevronDown size={13}/></button>
        {projectMenuOpen && <div className="project-menu">
          <div className="project-menu-label">CURRENT PROJECT</div>
          <button className="project-menu-action" onClick={renameProject}>Rename project</button>
          <button className="project-menu-action" onClick={startNewProject}><Plus size={13}/>New project</button>
          {localProjects.length > 0 && <>
            <div className="project-menu-label recent-label">ON THIS DEVICE</div>
            {localProjects.slice(0, 5).map((item) => <button className={`local-project-item ${item.id === project.project.id ? 'current' : ''}`} key={item.id} onClick={() => openLocalProject(item.id)}><span>{item.name}</span><small>{new Date(item.updatedAt).toLocaleDateString()}</small></button>)}
          </>}
          {currentUser && <>
            <div className="project-menu-label recent-label">IN YOUR ACCOUNT</div>
            {cloudProjectsLoading ? <div className="cloud-project-message">Loading account projects…</div> : cloudProjectsError ? <div className="cloud-project-message error" role="alert">{cloudProjectsError}</div> : cloudProjects.length > 0 ? cloudProjects.map((item) => <button className={`local-project-item ${item.id === cloudProjectId ? 'current' : ''}`} key={item.id} disabled={openingCloudProjectId !== ''} onClick={() => void openCloudProject(item.id)}><span>{openingCloudProjectId === item.id ? 'Opening…' : item.name}</span><small>{new Date(item.updated_at).toLocaleDateString()}</small></button>) : <div className="cloud-project-message">No account projects yet.</div>}
          </>}
        </div>}
        <span className={`save-indicator ${saved ? '' : 'unsaved'}`}><Cloud size={13}/>{saved ? 'All changes saved' : 'Unsaved changes'}</span>
      </div>
      <div className="top-actions"><button className="icon-button" title="Undo · Ctrl Z" onClick={undo}><Undo2 size={16}/></button><button className="icon-button" title="Redo · Ctrl Shift Z" onClick={redo}><Redo2 size={16}/></button><span className="top-divider"/><button className="icon-button" title="Help"><CircleHelp size={16}/></button><button className="avatar" aria-label="Account" onClick={() => { setAuthError(''); setAccountOpen(true); }}>{currentUser ? currentUser.email.slice(0, 1).toUpperCase() : 'A'}</button><button className="export-button" onClick={() => { setExportError(''); setExportOpen(true); }}><Download size={15}/>Export</button></div>
    </header>
    <section className="workspace">
      <nav className="tool-rail" aria-label="Creative tools">
        <div className="rail-top"><button className="rail-project" title="Project files"><FolderOpen size={17}/></button><span className="rail-separator"/></div>
        {tools.map(({ id, label, icon: Icon }) => <button key={id} className={`tool-button ${activeTool === id ? 'selected' : ''}`} onClick={() => { setActiveTool(id); if (id === 'captions' || id === 'text' || id === 'transitions') setPreviewMode('timeline'); }} aria-pressed={activeTool === id}><Icon size={18}/><span>{label}</span></button>)}
        <div className="rail-bottom"><button className="tool-button" title="Settings"><Settings2 size={18}/><span>Settings</span></button></div>
      </nav>

      <aside className="library-panel">
        <div className="panel-heading"><div><span className="eyebrow">WORKSPACE</span><h1>{toolTitle[activeTool]}</h1></div><button className="icon-button subtle" title="Collapse panel"><PanelLeftClose size={16}/></button></div>
        <div className="search-box"><span>⌕</span><input aria-label="Search media" placeholder={`Search ${activeToolInfo.label.toLowerCase()}`} /><kbd>⌘ K</kbd></div>
        {activeTool === 'media' ? <>
          <div className="media-tabs"><button className="tab active">Library <span>{project.assets.length}</span></button><button className="tab">Folders</button></div>
          <button className="import-card" disabled={importingMedia} onClick={() => fileRef.current?.click()}><span className="upload-icon"><Upload size={18}/></span><strong>{importingMedia ? 'Adding media…' : 'Import media'}</strong><span>Video, image, and audio files</span><kbd>⌘ I</kbd></button>
          <input ref={fileRef} type="file" accept="video/*,image/*,audio/*" multiple hidden disabled={importingMedia} onChange={(event) => importFiles(event.target.files)} />
          <div className="asset-filter"><span>ALL MEDIA</span><button>Recent <ChevronDown size={12}/></button></div>
          {project.assets.length ? <div className="asset-list">{project.assets.map((asset) => <div className={`asset-row ${selectedAssetId === asset.id ? 'asset-selected' : ''}`} key={asset.id} onClick={() => { setSelectedAssetId(asset.id); setSelectedClipId(null); setPreviewMode('asset'); setPlayhead(0); setPlaying(false); }}><div className={`asset-thumb ${asset.kind}`}>{asset.kind === 'audio' ? <Music2 size={15}/> : asset.kind === 'image' ? <Image size={15}/> : <Film size={15}/>}</div><div className="asset-meta"><strong>{asset.name}</strong><span>{asset.kind} · {((asset.size ?? 0) / 1048576).toFixed(1)} MB</span></div><button className="mini-add" title="Add to timeline" onClick={(event) => { event.stopPropagation(); addAssetToTimeline(asset.id); }}><Plus size={15}/></button></div>)}</div> : <div className="empty-media"><div className="empty-stack"><Image size={18}/><Music2 size={17}/><Film size={18}/></div><strong>Your library is ready</strong><p>Bring in footage, images, or audio to begin building your story.</p><button onClick={() => fileRef.current?.click()}><Plus size={14}/>Add your first media</button></div>}
          <div className="storage-meter"><div><span>LOCAL PROJECT</span><MoreHorizontal size={15}/></div><div className="meter"><i style={{ width: `${Math.min(100, project.assets.reduce((sum, asset) => sum + (asset.size ?? 0), 0) / (500 * 1048576) * 100)}%` }}/></div><small>{(project.assets.reduce((sum, asset) => sum + (asset.size ?? 0), 0) / 1048576).toFixed(1)} MB on this device</small></div>
        </> : activeTool === 'audio' ? <div className="audio-editor-panel">
          <div className="effects-intro"><span className="eyebrow">CLIP MIXER</span><p>Set the level for an audio-track clip. Track mute is controlled from the timeline.</p></div>
          {selectedClip && selectedClipTrack?.kind === 'audio' ? <section className="audio-clip-control">
            <strong>{project.assets.find((asset) => asset.id === selectedClip.assetId)?.name ?? 'Selected clip'}</strong>
            <label htmlFor="clip-volume">Volume <output>{Math.round((selectedClip.volume ?? 1) * 100)}%</output></label>
            <input id="clip-volume" aria-label="Clip volume" type="range" min="0" max="1" step="0.01" value={selectedClip.volume ?? 1} onChange={(event) => updateClipVolume(Number(event.target.value))}/>
          </section> : <div className="effects-empty">Select a clip on an audio track to adjust its volume.</div>}
        </div> : activeTool === 'effects' ? <div className="effects-panel">
          {selectedClip && selectedClipTrack?.kind === 'video' && project.assets.find((asset) => asset.id === selectedClip.assetId)?.kind !== 'audio' && <section className="visual-clip-control">
            <header><span>CLIP TRANSFORM</span><button type="button" className="effect-remove" onClick={() => updateVisualTransform({ x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 })}>Reset</button></header>
            <div className="visual-transform-grid">
              <label>Position X<input aria-label="Position X" type="number" min="-100000" max="100000" step="1" value={selectedClip.x ?? 0} onChange={(event) => updateVisualTransform({ x: event.currentTarget.valueAsNumber })}/></label>
              <label>Position Y<input aria-label="Position Y" type="number" min="-100000" max="100000" step="1" value={selectedClip.y ?? 0} onChange={(event) => updateVisualTransform({ y: event.currentTarget.valueAsNumber })}/></label>
              <label>Scale (%)<input aria-label="Scale" type="number" min="10" max="500" step="1" value={Math.round((selectedClip.scale ?? 1) * 100)} onChange={(event) => updateVisualTransform({ scale: event.currentTarget.valueAsNumber / 100 })}/></label>
              <label>Rotation<input aria-label="Rotation" type="number" min="-3600" max="3600" step="1" value={selectedClip.rotation ?? 0} onChange={(event) => updateVisualTransform({ rotation: event.currentTarget.valueAsNumber })}/></label>
            </div>
            <label className="visual-opacity-label" htmlFor="clip-opacity">Opacity <output>{Math.round((selectedClip.opacity ?? 1) * 100)}%</output></label>
            <input id="clip-opacity" aria-label="Clip opacity" type="range" min="0" max="1" step="0.01" value={selectedClip.opacity ?? 1} onChange={(event) => updateVisualTransform({ opacity: Number(event.target.value) })}/>
          </section>}
          <div className="effects-intro"><span className="eyebrow">PREVIEW EFFECTS</span><p>Non-destructive color and lens adjustments for the selected image or video.</p></div>
          {!selectedAsset && <div className="effects-empty">Select an image or video in your media library to apply an effect.</div>}
          {selectedAsset?.kind === 'audio' && <div className="effects-empty">Visual effects apply to images and videos. Select a visual asset to continue.</div>}
          {selectedAsset && selectedAsset.kind !== 'audio' && <>
            <div className="effects-section-label">ADD EFFECT</div>
            <div className="effect-library">{effectRegistry.map((effect) => {
              const applied = selectedEffects.some((item) => item.type === effect.id);
              return <button key={effect.id} className={`effect-option ${applied ? 'applied' : ''}`} title={effect.description} aria-label={`${applied ? 'Applied: ' : 'Add '}${effect.name}`} disabled={applied} onClick={() => addEffect(effect.id)}><span className={`effect-swatch ${effect.id}`}/><span><strong>{effect.name}</strong><small>{effect.description}</small></span><Plus size={14}/></button>;
            })}</div>
            <div className="effects-section-label applied-label">APPLIED · {selectedEffects.length}</div>
            {selectedEffects.length ? <div className="applied-effects">{selectedEffects.map((effect) => {
              const definition = effectRegistry.find((item) => item.id === effect.type);
              if (!definition) return null;
              return <section className={`applied-effect ${effect.enabled ? '' : 'disabled'}`} key={effect.id}>
                <header><span>{definition.name}</span><button aria-label={`${effect.enabled ? 'Disable' : 'Enable'} ${definition.name}`} aria-pressed={effect.enabled} className={`switch ${effect.enabled ? 'on' : ''}`} onClick={() => updateEffect(effect.id, { enabled: !effect.enabled })}><i/></button><button className="effect-remove" aria-label={`Remove ${definition.name}`} onClick={() => removeEffect(effect.id)}>×</button></header>
                <label htmlFor={`effect-strength-${effect.id}`}>Intensity <output>{effect.strength}%</output></label>
                <input id={`effect-strength-${effect.id}`} aria-label={`${definition.name} intensity`} type="range" min="0" max="100" step="1" value={effect.strength} disabled={!effect.enabled} onChange={(event) => updateEffect(effect.id, { strength: Number(event.target.value) })}/>
              </section>;
            })}</div> : <div className="effects-empty applied-empty">No effects yet. Choose one above to add it to this asset.</div>}
          </>}
        </div> : activeTool === 'text' || activeTool === 'captions' || activeTool === 'transitions' || activeTool === 'ai'
          ? <CreativeToolsPanel
            tool={activeTool}
            overlays={project.textOverlays}
            playhead={playhead}
            selectedClip={selectedClip}
            onAddOverlays={addTextOverlays}
            onUpdateOverlay={updateTextOverlay}
            onRemoveOverlay={removeTextOverlay}
            onSetPlayhead={(time) => { setPreviewMode('timeline'); setPlayhead(time); }}
            onTransitionChange={updateTransition}
          />
          : <div className="tool-empty"><span className="tool-empty-icon"><activeToolInfo.icon size={20}/></span><h2>{activeToolInfo.label} workspace</h2><p>Add media to your project to explore {activeToolInfo.label.toLowerCase()} tools.</p><button onClick={() => setActiveTool('media')}>Browse project media<ChevronDown size={13}/></button><div className="planned-note"><LockKeyhole size={13}/>More capabilities are on the roadmap</div></div>}
      </aside>

      <section className="editor-main">
        <div className="canvas-toolbar"><div className="canvas-select"><span className="canvas-dot"/><span>Canvas</span><span className="toolbar-muted">·</span><button>Portrait 9:16 <ChevronDown size={12}/></button><button className="mobile-import" onClick={() => fileRef.current?.click()}><Upload size={14}/>Import</button></div><div className="canvas-tools"><button className="tool-chip"><Frame size={14}/>Safe area</button><span className="toolbar-separator"/><button className="icon-button tiny" title="Zoom out" onClick={() => setCanvasZoom((value) => Math.max(0.5, value - 0.1))}><ZoomOut size={15}/></button><button className="zoom-value" onClick={() => setCanvasZoom(1)}>{Math.round(canvasZoom * 100)}%</button><button className="icon-button tiny" title="Zoom in" onClick={() => setCanvasZoom((value) => Math.min(1.5, value + 0.1))}><ZoomIn size={15}/></button><button className="icon-button tiny" title="Fit to screen" onClick={() => setCanvasZoom(1)}><Maximize2 size={14}/></button></div></div>
        <div className="preview-stage">
          <div className="stage-corner top-left"/><div className="stage-corner top-right"/><div className="stage-corner bottom-left"/><div className="stage-corner bottom-right"/>
          <div className="canvas-frame" style={{ transform: `scale(${canvasZoom})` }}>
            <div className="canvas-gradient">
              {previewMode === 'timeline' ? <TimelineComposition items={activeTimelineItems} mediaUrls={mediaUrls} effects={project.effects} overlays={project.textOverlays} playhead={playhead} onMediaElement={setTimelineMediaElement} onMediaMetadata={updateClipDuration}/> : selectedAsset && mediaUrls[selectedAsset.id] ? <div className="media-preview">
                {selectedAsset.kind === 'video' ? <video src={mediaUrls[selectedAsset.id]} style={{ filter: previewEffect.filter }} playsInline controls/> : selectedAsset.kind === 'image' ? <img src={mediaUrls[selectedAsset.id]} alt={selectedAsset.name} style={{ filter: previewEffect.filter }}/> : <div className="audio-preview"><div className="audio-preview-icon"><AudioLines size={25}/></div><strong>{selectedAsset.name}</strong><span>Audio preview</span><audio src={mediaUrls[selectedAsset.id]} controls/></div>}
                {selectedAsset.kind !== 'audio' && previewEffect.vignette > 0 && <div className="preview-vignette" style={{ background: `radial-gradient(ellipse at center, transparent 38%, rgba(0,0,0,${previewEffect.vignette * 0.78}) 100%)` }}/>}
              </div> : <><div className="canvas-glow one"/><div className="canvas-glow two"/><div className="canvas-center"><div className="center-mark"><Clapperboard size={21}/></div><span className="canvas-overline">{selectedAsset ? 'MEDIA PREVIEW' : 'YOUR NEXT STORY'}</span><strong>{selectedAsset ? selectedAsset.name : <>Make room<br/>for the <em>moment.</em></>}</strong><span className="canvas-caption">{selectedAsset ? loadingAssetId === selectedAsset.id ? 'Restoring media…' : 'Media preview is unavailable on this device.' : 'A new canvas is a blank invitation.'}</span></div></>}
              <div className="canvas-safe"><span>SAFE AREA</span></div>
            </div>
          </div>
          <div className="preview-hint"><span className="hint-pulse"/>PREVIEW <span className="hint-divider"/> {project.canvas.width} × {project.canvas.height}</div>
          <button className="fullscreen-button" title="Fullscreen preview" onClick={(event) => { const frame = event.currentTarget.parentElement?.querySelector('.canvas-frame'); if (frame?.requestFullscreen) void frame.requestFullscreen(); }}><Maximize2 size={14}/></button>
        </div>
        <div className="transport"><div className="transport-left"><button className="icon-button" title="Go to start" aria-label="Go to start" onClick={() => { setPlaying(false); setPreviewMode('timeline'); setPlayhead(0); }}><span className="skip-start">|◀</span></button><button className="play-button" title="Play / pause · Space" aria-label="Play / pause · Space" onClick={togglePlayback}>{playing ? <Pause size={16} fill="currentColor"/> : <Play size={16} fill="currentColor"/>}</button><button className="icon-button" title="Step forward" aria-label="Step forward" onClick={() => { setPlaying(false); setPreviewMode('timeline'); setPlayhead((time) => Math.min(sequenceDuration, time + 1 / project.canvas.fps)); }}><span className="skip-next">▶|</span></button><span className="transport-time"><strong>{formatTime(playhead)}</strong><span> / {formatTime(sequenceDuration || duration)}</span></span></div><div className="transport-right"><button className="icon-button" title={previewMuted ? 'Unmute preview' : 'Mute preview'} aria-label={previewMuted ? 'Unmute preview' : 'Mute preview'} aria-pressed={previewMuted} onClick={() => setPreviewMuted((muted) => !muted)}><Volume2 size={15} opacity={previewMuted ? .45 : 1}/></button><span className="toolbar-separator"/><button className="icon-button" title="Playback quality"><Gauge size={15}/></button><button className="quality-label">Full quality <ChevronDown size={12}/></button></div></div>
        <section className="timeline">
          <div className="timeline-header"><div className="timeline-title"><span className="eyebrow">SEQUENCE</span><strong>Timeline</strong><span className="timeline-pill">{project.tracks.length} tracks</span></div><div className="timeline-actions">{selectedClip && <><button className="tool-chip" onClick={splitSelectedClip}><Scissors size={14}/>Split</button><button className="icon-button tiny" title="Duplicate clip · Ctrl D" onClick={duplicateSelectedClip}><Copy size={14}/></button><button className="icon-button tiny" title="Delete clip" onClick={deleteSelectedClip}><Trash2 size={14}/></button></>}<button className="icon-button tiny" title="Timeline settings"><Settings2 size={15}/></button><span className="toolbar-separator"/><button className="icon-button tiny" onClick={() => setTimelineZoom((value) => Math.max(0.5, value - 0.1))} title="Zoom out timeline"><ZoomOut size={15}/></button><button className="icon-button tiny" onClick={() => setTimelineZoom((value) => Math.min(1.5, value + 0.1))} title="Zoom in timeline"><ZoomIn size={15}/></button></div></div>
          <div className="timeline-body"><div className="track-labels"><div className="ruler-spacer"><button title="Add track" onClick={() => { const id = crypto.randomUUID(); commit({ ...project, tracks: [...project.tracks, { id, name: `Video ${project.tracks.length + 1}`, kind: 'video', color: '#ad7dff', muted: false, hidden: false, locked: false }] }); }}><Plus size={15}/></button></div>{project.tracks.map((track, index) => <div className="track-label" key={track.id}><span className="track-color" style={{ background: track.color }}/><span className="track-name">{track.name}</span><button title={track.kind === 'audio' ? 'Mute track' : 'Hide track'} onClick={() => commit({ ...project, tracks: project.tracks.map((item, i) => i === index ? { ...item, [item.kind === 'audio' ? 'muted' : 'hidden']: !item[item.kind === 'audio' ? 'muted' : 'hidden'] } : item) })}>{track.kind === 'audio' ? <Volume2 size={13} opacity={track.muted ? .4 : 1}/> : <Square size={12} opacity={track.hidden ? .4 : 1}/>}</button><button title="Lock track" onClick={() => commit({ ...project, tracks: project.tracks.map((item, i) => i === index ? { ...item, locked: !item.locked } : item) })}><LockKeyhole size={12} opacity={track.locked ? 1 : .5}/></button></div>)}</div>
            <div className="timeline-scroll"><div className="timeline-content" style={{ width: `${100 * timelineZoom}%`, minWidth: `${450 * timelineZoom}px` }} onClick={(event) => { const bounds = event.currentTarget.getBoundingClientRect(); setPreviewMode('timeline'); setPlayhead(Math.max(0, Math.min(duration, (event.clientX - bounds.left) / bounds.width * duration))); }}><div className="ruler">{rulerMarks.map((mark) => <div key={mark} className="ruler-mark" style={{ left: `${mark / duration * 100}%` }}><i/><span>{formatTime(mark)}</span></div>)}</div>{project.tracks.map((track) => <div className="track-lane" data-track-id={track.id} key={track.id}><div className="lane-grid"/>{project.clips.filter((clip) => clip.trackId === track.id).map((clip) => { const asset = project.assets.find((item) => item.id === clip.assetId); if (!asset) return null; return <button className={`clip ${clip.id === selectedClipId ? 'clip-selected' : ''}`} key={clip.id} disabled={track.locked} style={{ left: `${clip.start / duration * 100}%`, width: `${Math.max(8, clip.duration / duration * 100)}%`, borderColor: `${track.color}77`, background: `linear-gradient(100deg, ${track.color}38, ${track.color}20)` }} onPointerDown={(event) => startTimelineDrag(event, clip)} onClick={(event) => { event.stopPropagation(); setPlaying(false); setPreviewMode('timeline'); setSelectedClipId(clip.id); setSelectedAssetId(asset.id); setPlayhead(clip.start); setNotice(`${asset.name} selected.`); }}><span className="clip-trim-handle" data-trim-handle="start" role="slider" aria-label={`Trim start of ${asset.name}`} aria-valuemin={0} aria-valuenow={clip.start}/><span className="clip-grip"/><span className="clip-icon">{asset.kind === 'audio' ? <AudioLines size={13}/> : <Film size={13}/>}</span><span className="clip-name">{asset.name}</span><span className="clip-wave">{track.kind === 'audio' && Array.from({ length: 25 }, (_, k) => <i key={k} style={{ height: `${20 + Math.abs(Math.sin(k * 2.4)) * 65}%` }}/>)}</span><span className="clip-grip end"/><span className="clip-trim-handle end" data-trim-handle="end" role="slider" aria-label={`Trim end of ${asset.name}`} aria-valuemin={0} aria-valuenow={clip.duration}/></button>; })}</div>)}<div className="playhead" style={{ left: `${playhead / duration * 100}%` }}><i/></div></div><button className="timeline-add-track" onClick={() => { const id = crypto.randomUUID(); commit({ ...project, tracks: [...project.tracks, { id, name: `Track ${project.tracks.length + 1}`, kind: 'video', color: '#ad7dff', muted: false, hidden: false, locked: false }] }); }}><Plus size={14}/></button></div></div>
            <div className="timeline-footer"><span><Command size={12}/> Click timeline to move playhead</span><span>Snapping <i className="toggle-on"/></span><button onClick={saveDraft}><Cloud size={13}/>Save draft</button></div>
          </section>
      </section>
      <aside className="inspector"><div className="inspector-head"><span className="eyebrow">PROPERTIES</span><button className="icon-button subtle"><MoreHorizontal size={17}/></button></div><div className="inspector-content"><div className="selection-card"><div className="selection-icon"><Frame size={17}/></div><div><strong>Canvas settings</strong><span>Portrait composition</span></div><ChevronDown size={14}/></div><section className="inspector-section"><div className="section-title"><span>FORMAT</span><button className="icon-button subtle"><MoreHorizontal size={15}/></button></div><div className="format-preview"><div className="format-portrait"><span/></div><div className="format-copy"><strong>Portrait 9:16</strong><span>Social video</span><button>Change format <ChevronDown size={12}/></button></div></div><div className="dimension-row"><label>Width<div><input value={project.canvas.width} readOnly/><span>px</span></div></label><span className="dimension-link">↔</span><label>Height<div><input value={project.canvas.height} readOnly/><span>px</span></div></label></div><label className="inspector-select-label">Frame rate<button>{project.canvas.fps} fps <ChevronDown size={13}/></button></label></section><section className="inspector-section"><div className="section-title"><span>CANVAS</span></div><div className="inspector-property"><span>Background</span><button className="color-picker"><i style={{ background: project.canvas.background }}/><span>{project.canvas.background}</span><ChevronDown size={12}/></button></div><div className="inspector-property"><span>Safe margins</span><button className="switch on"><i/></button></div><div className="inspector-property"><span>Background fill</span><button className="switch"><i/></button></div></section><section className="inspector-section layer-summary"><div className="section-title"><span>LAYERS</span><button className="icon-button subtle"><Plus size={15}/></button></div>{project.tracks.map((track) => <div className="layer-row" key={track.id}><span className="track-color" style={{ background: track.color }}/><span>{track.name}</span><button title="Lock layer"><LockKeyhole size={12}/></button></div>)}</section><div className="inspector-tip"><Sparkles size={14}/><span>Select a layer or clip to see its editing controls here.</span></div></div><div className="inspector-bottom"><button><CircleHelp size={14}/>Inspector guide</button><span>⌘ /</span></div></aside>
    </section>
    <footer className="statusbar"><div><span className="status-online"/>Workspace ready</div><span>Frameforge Studio <i>·</i> Draft 1.0</span><button onClick={() => setNotice('Keyboard shortcuts: Space play/pause · ⌘Z undo · ⌘⇧Z redo · ⌘S save')}><CircleHelp size={13}/>Shortcuts</button></footer>
    {exportOpen && <div className="export-backdrop" role="presentation" onMouseDown={(event) => { if (!exporting && event.target === event.currentTarget) setExportOpen(false); }}>
      <section className="export-modal" role="dialog" aria-modal="true" aria-labelledby="export-title">
        <button className="modal-close" aria-label="Close export" disabled={exporting} onClick={() => setExportOpen(false)}>×</button>
        <div className="modal-mark"><Download size={18}/></div><span className="eyebrow">LOCAL EXPORT</span><h2 id="export-title">Export your project</h2>
        <p className="modal-description">Render the timeline to a WebM video in your browser, or download the editable project document.</p>
        <button className="modal-submit" onClick={() => void startVideoExport()} disabled={exporting}>{exporting ? `Rendering video · ${Math.round(exportProgress * 100)}%` : 'Render video (.webm)'}</button>
        <button className="modal-secondary" onClick={downloadProjectFile} disabled={exporting}>Download editable project (.frameforge.json)</button>
        {exporting && <div className="export-progress" aria-label="Export progress"><div><i style={{ width: `${Math.round(exportProgress * 100)}%` }}/></div><span>{Math.round(exportProgress * 100)}%</span><button className="modal-secondary" onClick={() => exportAbort.current?.abort()}>Cancel render</button></div>}
        {exportError && <p className="export-error" role="alert">{exportError}</p>}
        <p className="export-note">WebM rendering runs in real time and includes timeline video, images, audio, text overlays, fades, and supported effects. AI generation requires an external provider and is not included.</p>
      </section>
    </div>}
    {accountOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setAccountOpen(false); }}><section className="account-modal" role="dialog" aria-modal="true" aria-labelledby="account-title"><button className="modal-close" aria-label="Close" onClick={() => setAccountOpen(false)}>×</button><div className="modal-mark"><Clapperboard size={18}/></div><span className="eyebrow">FRAMEFORGE ACCOUNT</span><h2 id="account-title">{currentUser ? 'Your workspace' : authMode === 'login' ? 'Welcome back' : 'Create your account'}</h2>{currentUser ? <><p className="modal-description">Signed in as <strong>{currentUser.email}</strong>. Your project can sync to your account.</p><button className="modal-submit" onClick={saveDraft}>Sync this project</button><button className="modal-secondary" onClick={signOut}>Sign out</button></> : <form onSubmit={submitAuth}><p className="modal-description">Sign in to sync your project. Your local draft stays on this device.</p><label>Email address<input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com"/></label><label>Password<input type="password" autoComplete={authMode === 'login' ? 'current-password' : 'new-password'} required minLength={10} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 10 characters"/></label>{authError && <p className="auth-error" role="alert">{authError}</p>}<button className="modal-submit" disabled={authBusy}>{authBusy ? 'Connecting…' : authMode === 'login' ? 'Sign in and sync' : 'Create account'}</button><button type="button" className="modal-secondary" onClick={() => { setAuthError(''); setAuthMode(authMode === 'login' ? 'register' : 'login'); }}>{authMode === 'login' ? 'New to Frameforge? Create account' : 'Already have an account? Sign in'}</button></form>}</section></div>}
    {notice && <div className="toast" role="status"><span>{notice}</span><button onClick={() => setNotice('')}>Dismiss</button></div>}
  </main>;
}
