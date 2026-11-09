import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Captions, FileUp, Plus, Sparkles, Trash2 } from 'lucide-react';
import type { TextOverlay, TimelineClip, ToolId } from './model';
import { parseSubRip } from './subtitles';

type CreativeTool = Extract<ToolId, 'text' | 'captions' | 'transitions' | 'ai'>;

export function CreativeToolsPanel({ tool, overlays, playhead, selectedClip, onAddOverlays, onUpdateOverlay, onRemoveOverlay, onSetPlayhead, onTransitionChange }: {
  tool: CreativeTool;
  overlays: TextOverlay[];
  playhead: number;
  selectedClip?: TimelineClip;
  onAddOverlays: (overlays: TextOverlay[]) => void;
  onUpdateOverlay: (overlay: TextOverlay) => void;
  onRemoveOverlay: (id: string) => void;
  onSetPlayhead: (time: number) => void;
  onTransitionChange: (field: 'transitionIn' | 'transitionOut', value: number) => void;
}) {
  const isCaption = tool === 'captions';
  const fileInput = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [start, setStart] = useState(playhead.toFixed(1));
  const [duration, setDuration] = useState('3');
  const [position, setPosition] = useState<TextOverlay['position']>(isCaption ? 'bottom' : 'center');
  const [fontSize, setFontSize] = useState(isCaption ? '42' : '64');
  const [fileError, setFileError] = useState('');
  const [formError, setFormError] = useState('');

  useEffect(() => {
    setText('');
    setStart(playhead.toFixed(1));
    setDuration('3');
    setPosition(isCaption ? 'bottom' : 'center');
    setFontSize(isCaption ? '42' : '64');
    setFileError('');
    setFormError('');
  }, [tool]);

  function addText(event: FormEvent) {
    event.preventDefault();
    const trimmed = text.trim();
    const startTime = Number(start);
    const clipDuration = Number(duration);
    const size = Number(fontSize);
    if (!trimmed) { setFormError('Enter text before adding this overlay.'); return; }
    if (!Number.isFinite(startTime) || startTime < 0) { setFormError('Start time must be zero or greater.'); return; }
    if (!Number.isFinite(clipDuration) || clipDuration <= 0) { setFormError('Duration must be greater than zero.'); return; }
    if (!Number.isFinite(size) || size < 14 || size > 160) { setFormError('Text size must be between 14 and 160.'); return; }
    setFormError('');
    onAddOverlays([{
      id: crypto.randomUUID(),
      kind: isCaption ? 'caption' : 'title',
      text: trimmed,
      start: startTime,
      duration: clipDuration,
      position,
      fontSize: size,
      color: '#ffffff',
    }]);
    setText('');
  }

  async function importSubtitles(file?: File) {
    if (!file) return;
    setFileError('');
    try {
      const imported = parseSubRip(await file.text()).map((overlay) => ({ ...overlay, id: crypto.randomUUID() }));
      onAddOverlays(imported);
      setFileError('');
    } catch (error) {
      setFileError((error as Error).message);
    } finally {
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  function updateTransition(field: 'transitionIn' | 'transitionOut', value: number) {
    onTransitionChange(field, value);
  }

  if (tool === 'ai') return <div className="creative-panel">
    <div className="creative-intro"><span className="eyebrow">AI STUDIO</span><p>AI generation is not connected in this build. No captions or edits are generated behind the scenes.</p></div>
    <div className="creative-info"><Sparkles size={16}/><div><strong>Provider setup required</strong><p>Connect a model provider and protected server-side job service before AI features can run. Keep API keys out of browser storage.</p></div></div>
    <div className="creative-info"><Captions size={16}/><div><strong>Work with captions now</strong><p>Add captions manually or import a SubRip (.srt) file from the Captions workspace.</p></div></div>
  </div>;

  if (tool === 'transitions') {
    const maxDuration = selectedClip ? Math.max(0, Math.min(2, selectedClip.duration / 2)) : 0;
    return <div className="creative-panel">
      <div className="creative-intro"><span className="eyebrow">CLIP TRANSITIONS</span><p>Fade selected visual or audio clips in and out. Fades are included in preview and WebM export.</p></div>
      {!selectedClip ? <div className="creative-empty">Select a video, image, or audio clip in the timeline to adjust its fades.</div> : <>
        <div className="transition-card">
          <strong>Fade in</strong>
          <label htmlFor="transition-in">Duration <output>{(selectedClip.transitionIn ?? 0).toFixed(1)} s</output></label>
          <input id="transition-in" aria-label="Fade in duration" type="range" min="0" max={maxDuration} step="0.1" value={selectedClip.transitionIn ?? 0} onChange={(event) => updateTransition('transitionIn', Number(event.target.value))}/>
        </div>
        <div className="transition-card">
          <strong>Fade out</strong>
          <label htmlFor="transition-out">Duration <output>{(selectedClip.transitionOut ?? 0).toFixed(1)} s</output></label>
          <input id="transition-out" aria-label="Fade out duration" type="range" min="0" max={maxDuration} step="0.1" value={selectedClip.transitionOut ?? 0} onChange={(event) => updateTransition('transitionOut', Number(event.target.value))}/>
        </div>
      </>}
    </div>;
  }

  const shownOverlays = overlays.filter((overlay) => overlay.kind === (isCaption ? 'caption' : 'title'));
  return <div className="creative-panel">
    <div className="creative-intro"><span className="eyebrow">{isCaption ? 'SUBTITLES' : 'TEXT LAYERS'}</span><p>{isCaption ? 'Write captions for your sequence or import a timed SubRip subtitle file.' : 'Add timed titles to the text layer and style them on the canvas.'}</p></div>
    {isCaption && <div className="subtitle-import">
      <input ref={fileInput} type="file" accept=".srt,application/x-subrip,text/plain" hidden onChange={(event) => void importSubtitles(event.target.files?.[0])}/>
      <button className="creative-secondary" onClick={() => fileInput.current?.click()}><FileUp size={14}/>Import .srt</button>
      {fileError && <p className="creative-error" role="alert">{fileError}</p>}
    </div>}
    <form className="creative-form" onSubmit={addText}>
      <label>{isCaption ? 'Caption text' : 'Title text'}<textarea aria-label={isCaption ? 'Caption text' : 'Title text'} value={text} onChange={(event) => setText(event.target.value)} placeholder={isCaption ? 'Type a subtitle…' : 'Type your title…'} maxLength={500} required/></label>
      <div className="creative-form-row">
        <label>Start (seconds)<input type="number" min="0" step="0.1" value={start} onChange={(event) => setStart(event.target.value)} required/></label>
        <label>Duration<input type="number" min="0.1" step="0.1" value={duration} onChange={(event) => setDuration(event.target.value)} required/></label>
      </div>
      <div className="creative-form-row">
        <label>Position<select value={position} onChange={(event) => setPosition(event.target.value as TextOverlay['position'])}><option value="top">Top</option><option value="center">Center</option><option value="bottom">Bottom</option></select></label>
        <label>Size<input type="number" min="14" max="160" step="1" value={fontSize} onChange={(event) => setFontSize(event.target.value)} required/></label>
      </div>
      {formError && <p className="creative-error" role="alert">{formError}</p>}
      <button className="creative-primary" type="submit"><Plus size={14}/>{isCaption ? 'Add caption' : 'Add title'}</button>
    </form>
    <div className="creative-list-heading">{isCaption ? 'CAPTIONS' : 'TITLES'} · {shownOverlays.length}</div>
    {shownOverlays.length ? <div className="overlay-list">{shownOverlays.map((overlay) => <section className="overlay-card" key={overlay.id}>
      <div className="overlay-card-head"><button className="overlay-time" onClick={() => onSetPlayhead(overlay.start)}>{overlay.start.toFixed(1)}s · {overlay.duration.toFixed(1)}s</button><button className="effect-remove" aria-label={`Remove ${isCaption ? 'caption' : 'title'}: ${overlay.text.slice(0, 40)}`} onClick={() => onRemoveOverlay(overlay.id)}><Trash2 size={13}/></button></div>
      <textarea aria-label={`Edit ${isCaption ? 'caption' : 'title'}`} value={overlay.text} onChange={(event) => onUpdateOverlay({ ...overlay, text: event.target.value })}/>
    </section>)}</div> : <div className="creative-empty">Nothing here yet. Add one above.</div>}
  </div>;
}
