import { describe, expect, it, vi } from 'vitest';
import { makeProject, parseProjectDocument, textOverlayAnimationAt, type ImageLayer, type TextOverlay } from './model';
import { drawVectorLayer } from './export';

vi.mock('./mediaStore', () => ({ readMedia: vi.fn() }));

const base = { visible: true, locked: false, opacity: 1, blendMode: 'normal' as const, x: 0, y: 0, scale: 1, rotation: 0, cropLeft: 0, cropTop: 0, cropRight: 0, cropBottom: 0 };

describe('text and shape image layers', () => {
  it('accepts text and shape layers without an image asset', () => {
    const project = makeProject();
    project.imageLayers = [
      { ...base, id: 't', type: 'text', name: 'Title', text: 'Hello', fontSize: 120, color: '#ffffff' },
      { ...base, id: 's', type: 'shape', name: 'Box', shape: 'ellipse', fill: '#ff0000', width: 30, height: 20 },
    ];
    const parsed = parseProjectDocument(JSON.parse(JSON.stringify(project)));
    expect(parsed.imageLayers.map((layer) => layer.type)).toEqual(['text', 'shape']);
  });

  it('defaults legacy layers to image type and rejects invalid vector layers', () => {
    const project = makeProject();
    project.assets = [{ id: 'img', name: 'a.png', kind: 'image', mimeType: 'image/png', size: 1 }];
    project.imageLayers = [{ ...base, id: 'l', assetId: 'img', name: 'Photo' }];
    expect(parseProjectDocument(JSON.parse(JSON.stringify(project))).imageLayers[0].type).toBe('image');
    const emptyText = { ...project, imageLayers: [{ ...base, id: 't', type: 'text', name: 'Empty', text: '  ' }] };
    expect(() => parseProjectDocument(emptyText)).toThrow();
    const badShape = { ...project, imageLayers: [{ ...base, id: 's', type: 'shape', name: 'Bad', shape: 'triangle' }] };
    expect(() => parseProjectDocument(badShape)).toThrow();
    const badColor = { ...project, imageLayers: [{ ...base, id: 's', type: 'shape', name: 'Bad', shape: 'rectangle', fill: 'red' }] };
    expect(() => parseProjectDocument(badColor)).toThrow();
  });

  it('draws text lines and shapes centered in the layer box', () => {
    const context = { fillText: vi.fn(), beginPath: vi.fn(), rect: vi.fn(), ellipse: vi.fn(), fill: vi.fn(), stroke: vi.fn(), font: '', textAlign: 'left', textBaseline: 'alphabetic', fillStyle: '', lineWidth: 1, strokeStyle: '' } as unknown as CanvasRenderingContext2D;
    drawVectorLayer(context, { ...base, id: 't', type: 'text', name: 'T', text: 'One\nTwo', fontSize: 100, color: '#00ff00' } as ImageLayer, 1000, 500);
    expect(context.fillText).toHaveBeenNthCalledWith(1, 'One', 0, -60);
    expect(context.fillText).toHaveBeenNthCalledWith(2, 'Two', 0, 60);
    expect(context.fillStyle).toBe('#00ff00');
    drawVectorLayer(context, { ...base, id: 's', type: 'shape', name: 'S', shape: 'rectangle', width: 50, height: 20, strokeWidth: 4, stroke: '#123456' } as ImageLayer, 1000, 500);
    expect(context.rect).toHaveBeenCalledWith(-250, -50, 500, 100);
    expect(context.stroke).toHaveBeenCalledOnce();
  });
});

describe('text overlay animation', () => {
  const overlay: TextOverlay = { id: 'o', kind: 'title', text: 'Hi', start: 2, duration: 3, position: 'center', fontSize: 60, color: '#fff' };
  it('is static without an animation', () => {
    expect(textOverlayAnimationAt(overlay, 2)).toEqual({ opacity: 1, offsetY: 0, scale: 1 });
  });
  it('fades, slides and zooms in and out over the first and last half second', () => {
    expect(textOverlayAnimationAt({ ...overlay, animation: 'fade' }, 2).opacity).toBe(0);
    expect(textOverlayAnimationAt({ ...overlay, animation: 'fade' }, 3.5).opacity).toBe(1);
    expect(textOverlayAnimationAt({ ...overlay, animation: 'fade' }, 5).opacity).toBe(0);
    expect(textOverlayAnimationAt({ ...overlay, animation: 'slide-up' }, 2).offsetY).toBeCloseTo(0.06);
    expect(textOverlayAnimationAt({ ...overlay, animation: 'zoom' }, 2).scale).toBeCloseTo(0.6);
    expect(textOverlayAnimationAt({ ...overlay, animation: 'zoom' }, 3).scale).toBe(1);
  });
});
