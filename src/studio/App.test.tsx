import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from './App';

vi.mock('./mediaStore', () => ({
  storeMedia: vi.fn().mockResolvedValue(undefined),
  readMedia: vi.fn().mockResolvedValue(undefined),
}));

describe('editor media and timeline flow', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:frameforge-test') });
    Object.defineProperty(HTMLMediaElement.prototype, 'pause', { configurable: true, value: vi.fn() });
  });
  afterEach(() => cleanup());

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
    fireEvent.click(screen.getByRole('button', { name: /split/i }));
    await waitFor(() => expect(document.querySelectorAll('.clip')).toHaveLength(2));

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    await waitFor(() => expect(document.querySelectorAll('.clip')).toHaveLength(1));
  });
});
