import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import App from './App';
import { ServerExportPanel } from './ServerExportPanel';
import { makeProject } from './model';
import { readMedia } from './mediaStore';

vi.mock('./mediaStore', () => ({ storeMedia: vi.fn().mockResolvedValue(undefined), readMedia: vi.fn().mockResolvedValue(undefined) }));
vi.mock('./waveform', async (importOriginal) => ({
  ...await importOriginal<typeof import('./waveform')>(),
  decodeAudioWaveform: vi.fn().mockResolvedValue({ duration: 4, peaks: [0.1, 0.5] }),
}));

beforeEach(() => {
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:test') });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
  sessionStorage.clear();
});

const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body, blob: async () => new Blob([JSON.stringify(body)]) }) as Response;

describe('image studio text and shape layers', () => {
  it('adds, edits, and persists text and shape layers', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Image Studio' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add text' }));
    expect(await screen.findByRole('img', { name: 'Text 1' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Layer text'), { target: { value: 'Summer sale' } });
    fireEvent.change(screen.getByLabelText('Layer text color'), { target: { value: '#ff0000' } });
    const textLayer = screen.getByRole('img', { name: 'Text 1' });
    expect(within(textLayer).getByText('Summer sale').getAttribute('fill')).toBe('#ff0000');

    fireEvent.click(screen.getByRole('button', { name: 'Add shape' }));
    fireEvent.change(screen.getByLabelText('Layer shape'), { target: { value: 'ellipse' } });
    fireEvent.change(screen.getByLabelText('Layer shape width'), { target: { value: '60' } });
    const shape = screen.getByRole('img', { name: 'Shape 1' }).querySelector('ellipse');
    expect(shape?.getAttribute('rx')).toBe(String(1080 * 0.6 / 2));

    fireEvent.click(screen.getByRole('button', { name: /Save/ }));
    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem('frameforge:last-project') ?? '{}');
      expect(saved.imageLayers).toMatchObject([{ type: 'text', text: 'Summer sale', color: '#ff0000' }, { type: 'shape', shape: 'ellipse', width: 60 }]);
    });
  });
});

describe('server export panel', () => {
  it('asks the user to sign in when there is no session', () => {
    render(<ServerExportPanel project={makeProject()} signedIn={false} saveToCloud={vi.fn()} onProjectChange={vi.fn()} onDownload={vi.fn()}/>);
    expect(screen.getByText(/Sign in from the account menu/)).toBeTruthy();
  });

  it('uploads local media, saves the project, queues a render, polls progress, and downloads the result', async () => {
    sessionStorage.setItem('frameforge:access-token', 'token');
    vi.mocked(readMedia).mockResolvedValue(new Blob(['video'], { type: 'video/mp4' }));
    const project = makeProject();
    project.assets = [{ id: 'local-video', name: 'clip.mp4', kind: 'video', mimeType: 'video/mp4', size: 5 }];
    project.clips = [{ id: 'c', assetId: 'local-video', trackId: 'video-1', start: 0, duration: 2, sourceOffset: 0 }];
    const job = { id: 'job-1', project_id: 'cloud-1', project_revision: 1, kind: 'video', output_format: 'mp4', options: {}, status: 'queued', progress: 0, error: null, output_size: null, output_mime: null, output_name: null, output_info: null, created_at: '', started_at: null, finished_at: null };
    let polls = 0;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/media') && init?.method === 'POST') return json({ id: 'cloud-media-1', name: 'clip.mp4', mime_type: 'video/mp4', size: 5, created_at: '' }, 201);
      if (url.endsWith('/projects/cloud-1/renders') && init?.method === 'POST') return json(job, 202);
      if (url.includes('/renders?project_id=cloud-1')) { polls += 1; return json([polls > 1 ? { ...job, status: 'completed', progress: 1, output_size: 2048, output_name: 'Untitled story.mp4' } : { ...job, status: 'running', progress: 0.5 }]); }
      if (url.endsWith('/renders/job-1/download')) return { ok: true, status: 200, blob: async () => new Blob(['mp4'], { type: 'video/mp4' }) } as Response;
      return json({ detail: `unexpected ${url}` }, 500);
    });
    const saveToCloud = vi.fn().mockResolvedValue({ id: 'cloud-1', name: 'x', document: {}, created_at: '', updated_at: '', revision: 1 });
    const onProjectChange = vi.fn();
    const onDownload = vi.fn();
    render(<ServerExportPanel project={project} signedIn saveToCloud={saveToCloud} onProjectChange={onProjectChange} onDownload={onDownload}/>);

    fireEvent.change(screen.getByLabelText('Server export resolution'), { target: { value: '0.5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Render MP4 on server' }));

    await waitFor(() => expect(saveToCloud).toHaveBeenCalled());
    const saved = saveToCloud.mock.calls[0][0];
    expect(saved.assets[0].cloudId).toBe('cloud-media-1');
    expect(onProjectChange).toHaveBeenCalledWith(saved);
    const renderCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/projects/cloud-1/renders'));
    expect(JSON.parse(String(renderCall?.[1]?.body))).toMatchObject({ kind: 'video', format: 'mp4', resolution: 0.5, quality: 'standard', include_audio: true });

    const download = await screen.findByRole('button', { name: 'Download Untitled story.mp4' }, { timeout: 4000 });
    fireEvent.click(download);
    await waitFor(() => expect(onDownload).toHaveBeenCalledWith(expect.any(Blob), 'Untitled story.mp4'));
  });

  it('shows the server error when a render cannot be queued', async () => {
    sessionStorage.setItem('frameforge:access-token', 'token');
    const project = makeProject();
    project.textOverlays = [{ id: 't', kind: 'title', text: 'Hi', start: 0, duration: 1, position: 'center', fontSize: 60, color: '#ffffff' }];
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({ detail: 'Add a timeline clip, title, or caption before exporting.' }, 422));
    render(<ServerExportPanel project={project} signedIn saveToCloud={vi.fn().mockResolvedValue({ id: 'p', revision: 1 })} onProjectChange={vi.fn()} onDownload={vi.fn()}/>);
    fireEvent.click(screen.getByRole('button', { name: 'Render MP4 on server' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Add a timeline clip');
  });
});
