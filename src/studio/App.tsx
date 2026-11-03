import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { AudioLines, Captions, ChevronDown, CircleHelp, Clapperboard, Cloud, Command, Copy, Download, Film, FolderOpen, Frame, Gauge, Image, Layers3, LockKeyhole, Maximize2, MoreHorizontal, Music2, PanelLeftClose, Pause, Play, Plus, Redo2, Scissors, Settings2, Shapes, Sparkles, Square, Trash2, Type, Undo2, Upload, Volume2, WandSparkles, ZoomIn, ZoomOut } from 'lucide-react';
import { formatTime, makeProject, type MediaAsset, type ProjectDocument, type TimelineClip, type ToolId } from './model';
import { authenticate, saveCloudProject } from './api';
import { readMedia, storeMedia } from './mediaStore';

const tools: { id: ToolId; label: string; icon: typeof Film }[] = [
  { id: 'media', label: 'Media', icon: Film }, { id: 'audio', label: 'Audio', icon: AudioLines }, { id: 'text', label: 'Text', icon: Type },
  { id: 'captions', label: 'Captions', icon: Captions }, { id: 'elements', label: 'Elements', icon: Shapes }, { id: 'effects', label: 'Effects', icon: Sparkles },
  { id: 'transitions', label: 'Transitions', icon: Layers3 }, { id: 'ai', label: 'AI studio', icon: WandSparkles },
];
const cloudProjectKey = (userId: string, localProjectId: string) => `frameforge:cloud-project:${userId}:${localProjectId}`;

