import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from './App';
import { readMedia, storeMedia } from './mediaStore';
import { makeProject, parseProjectDocument } from './model';
import { renderProjectVideo } from './export';

vi.mock('./mediaStore', () => ({
  storeMedia: vi.fn().mockResolvedValue(undefined),
  readMedia: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('./export', () => ({ renderProjectVideo: vi.fn() }));

describe('editor media and timeline flow', () => {
  it('loads project documents created before effects were introduced', () => {
    const { effects: _effects, ...legacyDocument } = makeProject();
    expect(parseProjectDocument(legacyDocument).effects).toEqual([]);
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
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ id: 'media-server-id', name: 'scene.mp4', mime_type: 'video/mp4', size: 5, created_at: '2026-01-01T00:00:00Z' }),
    } as Response);

    render(<App />);
    const fileInput = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    fireEvent.change(fileInput, { target: { files: [new File(['video'], 'scene.mp4', { type: 'video/mp4' })] } });

    await waitFor(() => expect(screen.getByText(/uploaded to your account/)).toBeTruthy());
    const request = fetchMock.mock.calls[0];
    expect(request[0]).toBe('http://localhost:8000/api/v1/media');
    expect((request[1]?.body as FormData).get('file')).toBeInstanceOf(File);
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
