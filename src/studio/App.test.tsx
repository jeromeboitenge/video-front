import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from './App';
import { readMedia, storeMedia } from './mediaStore';
import { makeProject, parseProjectDocument } from './model';
import { renderProjectVideo } from './export';
import { decodeAudioWaveform } from './waveform';

vi.mock('./mediaStore', () => ({
  storeMedia: vi.fn().mockResolvedValue(undefined),
  readMedia: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('./export', async (importOriginal) => ({
  ...await importOriginal<typeof import('./export')>(),
  renderProjectVideo: vi.fn(),
}));
vi.mock('./waveform', async (importOriginal) => ({
  ...await importOriginal<typeof import('./waveform')>(),
  decodeAudioWaveform: vi.fn().mockResolvedValue({ duration: 4, peaks: [0.1, 0.5, 0.8, 0.2] }),
}));

describe('editor media and timeline flow', () => {
  it('loads project documents created before effects were introduced', () => {
    const { effects: _effects, ...legacyDocument } = makeProject();
    const { textOverlays: _textOverlays, ...olderDocument } = legacyDocument;
    expect(parseProjectDocument(olderDocument)).toMatchObject({ effects: [], textOverlays: [] });
  });

  it('rejects visual transform values outside supported bounds', () => {
    const project = makeProject();
    project.clips = [{ id: 'clip-1', assetId: 'asset-1', trackId: 'video-1', start: 0, duration: 1, sourceOffset: 0, scale: 8 }];
    expect(() => parseProjectDocument(project)).toThrow('This project document is not a supported Frameforge version.');
  });

  it('accepts legacy clips without keyframes and rejects malformed keyframe sequences', () => {
    const project = makeProject();
    project.assets = [{ id: 'asset-1', name: 'portrait.png', kind: 'image', mimeType: 'image/png', size: 12 }];
    project.clips = [{ id: 'clip-1', assetId: 'asset-1', trackId: 'video-1', start: 0, duration: 2, sourceOffset: 0 }];
    expect(parseProjectDocument(project).clips[0].keyframes).toBeUndefined();

    const keyframe = { time: 0, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 };
    project.clips[0].keyframes = [keyframe, { ...keyframe, time: 0 }];
    expect(() => parseProjectDocument(project)).toThrow('This project document is not a supported Frameforge version.');
    project.clips[0].keyframes = [{ ...keyframe, scale: 10 }];
    expect(() => parseProjectDocument(project)).toThrow('This project document is not a supported Frameforge version.');
  });

  it('creates a timed title and persists it in the project', async () => {
    const project = makeProject();
    project.assets = [{ id: 'asset-1', name: 'portrait.png', kind: 'image', mimeType: 'image/png', size: 12 }];
    project.clips = [{ id: 'clip-1', assetId: 'asset-1', trackId: 'video-1', start: 0, duration: 2, sourceOffset: 0 }];
    localStorage.setItem('frameforge:last-project', JSON.stringify(project));

    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Text' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Title text' }), { target: { value: 'A new chapter' } });
    fireEvent.change(screen.getByLabelText('Font'), { target: { value: 'Georgia' } });
    fireEvent.change(screen.getByLabelText('Text color'), { target: { value: '#ff0000' } });
    fireEvent.change(screen.getByLabelText('Outline width'), { target: { value: '3' } });
    fireEvent.click(screen.getByLabelText('Italic'));
    fireEvent.click(screen.getByRole('button', { name: 'Add title' }));

    expect(await screen.findByText('A new chapter', { selector: '.timeline-text-overlay' })).toBeTruthy();
    const titlePreview = screen.getByText('A new chapter', { selector: '.timeline-text-overlay' }) as HTMLElement;
    expect(titlePreview.style.fontFamily).toBe('Georgia');
    expect(titlePreview.style.fontStyle).toBe('italic');
    expect(titlePreview.style.color).toBe('rgb(255, 0, 0)');
    expect(titlePreview.style.webkitTextStroke).toBe('3px #111111');
    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem('frameforge:last-project') ?? '{}');
      expect(saved.textOverlays?.[0]).toMatchObject({ kind: 'title', text: 'A new chapter', start: 0, duration: 3, fontFamily: 'Georgia', color: '#ff0000', outlineWidth: 3, italic: true });
    });

  });

  it('imports timed SRT captions into the sequence preview', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Captions' }));
    await waitFor(() => expect((screen.getByRole('combobox', { name: 'Position' }) as HTMLSelectElement).value).toBe('bottom'));
    expect((screen.getByRole('spinbutton', { name: 'Size' }) as HTMLInputElement).value).toBe('42');
    const subtitleFile = new File(['1\n00:00:00,000 --> 00:00:02,000\nHello there'], 'captions.srt', { type: 'text/plain' });
    Object.defineProperty(subtitleFile, 'text', { value: async () => '1\n00:00:00,000 --> 00:00:02,000\nHello there' });
    fireEvent.change(document.querySelector<HTMLInputElement>('input[type="file"]')!, { target: { files: [subtitleFile] } });

    expect(await screen.findByText('Hello there', { selector: '.timeline-text-overlay' })).toBeTruthy();
    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem('frameforge:last-project') ?? '{}');
      expect(saved.textOverlays?.[0]).toMatchObject({ kind: 'caption', text: 'Hello there', start: 0, duration: 2 });
    });
  });

  it('applies a fade to the selected timeline clip', async () => {
    const project = makeProject();
    project.assets = [{ id: 'asset-1', name: 'portrait.png', kind: 'image', mimeType: 'image/png', size: 12 }];
    project.clips = [{ id: 'clip-1', assetId: 'asset-1', trackId: 'video-1', start: 0, duration: 2, sourceOffset: 0 }];
    localStorage.setItem('frameforge:last-project', JSON.stringify(project));

    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Transitions' }));
    fireEvent.click(document.querySelector('.clip')!);
    fireEvent.change(screen.getByRole('slider', { name: 'Fade in duration' }), { target: { value: '0.5' } });

    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem('frameforge:last-project') ?? '{}');
      expect(saved.clips?.[0].transitionIn).toBe(0.5);
    });

  });

  it('changes selected clip speed, adjusts timeline duration, and persists the setting', async () => {
    const project = makeProject();
    project.assets = [{ id: 'speed-video', name: 'speed.mp4', kind: 'video', mimeType: 'video/mp4', size: 12 }];
    project.clips = [{ id: 'speed-clip', assetId: 'speed-video', trackId: 'video-1', start: 0, duration: 4, sourceOffset: 0 }];
    localStorage.setItem('frameforge:last-project', JSON.stringify(project));

    render(<App />);
    fireEvent.click(document.querySelector('.clip')!);
    fireEvent.click(screen.getByRole('button', { name: 'Effects' }));
    const speed = await screen.findByRole('slider', { name: 'Video clip speed' });
    expect((speed as HTMLInputElement).value).toBe('1');
    fireEvent.change(speed, { target: { value: '2' } });

    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem('frameforge:last-project') ?? '{}');
      expect(saved.clips[0]).toMatchObject({ speed: 2, duration: 2, sourceOffset: 0 });
    });
  });

  it('updates canvas aspect ratio and frame rate across toolbar and inspector controls', async () => {
    render(<App />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Canvas aspect ratio' }), { target: { value: 'landscape' } });
    expect(screen.getByRole('combobox', { name: 'Inspector canvas preset' })).toHaveProperty('value', 'landscape');
    expect(screen.getByText('Landscape 16:9')).toBeTruthy();
    expect(document.querySelector<HTMLElement>('.canvas-frame')?.style.aspectRatio).toBe('1920 / 1080');

    fireEvent.change(screen.getByRole('combobox', { name: 'Frame rate' }), { target: { value: '60' } });
    expect(screen.getByText('60 fps')).toBeTruthy();

    fireEvent.change(screen.getByRole('spinbutton', { name: 'Canvas width' }), { target: { value: '1280' } });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Canvas height' }), { target: { value: '720' } });
    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem('frameforge:last-project') ?? '{}');
      expect(saved.canvas).toMatchObject({ width: 1280, height: 720, fps: 60 });
    });

    fireEvent.change(screen.getByRole('spinbutton', { name: 'Canvas width' }), { target: { value: '9000' } });
    expect((screen.getByRole('spinbutton', { name: 'Canvas width' }) as HTMLInputElement).value).toBe('1280');
  });

  it('starts a rendered video export and reports completion', async () => {
    const project = makeProject();
    project.assets = [{ id: 'asset-1', name: 'scene.png', kind: 'image', mimeType: 'image/png', size: 12 }];
    project.clips = [{ id: 'clip-1', assetId: 'asset-1', trackId: 'video-1', start: 0, duration: 2, sourceOffset: 0 }];
    localStorage.setItem('frameforge:last-project', JSON.stringify(project));
    vi.mocked(renderProjectVideo).mockImplementation(async (_document, onProgress) => {
      onProgress(0.5);
      return new Blob(['rendered'], { type: 'video/webm' });
    });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /^Export$/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Render video (.webm)' }));

    await screen.findByText('Rendered video downloaded as WebM.');
    expect(renderProjectVideo).toHaveBeenCalledWith(
      expect.objectContaining({ clips: [expect.objectContaining({ id: 'clip-1' })] }),
      expect.any(Function),
      expect.any(AbortSignal),
    );
  });

  it('shows the administrator workspace only after the API confirms admin access', async () => {
    sessionStorage.setItem('frameforge:access-token', 'admin-token');
    sessionStorage.setItem('frameforge:user', JSON.stringify({ id: 'admin-1', email: 'admin@example.com' }));
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      const data = url.endsWith('/auth/me')
        ? { id: 'admin-1', email: 'admin@example.com', is_admin: true }
        : url.endsWith('/admin/dashboard/stats')
          ? { organizations: 2, pending_requests: 1, approved_requests: 3, rejected_requests: 0, users: 18 }
          : [];
      return { ok: true, status: 200, json: async () => data } as Response;
    });

    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Admin' }));

    expect(await screen.findByRole('heading', { name: 'Reports' })).toBeTruthy();
    expect(await screen.findByText('Awaiting approval')).toBeTruthy();
    expect(screen.getByText('18')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Organisation management' }));
    expect(await screen.findByRole('heading', { name: 'Organisation management' })).toBeTruthy();
  });

  it('previews the clip under the playhead and shows gaps when scrubbing', async () => {
    const project = makeProject();
    project.assets = [{ id: 'asset-1', name: 'portrait.png', kind: 'image', mimeType: 'image/png', size: 12 }];
    project.clips = [{ id: 'clip-1', assetId: 'asset-1', trackId: 'video-1', start: 0, duration: 2, sourceOffset: 0 }];
    localStorage.setItem('frameforge:last-project', JSON.stringify(project));

    render(<App />);
    const timeline = document.querySelector<HTMLElement>('.timeline-content')!;
    vi.spyOn(timeline, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 600, bottom: 200, width: 600, height: 200, toJSON: () => ({}) });

    fireEvent.click(timeline, { clientX: 20 });
    const composition = await screen.findByTestId('timeline-composition');
    expect(composition.querySelector('.timeline-media-unavailable')?.textContent).toBe('portrait.png');

    fireEvent.click(timeline, { clientX: 120 });
    expect(await screen.findByText('No visual clip at this time')).toBeTruthy();
  });

  it('moves and trims timeline clips with frame precision and supports undo', async () => {
    const project = makeProject();
    project.assets = [{ id: 'asset-1', name: 'portrait.png', kind: 'image', mimeType: 'image/png', size: 12 }];
    project.clips = [{ id: 'clip-1', assetId: 'asset-1', trackId: 'video-1', start: 2, duration: 4, sourceOffset: 1 }];
    localStorage.setItem('frameforge:last-project', JSON.stringify(project));

    render(<App />);
    const timeline = document.querySelector<HTMLElement>('.timeline-content')!;
    vi.spyOn(timeline, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 600, bottom: 200, width: 600, height: 200, toJSON: () => ({}) });

    fireEvent.pointerDown(screen.getByRole('slider', { name: 'Trim start of portrait.png' }), { pointerId: 1, button: 0, clientX: 100 });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 125 });
    fireEvent.pointerUp(window, { pointerId: 1 });
    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem('frameforge:last-project') ?? '{}');
      expect(saved.clips?.[0]).toMatchObject({ start: 3, duration: 3, sourceOffset: 2 });
    });

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem('frameforge:last-project') ?? '{}');
      expect(saved.clips?.[0]).toMatchObject({ start: 2, duration: 4, sourceOffset: 1 });
    });

    fireEvent.pointerDown(document.querySelector('.clip')!, { pointerId: 2, button: 0, clientX: 100 });
    fireEvent.pointerMove(window, { pointerId: 2, clientX: 125 });
    fireEvent.pointerUp(window, { pointerId: 2 });
    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem('frameforge:last-project') ?? '{}');
      expect(saved.clips?.[0]).toMatchObject({ start: 3, duration: 4, sourceOffset: 1 });
    });
  });

  it('moves clips between compatible tracks and rejects incompatible or locked targets', async () => {
    const project = makeProject();
    project.assets = [{ id: 'video-asset', name: 'scene.mp4', kind: 'video', mimeType: 'video/mp4', size: 12 }];
    project.clips = [{ id: 'video-clip', assetId: 'video-asset', trackId: 'video-1', start: 0, duration: 4, sourceOffset: 0 }];
    project.tracks.push({ id: 'video-locked', name: 'Video locked', kind: 'video', color: '#ad7dff', muted: false, hidden: false, locked: true });
    localStorage.setItem('frameforge:last-project', JSON.stringify(project));

    render(<App />);
    const timeline = document.querySelector<HTMLElement>('.timeline-content')!;
    timeline.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 600, bottom: 200, width: 600, height: 200, toJSON: () => ({}) });
    const lanes = [...document.querySelectorAll<HTMLElement>('.track-lane')];
    lanes[0].getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 600, bottom: 40, width: 600, height: 40, toJSON: () => ({}) });
    lanes[1].getBoundingClientRect = () => ({ x: 0, y: 40, left: 0, top: 40, right: 600, bottom: 80, width: 600, height: 40, toJSON: () => ({}) });
    lanes[2].getBoundingClientRect = () => ({ x: 0, y: 80, left: 0, top: 80, right: 600, bottom: 120, width: 600, height: 40, toJSON: () => ({}) });
    lanes[3].getBoundingClientRect = () => ({ x: 0, y: 120, left: 0, top: 120, right: 600, bottom: 160, width: 600, height: 40, toJSON: () => ({}) });

    fireEvent.pointerDown(document.querySelector('.clip')!, { pointerId: 1, button: 0, clientX: 100, clientY: 20 });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerUp(window, { pointerId: 1 });
    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem('frameforge:last-project') ?? '{}');
      expect(saved.clips?.[0].trackId).toBe('audio-1');
    });

    fireEvent.pointerDown(document.querySelector('.clip')!, { pointerId: 2, button: 0, clientX: 100, clientY: 60 });
    fireEvent.pointerMove(window, { pointerId: 2, clientX: 100, clientY: 60 });
    fireEvent.pointerUp(window, { pointerId: 2 });
    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem('frameforge:last-project') ?? '{}');
      expect(saved.clips?.[0].trackId).toBe('audio-1');
    });

    fireEvent.pointerDown(document.querySelector('.clip')!, { pointerId: 3, button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(window, { pointerId: 3, clientX: 100, clientY: 140 });
    fireEvent.pointerUp(window, { pointerId: 3 });
    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem('frameforge:last-project') ?? '{}');
      expect(saved.clips?.[0].trackId).toBe('audio-1');
    });
  });

  it('creates typed video and audio tracks with unique names and supports undo', async () => {
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'Add audio track' }));
    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem('frameforge:last-project') ?? '{}');
      expect(saved.tracks).toContainEqual(expect.objectContaining({ name: 'Audio 2', kind: 'audio', color: '#eaa65c' }));
    });

    fireEvent.click(screen.getByRole('button', { name: 'Add video track' }));
    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem('frameforge:last-project') ?? '{}');
      expect(saved.tracks).toContainEqual(expect.objectContaining({ name: 'Video 2', kind: 'video', color: '#ad7dff' }));
    });

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem('frameforge:last-project') ?? '{}');
      expect(saved.tracks.some((track: { name: string }) => track.name === 'Video 2')).toBe(false);
      expect(saved.tracks.some((track: { name: string }) => track.name === 'Audio 2')).toBe(true);
    });
  });

  it('renames, reorders, and deletes tracks with their clips through undoable changes', async () => {
    const project = makeProject();
    project.assets = [{ id: 'asset-1', name: 'scene.mp4', kind: 'video', mimeType: 'video/mp4', size: 12 }];
    project.clips = [{ id: 'clip-1', assetId: 'asset-1', trackId: 'video-1', start: 0, duration: 2, sourceOffset: 0 }];
    localStorage.setItem('frameforge:last-project', JSON.stringify(project));

    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Manage tracks' }));

    fireEvent.change(screen.getByRole('textbox', { name: 'Track name Video 1' }), { target: { value: 'Main video' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save track name Video 1' }));
    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem('frameforge:last-project') ?? '{}');
      expect(saved.tracks[0].name).toBe('Main video');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Move Main video down' }));
    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem('frameforge:last-project') ?? '{}');
      expect(saved.tracks[0].id).toBe('text-1');
      expect(saved.tracks[1].name).toBe('Main video');
    });

    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    fireEvent.click(screen.getByRole('button', { name: 'Delete Main video' }));
    expect(confirm).toHaveBeenCalledWith('Delete "Main video" and its 1 clip? You can undo this action.');
    expect(JSON.parse(localStorage.getItem('frameforge:last-project') ?? '{}').clips).toHaveLength(1);

    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'Delete Main video' }));
    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem('frameforge:last-project') ?? '{}');
      expect(saved.tracks.some((track: { name: string }) => track.name === 'Main video')).toBe(false);
      expect(saved.clips).toHaveLength(0);
    });

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem('frameforge:last-project') ?? '{}');
      expect(saved.tracks[1].name).toBe('Main video');
      expect(saved.clips).toHaveLength(1);
    });
  });

  it('adjusts audio clip volume for preview and export and supports undo', async () => {
    render(<App />);
    const fileInput = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    fireEvent.change(fileInput, { target: { files: [new File(['audio'], 'music.mp3', { type: 'audio/mpeg' })] } });
    await waitFor(() => expect(document.querySelector('.clip')).not.toBeNull());

    fireEvent.click(document.querySelector('.clip')!);
    fireEvent.click(screen.getByRole('button', { name: 'Audio' }));
    const volume = await screen.findByRole('slider', { name: 'Clip volume' });
    fireEvent.change(volume, { target: { value: '0.4' } });
    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem('frameforge:last-project') ?? '{}');
      expect(saved.clips?.[0].volume).toBe(0.4);
    });

    const audio = document.querySelector<HTMLAudioElement>('.timeline-composition audio')!;
    fireEvent.loadedMetadata(audio);
    expect(audio.volume).toBe(0.4);

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem('frameforge:last-project') ?? '{}');
      expect(saved.clips?.[0].volume).toBeUndefined();
    });
  });

  it('renders decoded audio peaks in the matching timeline clip', async () => {
    const audioBlob = new Blob(['audio'], { type: 'audio/mpeg' });
    vi.mocked(readMedia).mockResolvedValue(audioBlob);
    vi.mocked(decodeAudioWaveform).mockResolvedValue({ duration: 4, peaks: [0.1, 0.5, 0.8, 0.2] });
    const project = makeProject();
    project.assets = [{ id: 'audio-asset', name: 'music.mp3', kind: 'audio', mimeType: 'audio/mpeg', size: 5 }];
    project.clips = [{ id: 'audio-clip', assetId: 'audio-asset', trackId: 'audio-1', start: 0, duration: 2, sourceOffset: 1 }];
    localStorage.setItem('frameforge:last-project', JSON.stringify(project));

    render(<App />);

    await waitFor(() => expect(decodeAudioWaveform).toHaveBeenCalledWith(audioBlob));
    const waveform = await screen.findByRole('img', { name: 'Waveform for music.mp3' });
    await screen.findAllByTestId('waveform-bar');
    expect(waveform.querySelectorAll('[data-testid="waveform-bar"]')).toHaveLength(36);
    expect(waveform.querySelector('[data-testid="waveform-bar"]')?.getAttribute('style')).toBe('height: 7.5px;');
  });

  it('persists and previews clip position, scale, rotation, and opacity with undo', async () => {
    vi.mocked(readMedia).mockResolvedValue(new Blob(['image'], { type: 'image/png' }));
    const project = makeProject();
    project.assets = [{ id: 'asset-1', name: 'portrait.png', kind: 'image', mimeType: 'image/png', size: 12 }];
    project.clips = [{ id: 'clip-1', assetId: 'asset-1', trackId: 'video-1', start: 0, duration: 2, sourceOffset: 0 }];
    localStorage.setItem('frameforge:last-project', JSON.stringify(project));

    render(<App />);
    fireEvent.click(document.querySelector('.clip')!);
    fireEvent.click(screen.getByRole('button', { name: 'Effects' }));
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Position X' }), { target: { value: '90' } });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Scale' }), { target: { value: '150' } });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Rotation' }), { target: { value: '30' } });
    fireEvent.change(screen.getByRole('slider', { name: 'Clip opacity' }), { target: { value: '0.5' } });

    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem('frameforge:last-project') ?? '{}');
      expect(saved.clips?.[0]).toMatchObject({ x: 90, scale: 1.5, rotation: 30, opacity: 0.5 });
    });
    await waitFor(() => expect(document.querySelector<HTMLImageElement>('.timeline-composition-layer img')?.style.transform).toBe('translate(90px, 0px) rotate(30deg) scale(1.5)'));
    expect(document.querySelector<HTMLElement>('.timeline-composition-layer')?.style.opacity).toBe('0.5');

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem('frameforge:last-project') ?? '{}');
      expect(saved.clips?.[0].opacity).toBeUndefined();
    });
  });

  it('adds and edits frame-snapped visual transform keyframes', async () => {
    vi.mocked(readMedia).mockResolvedValue(new Blob(['image'], { type: 'image/png' }));
    const project = makeProject();
    project.assets = [{ id: 'asset-1', name: 'portrait.png', kind: 'image', mimeType: 'image/png', size: 12 }];
    project.clips = [{ id: 'clip-1', assetId: 'asset-1', trackId: 'video-1', start: 0, duration: 2, sourceOffset: 0 }];
    localStorage.setItem('frameforge:last-project', JSON.stringify(project));

    render(<App />);
    fireEvent.click(document.querySelector('.clip')!);
    fireEvent.click(screen.getByRole('button', { name: 'Effects' }));
    fireEvent.click(screen.getByRole('button', { name: /Add keyframe/ }));
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Position X' }), { target: { value: '90' } });

    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem('frameforge:last-project') ?? '{}');
      expect(saved.clips?.[0].keyframes).toEqual([
        { time: 0, x: 90, y: 0, scale: 1, rotation: 0, opacity: 1 },
      ]);
    });
    expect(document.querySelector<HTMLImageElement>('.timeline-composition-layer img')?.style.transform).toBe('translate(90px, 0px) rotate(0deg) scale(1)');

    fireEvent.click(screen.getByRole('button', { name: 'Remove keyframe' }));
    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem('frameforge:last-project') ?? '{}');
      expect(saved.clips?.[0].keyframes).toHaveLength(1);
    });
  });

  it('applies audio clip fades in the preview and saves them with undo support', async () => {
    render(<App />);
    const fileInput = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    fireEvent.change(fileInput, { target: { files: [new File(['audio'], 'fade.mp3', { type: 'audio/mpeg' })] } });
    await waitFor(() => expect(document.querySelector('.clip')).not.toBeNull());

    fireEvent.click(document.querySelector('.clip')!);
    fireEvent.click(screen.getByRole('button', { name: 'Transitions' }));
    fireEvent.change(screen.getByRole('slider', { name: 'Fade in duration' }), { target: { value: '1' } });
    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem('frameforge:last-project') ?? '{}');
      expect(saved.clips?.[0].transitionIn).toBe(1);
    });

    const audio = document.querySelector<HTMLAudioElement>('.timeline-composition audio')!;
    fireEvent.loadedMetadata(audio);
    expect(audio.volume).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: 'Play / pause · Space' }));
    await waitFor(() => expect(audio.volume).toBeGreaterThan(0));
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem('frameforge:last-project') ?? '{}');
      expect(saved.clips?.[0].transitionIn).toBeUndefined();
    });
  });

  it('advances the sequence playhead when playback starts', async () => {
    const project = makeProject();
    project.assets = [{ id: 'asset-1', name: 'portrait.png', kind: 'image', mimeType: 'image/png', size: 12 }];
    project.clips = [{ id: 'clip-1', assetId: 'asset-1', trackId: 'video-1', start: 0, duration: 1.5, sourceOffset: 0 }];
    localStorage.setItem('frameforge:last-project', JSON.stringify(project));

    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Play / pause · Space' }));
    await screen.findByTestId('timeline-composition');
    await waitFor(() => expect(document.querySelector('.transport-time strong')?.textContent).not.toBe('00:00.0'));
    expect(document.querySelector('.timeline-composition-layer')?.getAttribute('aria-label')).toBe('portrait.png');
  });

  beforeEach(() => {
    vi.mocked(storeMedia).mockResolvedValue(undefined);
    vi.mocked(readMedia).mockResolvedValue(undefined);
    vi.mocked(renderProjectVideo).mockResolvedValue(new Blob(['rendered'], { type: 'video/webm' }));
    Object.defineProperty(window, 'PointerEvent', { configurable: true, value: MouseEvent });
    localStorage.clear();
    sessionStorage.clear();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:frameforge-test') });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
    Object.defineProperty(HTMLMediaElement.prototype, 'pause', { configurable: true, value: vi.fn() });
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it('imports a video, previews it, splits its timeline clip, and undoes the split', async () => {
    render(<App />);
    const fileInput = document.querySelector<HTMLInputElement>('input[type="file"]');
    expect(fileInput).not.toBeNull();
    const video = new File(['video'], 'scene.mp4', { type: 'video/mp4' });
    fireEvent.change(fileInput!, { target: { files: [video] } });

    await waitFor(() => expect(document.querySelector('.asset-row strong')?.textContent).toBe('scene.mp4'));
    await waitFor(() => expect(document.querySelector('.clip')).not.toBeNull());
    expect(document.querySelector('video')).not.toBeNull();

    const timeline = document.querySelector<HTMLElement>('.timeline-content')!;
    vi.spyOn(timeline, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 600, bottom: 200, width: 600, height: 200, toJSON: () => ({}) });
    fireEvent.click(screen.getByRole('button', { name: /scene\.mp4/i }), { clientX: 50 });
    fireEvent.click(timeline, { clientX: 50 });
    fireEvent.click(screen.getByRole('button', { name: /split/i }));
    await waitFor(() => expect(document.querySelectorAll('.clip')).toHaveLength(2));

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    await waitFor(() => expect(document.querySelectorAll('.clip')).toHaveLength(1));
  });

  it('applies adjustable effects to the selected media preview, persists them, and supports undo', async () => {
    render(<App />);
    const fileInput = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    fireEvent.change(fileInput, { target: { files: [new File(['video'], 'grade.mp4', { type: 'video/mp4' })] } });
    await waitFor(() => expect(document.querySelector('.asset-row strong')?.textContent).toBe('grade.mp4'));
    fireEvent.click(screen.getByRole('button', { name: 'Effects' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add Vivid' }));

    const intensity = await screen.findByRole('slider', { name: 'Vivid intensity' });
    const video = document.querySelector('video')!;
    expect(video.style.filter).toBe('saturate(1.4)');
    fireEvent.change(intensity, { target: { value: '75' } });
    expect(video.style.filter).toBe('saturate(1.6)');
    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem('frameforge:last-project') ?? '{}');
      expect(saved.effects?.[0]).toMatchObject({ type: 'vivid', strength: 75, enabled: true });
    });

    fireEvent.click(screen.getByRole('button', { name: 'Disable Vivid' }));
    expect(video.style.filter).toBe('');
    fireEvent.click(screen.getByRole('button', { name: 'Enable Vivid' }));
    expect(video.style.filter).toBe('saturate(1.6)');
    fireEvent.click(screen.getByRole('button', { name: 'Remove Vivid' }));
    expect(video.style.filter).toBe('');
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    await screen.findByRole('slider', { name: 'Vivid intensity' });
    expect(video.style.filter).toBe('saturate(1.6)');

    fireEvent.change(screen.getByRole('slider', { name: 'Exposure' }), { target: { value: '25' } });
    fireEvent.change(screen.getByRole('slider', { name: 'Saturation' }), { target: { value: '-15' } });
    expect(video.style.filter).toBe('brightness(1.25) saturate(0.85) saturate(1.6)');
    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem('frameforge:last-project') ?? '{}');
      expect(saved.colorAdjustments[saved.assets[0].id]).toMatchObject({ exposure: 25, saturation: -15 });
    });
    fireEvent.click(screen.getByRole('button', { name: 'Reset color' }));
    expect(video.style.filter).toBe('saturate(1.6)');
  });

  it('lists and opens an account project while keeping its cloud identity for future saves', async () => {
    sessionStorage.setItem('frameforge:access-token', 'test-token');
    sessionStorage.setItem('frameforge:user', JSON.stringify({ id: 'user-1', email: 'creator@example.com' }));
    const remoteProject = {
      id: 'cloud-project-1',
      name: 'Remote cut',
      document: {
        version: 1,
        project: { id: 'local-remote-id', name: 'Remote cut' },
        canvas: { width: 1080, height: 1920, fps: 30, background: '#151619' },
        tracks: [],
        clips: [],
        assets: [],
        settings: {},
      },
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-02T00:00:00Z',
    };
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/auth/me')) return { ok: true, status: 200, json: async () => ({ id: 'user-1', email: 'creator@example.com', is_admin: false }) } as Response;
      const result = url.endsWith('/projects') ? [remoteProject] : remoteProject;
      return { ok: true, status: 200, json: async () => result } as Response;
    });

    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Untitled story' }));
    fireEvent.click(await screen.findByRole('button', { name: /Remote cut/ }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Remote cut' })).toBeTruthy());
    const projectRequest = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/projects/cloud-project-1'));
    expect(projectRequest).toBeDefined();
    expect(new Headers(projectRequest?.[1]?.headers).get('Authorization')).toBe('Bearer test-token');
    expect(screen.getByText(/Cloud media restores when selected/)).toBeTruthy();
  });

  it('uploads imported media for signed-in users and saves the cloud media reference', async () => {
    sessionStorage.setItem('frameforge:access-token', 'test-token');
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => String(input).endsWith('/auth/me')
      ? { ok: true, status: 200, json: async () => ({ id: 'user-1', email: 'creator@example.com', is_admin: false }) } as Response
      : { ok: true, status: 201, json: async () => ({ id: 'media-server-id', name: 'scene.mp4', mime_type: 'video/mp4', size: 5, created_at: '2026-01-01T00:00:00Z' }) } as Response);

    render(<App />);
    const fileInput = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    fireEvent.change(fileInput, { target: { files: [new File(['video'], 'scene.mp4', { type: 'video/mp4' })] } });

    await waitFor(() => expect(screen.getByText(/uploaded to your account/)).toBeTruthy());
    const request = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/media'));
    expect(request).toBeDefined();
    expect(request?.[0]).toBe('http://localhost:8000/api/v1/media');
    expect((request?.[1]?.body as FormData).get('file')).toBeInstanceOf(File);
    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem('frameforge:last-project') ?? '{}');
      expect(saved.assets?.[0]?.cloudId).toBe('media-server-id');
    });
  });

  it('restores a cloud-backed asset into local media storage when selected', async () => {
    sessionStorage.setItem('frameforge:access-token', 'test-token');
    sessionStorage.setItem('frameforge:user', JSON.stringify({ id: 'user-1', email: 'creator@example.com' }));
    const remoteProject = {
      id: 'cloud-project-2',
      name: 'Cloud media cut',
      document: {
        version: 1,
        project: { id: 'local-cloud-media', name: 'Cloud media cut' },
        canvas: { width: 1080, height: 1920, fps: 30, background: '#151619' },
        tracks: [],
        clips: [],
        assets: [{ id: 'local-asset-id', cloudId: 'server-asset-id', name: 'scene.mp4', kind: 'video', mimeType: 'video/mp4', size: 5 }],
        settings: {},
      },
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-02T00:00:00Z',
    };
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/auth/me')) return { ok: true, status: 200, json: async () => ({ id: 'user-1', email: 'creator@example.com', is_admin: false }) } as Response;
      if (url.endsWith('/projects')) return { ok: true, status: 200, json: async () => [remoteProject] } as Response;
      if (url.endsWith('/projects/cloud-project-2')) return { ok: true, status: 200, json: async () => remoteProject } as Response;
      return { ok: true, status: 200, blob: async () => new Blob(['video'], { type: 'video/mp4' }) } as Response;
    });

    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Untitled story' }));
    fireEvent.click(await screen.findByRole('button', { name: /Cloud media cut/ }));
    await waitFor(() => expect(document.querySelector('.asset-row')).not.toBeNull());
    fireEvent.click(document.querySelector('.asset-row')!);

    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/media/server-asset-id/content'))).toBe(true));
    const contentRequest = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/media/server-asset-id/content'));
    expect(new Headers(contentRequest?.[1]?.headers).get('Authorization')).toBe('Bearer test-token');
    await waitFor(() => expect(storeMedia).toHaveBeenCalledWith('local-asset-id', expect.any(Blob)));
  });
});