export default function App() {
  const [project, setProject] = useState<ProjectDocument>(() => {
    try {
      const previous = localStorage.getItem('frameforge:last-project');
      if (!previous) return makeProject();
      const restored = JSON.parse(previous) as ProjectDocument;
      return { ...restored, clips: restored.clips ?? [] };
    } catch { return makeProject(); }
  });
  const [activeTool, setActiveTool] = useState<ToolId>('media');
  const [playing, setPlaying] = useState(false);
  const [playhead, setPlayhead] = useState(0);
  const [canvasZoom, setCanvasZoom] = useState(1);
  const [timelineZoom, setTimelineZoom] = useState(1);
  const [notice, setNotice] = useState('');
  const [mediaUrls, setMediaUrls] = useState<Record<string, string>>({});
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
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState('');
  const [localProjects, setLocalProjects] = useState<{ id: string; name: string; updatedAt: string }[]>(() => { try { return JSON.parse(localStorage.getItem('frameforge:projects-index') ?? '[]'); } catch { return []; } });
  const fileRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const mediaUrlMap = useRef<Record<string, string>>({});
  const undoStack = useRef<ProjectDocument[]>([]);
  const redoStack = useRef<ProjectDocument[]>([]);
  const [saved, setSaved] = useState(true);
  const lastClipEnd = project.clips.reduce((end, clip) => Math.max(end, clip.start + clip.duration), 0);
  const duration = Math.max(24, Math.ceil(lastClipEnd / 12) * 12);
  const selectedAsset = project.assets.find((asset) => asset.id === selectedAssetId);
  const selectedClip = project.clips.find((clip) => clip.id === selectedClipId);
  const activeToolInfo = tools.find((tool) => tool.id === activeTool)!;
  const rulerMarks = useMemo(() => Array.from({ length: duration / 2 + 1 }, (_, i) => i * 2), [duration]);

  useEffect(() => {
    if (!playing) return;
    if (selectedAsset?.kind === 'video') return;
    const timer = window.setInterval(() => setPlayhead((time) => time >= duration ? 0 : time + 0.1), 100);
    return () => window.clearInterval(timer);
  }, [playing, selectedAsset?.kind]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (playing) void video.play().catch(() => setPlaying(false));
    else video.pause();
  }, [playing, selectedAssetId]);

  useEffect(() => {
    const video = videoRef.current;
    if (video && Math.abs(video.currentTime - playhead) > 0.25) video.currentTime = playhead;
  }, [playhead]);

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
    let active = true;
    void Promise.all(project.assets.map(async (asset) => {
      if (mediaUrlMap.current[asset.id]) return null;
      const blob = await readMedia(asset.id);
      return blob ? [asset.id, URL.createObjectURL(blob)] as const : null;
    })).then((entries) => {
      const added = Object.fromEntries(entries.filter((entry): entry is readonly [string, string] => entry !== null));
      if (!active) { Object.values(added).forEach(URL.revokeObjectURL); return; }
      mediaUrlMap.current = { ...mediaUrlMap.current, ...added };
      setMediaUrls({ ...mediaUrlMap.current });
    }).catch(() => setNotice('Some local media could not be restored. Reimport the affected files to continue.'));
    return () => { active = false; };
  }, [project.assets]);

  useEffect(() => () => { Object.values(mediaUrlMap.current).forEach(URL.revokeObjectURL); }, []);

  useEffect(() => {
    if (!sessionStorage.getItem('frameforge:access-token') || !cloudProjectId) return;
    const timer = window.setTimeout(() => {
      void saveCloudProject(project.project.name, project, cloudProjectId).catch((error: Error) => setNotice(`Cloud save failed: ${error.message}`));
    }, 1400);
    return () => window.clearTimeout(timer);
  }, [project, cloudProjectId]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); }
      else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') { event.preventDefault(); saveDraft(); }
      else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'd') { event.preventDefault(); duplicateSelectedClip(); }
      else if (event.code === 'Space' && !(event.target instanceof HTMLInputElement)) { event.preventDefault(); setPlaying((value) => !value); }
      else if (event.key.toLowerCase() === 's' && !(event.target instanceof HTMLInputElement)) splitSelectedClip();
      else if ((event.key === 'Delete' || event.key === 'Backspace') && !(event.target instanceof HTMLInputElement)) deleteSelectedClip();
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  });

  function commit(next: ProjectDocument) { undoStack.current.push(project); redoStack.current = []; setProject(next); setSaved(false); }
  function undo() { const prior = undoStack.current.pop(); if (prior) { redoStack.current.push(project); setProject(prior); setSaved(false); } }
  function redo() { const next = redoStack.current.pop(); if (next) { undoStack.current.push(project); setProject(next); setSaved(false); } }
  function splitSelectedClip() {
    const clip = project.clips.find((item) => item.id === selectedClipId);
    if (!clip || playhead <= clip.start + 0.05 || playhead >= clip.start + clip.duration - 0.05) { setNotice('Place the playhead inside a selected clip to split it.'); return; }
    const firstDuration = playhead - clip.start;
    const second: TimelineClip = { ...clip, id: crypto.randomUUID(), start: playhead, duration: clip.duration - firstDuration, sourceOffset: clip.sourceOffset + firstDuration };
    commit({ ...project, clips: project.clips.flatMap((item) => item.id === clip.id ? [{ ...item, duration: firstDuration }, second] : [item]) });
    setSelectedClipId(second.id); setNotice('Clip split at the playhead.');
  }
  function deleteSelectedClip() {
    if (!selectedClipId) return;
    commit({ ...project, clips: project.clips.filter((clip) => clip.id !== selectedClipId) }); setSelectedClipId(null); setNotice('Timeline clip removed.');
  }
  function duplicateSelectedClip() {
    const clip = project.clips.find((item) => item.id === selectedClipId);
    if (!clip) return;
    const duplicate = { ...clip, id: crypto.randomUUID(), start: clip.start + clip.duration + 0.15 };
    commit({ ...project, clips: [...project.clips, duplicate] }); setSelectedClipId(duplicate.id); setNotice('Clip duplicated.');
  }
  function updateClipDuration(assetId: string, mediaDuration: number) {
    const clip = project.clips.find((item) => item.assetId === assetId && item.id === selectedClipId);
    if (clip && Number.isFinite(mediaDuration) && mediaDuration > 0 && Math.abs(clip.duration - mediaDuration) > 0.25) {
      commit({ ...project, clips: project.clips.map((item) => item.id === clip.id ? { ...item, duration: mediaDuration } : item) });
    }
  }
  async function importFiles(files: FileList | null) {
    if (!files?.length) return;
    const imports = Array.from(files).filter((file) => file.type.startsWith('video/') || file.type.startsWith('image/') || file.type.startsWith('audio/')).map((file) => ({ file, asset: { id: crypto.randomUUID(), name: file.name, kind: (file.type.startsWith('audio/') ? 'audio' : file.type.startsWith('image/') ? 'image' : 'video') as MediaAsset['kind'], mimeType: file.type, size: file.size } }));
    if (!imports.length) { setNotice('Choose a video, image, or audio file.'); return; }
    try { await Promise.all(imports.map(({ file, asset }) => storeMedia(asset.id, file))); }
    catch (error) { setNotice(`Media could not be saved in browser storage: ${(error as Error).message}`); return; }
    const additions = imports.map(({ asset }) => asset);
    const clips = [...project.clips];
    for (const asset of additions) {
      const track = project.tracks.find((item) => asset.kind === 'audio' ? item.kind === 'audio' : item.kind === 'video');
      if (!track) continue;
      const start = clips.filter((clip) => clip.trackId === track.id).reduce((end, clip) => Math.max(end, clip.start + clip.duration), 0);
      clips.push({ id: crypto.randomUUID(), assetId: asset.id, trackId: track.id, start, duration: asset.kind === 'audio' ? 8 : 4, sourceOffset: 0 });
    }
    if (clips.length > project.clips.length) setSelectedClipId(clips[project.clips.length].id);
    const urls = Object.fromEntries(imports.map(({ file, asset }) => [asset.id, URL.createObjectURL(file)]));
    mediaUrlMap.current = { ...mediaUrlMap.current, ...urls };
    setMediaUrls({ ...mediaUrlMap.current });
    setSelectedAssetId(additions[0].id);
    commit({ ...project, assets: [...project.assets, ...additions], clips }); setNotice(`${additions.length} media item${additions.length === 1 ? '' : 's'} added and stored on this device.`);
  }
  function addAssetToTimeline(assetId: string) {
    const asset = project.assets.find((item) => item.id === assetId);
    if (!asset) return;
    const track = project.tracks.find((item) => asset.kind === 'audio' ? item.kind === 'audio' : item.kind === 'video');
    if (!track) { setNotice('Add a matching timeline track first.'); return; }
    const start = project.clips.filter((clip) => clip.trackId === track.id).reduce((end, clip) => Math.max(end, clip.start + clip.duration), 0);
    const clip: TimelineClip = { id: crypto.randomUUID(), assetId, trackId: track.id, start, duration: asset.kind === 'audio' ? 8 : 4, sourceOffset: 0 };
    commit({ ...project, clips: [...project.clips, clip] }); setSelectedAssetId(assetId); setSelectedClipId(clip.id); setNotice(`${asset.name} added to ${track.name}.`);
  }
  async function saveDraft() {
    localStorage.setItem(`frameforge:${project.project.id}`, JSON.stringify(project)); setSaved(true);
    if (sessionStorage.getItem('frameforge:access-token')) {
      try { const savedProject = await saveCloudProject(project.project.name, project, cloudProjectId || undefined); setCloudProjectId(savedProject.id); if (currentUser) localStorage.setItem(cloudProjectKey(currentUser.id, project.project.id), savedProject.id); setNotice('Draft saved on this device and to your account. Source media remains on this device.'); }
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
    setProject(makeProject()); setSelectedAssetId(null); setSelectedClipId(null); setPlaying(false); setPlayhead(0); setCloudProjectId(''); setProjectMenuOpen(false); setSaved(false);
  }
  function openLocalProject(id: string) {
    try { const savedProject = localStorage.getItem(`frameforge:${id}`); if (!savedProject) throw new Error('Project draft not found on this device.'); const restored = JSON.parse(savedProject) as ProjectDocument; setProject({ ...restored, clips: restored.clips ?? [] }); setSelectedAssetId(null); setSelectedClipId(null); setPlaying(false); setPlayhead(0); setCloudProjectId(currentUser ? localStorage.getItem(cloudProjectKey(currentUser.id, id)) ?? '' : ''); setProjectMenuOpen(false); setSaved(true); }
    catch (error) { setNotice((error as Error).message); }
  }
  function renameProject() {
    const name = window.prompt('Project name', project.project.name)?.trim();
    if (name) commit({ ...project, project: { ...project.project, name: name.slice(0, 120) } });
    setProjectMenuOpen(false);
  }
  function exportProject() { const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${project.project.name.toLowerCase().replaceAll(' ', '-')}.frameforge.json`; anchor.click(); URL.revokeObjectURL(url); setNotice('Project document exported. Video rendering will arrive with the export pipeline.'); }

  const toolTitle: Record<ToolId, string> = { media: 'Project media', audio: 'Audio library', text: 'Typography', captions: 'Captions', elements: 'Elements', effects: 'Effects', transitions: 'Transitions', ai: 'AI studio' };

  return <main className="studio">
    <header className="topbar">
      <div className="brand"><span className="brand-mark"><Clapperboard size={15}/></span><span>frameforge</span><span className="brand-divider"/><span className="studio-label">STUDIO</span></div>
      <div className="project-name"><button className="name-button" onClick={() => setProjectMenuOpen((open) => !open)}>{project.project.name}<ChevronDown size={13}/></button>{projectMenuOpen && <div className="project-menu"><div className="project-menu-label">CURRENT PROJECT</div><button className="project-menu-action" onClick={renameProject}>Rename project</button><button className="project-menu-action" onClick={startNewProject}><Plus size={13}/>New project</button>{localProjects.length > 0 && <><div className="project-menu-label recent-label">ON THIS DEVICE</div>{localProjects.slice(0, 5).map((item) => <button className={`local-project-item ${item.id === project.project.id ? 'current' : ''}`} key={item.id} onClick={() => openLocalProject(item.id)}><span>{item.name}</span><small>{new Date(item.updatedAt).toLocaleDateString()}</small></button>)}</>}</div>}<span className={`save-indicator ${saved ? '' : 'unsaved'}`}><Cloud size={13}/>{saved ? 'All changes saved' : 'Unsaved changes'}</span></div>
      <div className="top-actions"><button className="icon-button" title="Undo · Ctrl Z" onClick={undo}><Undo2 size={16}/></button><button className="icon-button" title="Redo · Ctrl Shift Z" onClick={redo}><Redo2 size={16}/></button><span className="top-divider"/><button className="icon-button" title="Help"><CircleHelp size={16}/></button><button className="avatar" aria-label="Account" onClick={() => { setAuthError(''); setAccountOpen(true); }}>{currentUser ? currentUser.email.slice(0, 1).toUpperCase() : 'A'}</button><button className="export-button" onClick={exportProject}><Download size={15}/>Export</button></div>
    </header>
    <section className="workspace">
      <nav className="tool-rail" aria-label="Creative tools">
        <div className="rail-top"><button className="rail-project" title="Project files"><FolderOpen size={17}/></button><span className="rail-separator"/></div>
        {tools.map(({ id, label, icon: Icon }) => <button key={id} className={`tool-button ${activeTool === id ? 'selected' : ''}`} onClick={() => setActiveTool(id)} aria-pressed={activeTool === id}><Icon size={18}/><span>{label}</span></button>)}
        <div className="rail-bottom"><button className="tool-button" title="Settings"><Settings2 size={18}/><span>Settings</span></button></div>
      </nav>

      <aside className="library-panel">
        <div className="panel-heading"><div><span className="eyebrow">WORKSPACE</span><h1>{toolTitle[activeTool]}</h1></div><button className="icon-button subtle" title="Collapse panel"><PanelLeftClose size={16}/></button></div>
        <div className="search-box"><span>⌕</span><input aria-label="Search media" placeholder={`Search ${activeToolInfo.label.toLowerCase()}`} /><kbd>⌘ K</kbd></div>
        {activeTool === 'media' ? <>
          <div className="media-tabs"><button className="tab active">Library <span>{project.assets.length}</span></button><button className="tab">Folders</button></div>
          <button className="import-card" onClick={() => fileRef.current?.click()}><span className="upload-icon"><Upload size={18}/></span><strong>Import media</strong><span>Video, image, and audio files</span><kbd>⌘ I</kbd></button>
          <input ref={fileRef} type="file" accept="video/*,image/*,audio/*" multiple hidden onChange={(event) => importFiles(event.target.files)} />
          <div className="asset-filter"><span>ALL MEDIA</span><button>Recent <ChevronDown size={12}/></button></div>
          {project.assets.length ? <div className="asset-list">{project.assets.map((asset) => <div className={`asset-row ${selectedAssetId === asset.id ? 'asset-selected' : ''}`} key={asset.id} onClick={() => { setSelectedAssetId(asset.id); setSelectedClipId(null); setPlayhead(0); setPlaying(false); }}><div className={`asset-thumb ${asset.kind}`}>{asset.kind === 'audio' ? <Music2 size={15}/> : asset.kind === 'image' ? <Image size={15}/> : <Film size={15}/>}</div><div className="asset-meta"><strong>{asset.name}</strong><span>{asset.kind} · {((asset.size ?? 0) / 1048576).toFixed(1)} MB</span></div><button className="mini-add" title="Add to timeline" onClick={(event) => { event.stopPropagation(); addAssetToTimeline(asset.id); }}><Plus size={15}/></button></div>)}</div> : <div className="empty-media"><div className="empty-stack"><Image size={18}/><Music2 size={17}/><Film size={18}/></div><strong>Your library is ready</strong><p>Bring in footage, images, or audio to begin building your story.</p><button onClick={() => fileRef.current?.click()}><Plus size={14}/>Add your first media</button></div>}
          <div className="storage-meter"><div><span>LOCAL PROJECT</span><MoreHorizontal size={15}/></div><div className="meter"><i style={{ width: `${Math.min(100, project.assets.reduce((sum, asset) => sum + (asset.size ?? 0), 0) / (500 * 1048576) * 100)}%` }}/></div><small>{(project.assets.reduce((sum, asset) => sum + (asset.size ?? 0), 0) / 1048576).toFixed(1)} MB on this device</small></div>
        </> : <div className="tool-empty"><span className="tool-empty-icon"><activeToolInfo.icon size={20}/></span><h2>{activeToolInfo.label} workspace</h2><p>{activeTool === 'ai' ? 'Creative assistants will be connected through a separate, provider-neutral job service.' : `Add media to your project to explore ${activeToolInfo.label.toLowerCase()} tools.`}</p><button onClick={() => activeTool === 'ai' ? setNotice('AI provider services are planned for a later phase.') : setActiveTool('media')}>{activeTool === 'ai' ? 'View AI roadmap' : 'Browse project media'}<ChevronDown size={13}/></button><div className="planned-note"><LockKeyhole size={13}/>More capabilities are on the roadmap</div></div>}
      </aside>

      <section className="editor-main">
        <div className="canvas-toolbar"><div className="canvas-select"><span className="canvas-dot"/><span>Canvas</span><span className="toolbar-muted">·</span><button>Portrait 9:16 <ChevronDown size={12}/></button><button className="mobile-import" onClick={() => fileRef.current?.click()}><Upload size={14}/>Import</button></div><div className="canvas-tools"><button className="tool-chip"><Frame size={14}/>Safe area</button><span className="toolbar-separator"/><button className="icon-button tiny" title="Zoom out" onClick={() => setCanvasZoom((value) => Math.max(0.5, value - 0.1))}><ZoomOut size={15}/></button><button className="zoom-value" onClick={() => setCanvasZoom(1)}>{Math.round(canvasZoom * 100)}%</button><button className="icon-button tiny" title="Zoom in" onClick={() => setCanvasZoom((value) => Math.min(1.5, value + 0.1))}><ZoomIn size={15}/></button><button className="icon-button tiny" title="Fit to screen" onClick={() => setCanvasZoom(1)}><Maximize2 size={14}/></button></div></div>
        <div className="preview-stage"><div className="stage-corner top-left"/><div className="stage-corner top-right"/><div className="stage-corner bottom-left"/><div className="stage-corner bottom-right"/><div className="canvas-frame" style={{ transform: `scale(${canvasZoom})` }}><div className="canvas-gradient">{selectedAsset && mediaUrls[selectedAsset.id] ? <div className="media-preview">{selectedAsset.kind === 'video' ? <video ref={videoRef} src={mediaUrls[selectedAsset.id]} playsInline onLoadedMetadata={(event) => updateClipDuration(selectedAsset.id, event.currentTarget.duration)} onTimeUpdate={(event) => setPlayhead(event.currentTarget.currentTime)} onEnded={() => setPlaying(false)}/> : selectedAsset.kind === 'image' ? <img src={mediaUrls[selectedAsset.id]} alt={selectedAsset.name}/> : <div className="audio-preview"><div className="audio-preview-icon"><AudioLines size={25}/></div><strong>{selectedAsset.name}</strong><span>Audio preview</span><audio src={mediaUrls[selectedAsset.id]} controls onLoadedMetadata={(event) => updateClipDuration(selectedAsset.id, event.currentTarget.duration)} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onTimeUpdate={(event) => setPlayhead(event.currentTarget.currentTime)}/></div>}</div> : <><div className="canvas-glow one"/><div className="canvas-glow two"/><div className="canvas-center"><div className="center-mark"><Clapperboard size={21}/></div><span className="canvas-overline">YOUR NEXT STORY</span><strong>Make room<br/>for the <em>moment.</em></strong><span className="canvas-caption">A new canvas is a blank invitation.</span></div></>}<div className="canvas-safe"><span>SAFE AREA</span></div></div></div><div className="preview-hint"><span className="hint-pulse"/>PREVIEW <span className="hint-divider"/> {project.canvas.width} × {project.canvas.height}</div><button className="fullscreen-button" title="Fullscreen preview" onClick={(event) => { const frame = event.currentTarget.parentElement?.querySelector('.canvas-frame'); if (frame?.requestFullscreen) void frame.requestFullscreen(); }}><Maximize2 size={14}/></button></div>
        <div className="transport"><div className="transport-left"><button className="icon-button" title="Go to start" onClick={() => setPlayhead(0)}><span className="skip-start">|◀</span></button><button className="play-button" title="Play / pause · Space" onClick={() => setPlaying(!playing)}>{playing ? <Pause size={16} fill="currentColor"/> : <Play size={16} fill="currentColor"/>}</button><button className="icon-button" title="Step forward"><span className="skip-next">▶|</span></button><span className="transport-time"><strong>{formatTime(playhead)}</strong><span> / {formatTime(duration)}</span></span></div><div className="transport-right"><button className="icon-button" title="Mute preview"><Volume2 size={15}/></button><span className="toolbar-separator"/><button className="icon-button" title="Playback quality"><Gauge size={15}/></button><button className="quality-label">Full quality <ChevronDown size={12}/></button></div></div>
        <section className="timeline">
          <div className="timeline-header"><div className="timeline-title"><span className="eyebrow">SEQUENCE</span><strong>Timeline</strong><span className="timeline-pill">{project.tracks.length} tracks</span></div><div className="timeline-actions">{selectedClip && <><button className="tool-chip" onClick={splitSelectedClip}><Scissors size={14}/>Split</button><button className="icon-button tiny" title="Duplicate clip · Ctrl D" onClick={duplicateSelectedClip}><Copy size={14}/></button><button className="icon-button tiny" title="Delete clip" onClick={deleteSelectedClip}><Trash2 size={14}/></button></>}<button className="icon-button tiny" title="Timeline settings"><Settings2 size={15}/></button><span className="toolbar-separator"/><button className="icon-button tiny" onClick={() => setTimelineZoom((value) => Math.max(0.5, value - 0.1))} title="Zoom out timeline"><ZoomOut size={15}/></button><button className="icon-button tiny" onClick={() => setTimelineZoom((value) => Math.min(1.5, value + 0.1))} title="Zoom in timeline"><ZoomIn size={15}/></button></div></div>
          <div className="timeline-body"><div className="track-labels"><div className="ruler-spacer"><button title="Add track" onClick={() => { const id = crypto.randomUUID(); commit({ ...project, tracks: [...project.tracks, { id, name: `Video ${project.tracks.length + 1}`, kind: 'video', color: '#ad7dff', muted: false, hidden: false, locked: false }] }); }}><Plus size={15}/></button></div>{project.tracks.map((track, index) => <div className="track-label" key={track.id}><span className="track-color" style={{ background: track.color }}/><span className="track-name">{track.name}</span><button title={track.kind === 'audio' ? 'Mute track' : 'Hide track'} onClick={() => commit({ ...project, tracks: project.tracks.map((item, i) => i === index ? { ...item, [item.kind === 'audio' ? 'muted' : 'hidden']: !item[item.kind === 'audio' ? 'muted' : 'hidden'] } : item) })}>{track.kind === 'audio' ? <Volume2 size={13} opacity={track.muted ? .4 : 1}/> : <Square size={12} opacity={track.hidden ? .4 : 1}/>}</button><button title="Lock track" onClick={() => commit({ ...project, tracks: project.tracks.map((item, i) => i === index ? { ...item, locked: !item.locked } : item) })}><LockKeyhole size={12} opacity={track.locked ? 1 : .5}/></button></div>)}</div>
            <div className="timeline-scroll"><div className="timeline-content" style={{ width: `${100 * timelineZoom}%`, minWidth: `${450 * timelineZoom}px` }} onClick={(event) => { const bounds = event.currentTarget.getBoundingClientRect(); setPlayhead(Math.max(0, Math.min(duration, (event.clientX - bounds.left) / bounds.width * duration))); }}><div className="ruler">{rulerMarks.map((mark) => <div key={mark} className="ruler-mark" style={{ left: `${mark / duration * 100}%` }}><i/><span>{formatTime(mark)}</span></div>)}</div>{project.tracks.map((track) => <div className="track-lane" key={track.id}><div className="lane-grid"/>{project.clips.filter((clip) => clip.trackId === track.id).map((clip) => { const asset = project.assets.find((item) => item.id === clip.assetId); if (!asset) return null; return <button className={`clip ${clip.id === selectedClipId ? 'clip-selected' : ''}`} key={clip.id} style={{ left: `${clip.start / duration * 100}%`, width: `${Math.max(8, clip.duration / duration * 100)}%`, borderColor: `${track.color}77`, background: `linear-gradient(100deg, ${track.color}38, ${track.color}20)` }} onClick={() => { setSelectedClipId(clip.id); setSelectedAssetId(asset.id); setNotice(`${asset.name} selected.`); }}><span className="clip-grip"/><span className="clip-icon">{asset.kind === 'audio' ? <AudioLines size={13}/> : <Film size={13}/>}</span><span className="clip-name">{asset.name}</span><span className="clip-wave">{track.kind === 'audio' && Array.from({ length: 25 }, (_, k) => <i key={k} style={{ height: `${20 + Math.abs(Math.sin(k * 2.4)) * 65}%` }}/>)}</span><span className="clip-grip end"/></button>; })}</div>)}<div className="playhead" style={{ left: `${playhead / duration * 100}%` }}><i/></div></div><button className="timeline-add-track" onClick={() => { const id = crypto.randomUUID(); commit({ ...project, tracks: [...project.tracks, { id, name: `Track ${project.tracks.length + 1}`, kind: 'video', color: '#ad7dff', muted: false, hidden: false, locked: false }] }); }}><Plus size={14}/></button></div></div>
            <div className="timeline-footer"><span><Command size={12}/> Click timeline to move playhead</span><span>Snapping <i className="toggle-on"/></span><button onClick={saveDraft}><Cloud size={13}/>Save draft</button></div>
          </section>
      </section>
      <aside className="inspector"><div className="inspector-head"><span className="eyebrow">PROPERTIES</span><button className="icon-button subtle"><MoreHorizontal size={17}/></button></div><div className="inspector-content"><div className="selection-card"><div className="selection-icon"><Frame size={17}/></div><div><strong>Canvas settings</strong><span>Portrait composition</span></div><ChevronDown size={14}/></div><section className="inspector-section"><div className="section-title"><span>FORMAT</span><button className="icon-button subtle"><MoreHorizontal size={15}/></button></div><div className="format-preview"><div className="format-portrait"><span/></div><div className="format-copy"><strong>Portrait 9:16</strong><span>Social video</span><button>Change format <ChevronDown size={12}/></button></div></div><div className="dimension-row"><label>Width<div><input value={project.canvas.width} readOnly/><span>px</span></div></label><span className="dimension-link">↔</span><label>Height<div><input value={project.canvas.height} readOnly/><span>px</span></div></label></div><label className="inspector-select-label">Frame rate<button>{project.canvas.fps} fps <ChevronDown size={13}/></button></label></section><section className="inspector-section"><div className="section-title"><span>CANVAS</span></div><div className="inspector-property"><span>Background</span><button className="color-picker"><i style={{ background: project.canvas.background }}/><span>{project.canvas.background}</span><ChevronDown size={12}/></button></div><div className="inspector-property"><span>Safe margins</span><button className="switch on"><i/></button></div><div className="inspector-property"><span>Background fill</span><button className="switch"><i/></button></div></section><section className="inspector-section layer-summary"><div className="section-title"><span>LAYERS</span><button className="icon-button subtle"><Plus size={15}/></button></div>{project.tracks.map((track) => <div className="layer-row" key={track.id}><span className="track-color" style={{ background: track.color }}/><span>{track.name}</span><button title="Lock layer"><LockKeyhole size={12}/></button></div>)}</section><div className="inspector-tip"><Sparkles size={14}/><span>Select a layer or clip to see its editing controls here.</span></div></div><div className="inspector-bottom"><button><CircleHelp size={14}/>Inspector guide</button><span>⌘ /</span></div></aside>
    </section>
    <footer className="statusbar"><div><span className="status-online"/>Workspace ready</div><span>Frameforge Studio <i>·</i> Draft 1.0</span><button onClick={() => setNotice('Keyboard shortcuts: Space play/pause · ⌘Z undo · ⌘⇧Z redo · ⌘S save')}><CircleHelp size={13}/>Shortcuts</button></footer>
    {accountOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setAccountOpen(false); }}><section className="account-modal" role="dialog" aria-modal="true" aria-labelledby="account-title"><button className="modal-close" aria-label="Close" onClick={() => setAccountOpen(false)}>×</button><div className="modal-mark"><Clapperboard size={18}/></div><span className="eyebrow">FRAMEFORGE ACCOUNT</span><h2 id="account-title">{currentUser ? 'Your workspace' : authMode === 'login' ? 'Welcome back' : 'Create your account'}</h2>{currentUser ? <><p className="modal-description">Signed in as <strong>{currentUser.email}</strong>. Your project can sync to your account.</p><button className="modal-submit" onClick={saveDraft}>Sync this project</button><button className="modal-secondary" onClick={signOut}>Sign out</button></> : <form onSubmit={submitAuth}><p className="modal-description">Sign in to sync your project. Your local draft stays on this device.</p><label>Email address<input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com"/></label><label>Password<input type="password" autoComplete={authMode === 'login' ? 'current-password' : 'new-password'} required minLength={10} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 10 characters"/></label>{authError && <p className="auth-error" role="alert">{authError}</p>}<button className="modal-submit" disabled={authBusy}>{authBusy ? 'Connecting…' : authMode === 'login' ? 'Sign in and sync' : 'Create account'}</button><button type="button" className="modal-secondary" onClick={() => { setAuthError(''); setAuthMode(authMode === 'login' ? 'register' : 'login'); }}>{authMode === 'login' ? 'New to Frameforge? Create account' : 'Already have an account? Sign in'}</button></form>}</section></div>}
    {notice && <div className="toast" role="status"><span>{notice}</span><button onClick={() => setNotice('')}>Dismiss</button></div>}
  </main>;
}
