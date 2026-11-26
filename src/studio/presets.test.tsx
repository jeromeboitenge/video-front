import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { EXPORT_PRESETS, presetAspectWarning, presetResolution, ServerExportPanel } from './ServerExportPanel';
import { makeProject } from './model';

vi.mock('./mediaStore', () => ({ readMedia: vi.fn() }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); sessionStorage.clear(); });
const preset = (id: string) => EXPORT_PRESETS.find((item) => item.id === id)!;
const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body }) as Response;

describe('export presets', () => {
  it('fits the output inside the preset box without upscaling', () => {
    expect(presetResolution(preset('vertical'), 1080, 1920)).toBe(1);
    expect(presetResolution(preset('youtube'), 3840, 2160)).toBe(0.5);
    expect(presetResolution(preset('gif'), 1080, 1920)).toBe(0.25);
    expect(presetResolution(preset('gif'), 1920, 1080)).toBe(0.25);
    expect(presetResolution(preset('thumbnail'), 1920, 1080)).toBe(0.667);
    expect(presetResolution(preset('draft'), 1080, 1920)).toBe(0.5);
  });

  it('warns when the canvas shape does not match the platform', () => {
    expect(presetAspectWarning(preset('vertical'), 1080, 1920)).toBe('');
    expect(presetAspectWarning(preset('youtube'), 1080, 1920)).toContain('expects 16:9');
    expect(presetAspectWarning(preset('gif'), 1080, 1920)).toBe('');
  });

  it('sends GIF and thumbnail preset settings to the render API', async () => {
    sessionStorage.setItem('frameforge:access-token', 'token');
    const project = makeProject();
    project.textOverlays = [{ id: 't', kind: 'title', text: 'Hi', start: 0, duration: 4, position: 'center', fontSize: 60, color: '#ffffff' }];
    const bodies: Record<string, unknown>[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return json({ id: `job-${bodies.length}`, status: 'queued', progress: 0, output_format: 'gif', kind: 'video' }, 202);
    });
    render(<ServerExportPanel project={project} signedIn playhead={1.234} saveToCloud={vi.fn().mockResolvedValue({ id: 'p', revision: 1 })} onProjectChange={vi.fn()} onDownload={vi.fn()}/>);

    fireEvent.change(screen.getByLabelText('Export preset'), { target: { value: 'youtube' } });
    expect(screen.getByRole('note').textContent).toContain('expects 16:9');

    fireEvent.change(screen.getByLabelText('Export preset'), { target: { value: 'gif' } });
    expect(screen.queryByRole('note')).toBeNull();
    expect(screen.getByText(/Output 270×480 · 15 fps/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Render GIF on server' }));
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toMatchObject({ kind: 'video', format: 'gif', resolution: 0.25, fps: 15, include_audio: false });

    fireEvent.change(screen.getByLabelText('Export preset'), { target: { value: 'thumbnail' } });
    fireEvent.click(screen.getByRole('button', { name: 'Export JPEG frame on server' }));
    await waitFor(() => expect(bodies).toHaveLength(2));
    expect(bodies[1]).toMatchObject({ kind: 'frame', format: 'jpeg', quality: 'high', time: 1.234 });
  });
});
