import { describe, expect, it } from 'vitest';
import { defaultColorAdjustment, effectStyle } from './effects';
import { makeProject, parseProjectDocument } from './model';

describe('non-destructive color grading', () => {
  it('combines adjustments and enabled effects into a shared preview/export filter', () => {
    const project = makeProject();
    project.assets = [{ id: 'asset-1', name: 'shot.mp4', kind: 'video', mimeType: 'video/mp4', size: 12 }];
    project.effects = [{ id: 'effect-1', assetId: 'asset-1', type: 'vivid', strength: 50, enabled: true }];
    const adjustment = { ...defaultColorAdjustment, exposure: 20, contrast: -10, saturation: 30, temperature: 40, tint: -20 };

    expect(effectStyle(project.effects, 'asset-1', adjustment)).toEqual({
      filter: 'brightness(1.2) contrast(0.9) saturate(1.3) sepia(0.2) hue-rotate(-9deg) saturate(1.4)',
      vignette: 0,
    });
    expect(effectStyle(project.effects, 'asset-1', defaultColorAdjustment).filter).toBe('saturate(1.4)');
    expect(effectStyle(project.effects, 'another-asset', adjustment)).toEqual({
      filter: 'brightness(1.2) contrast(0.9) saturate(1.3) sepia(0.2) hue-rotate(-9deg)',
      vignette: 0,
    });
  });

  it('loads legacy projects with neutral color adjustments and rejects invalid adjustment values', () => {
    const project = makeProject();
    project.assets = [{ id: 'asset-1', name: 'shot.png', kind: 'image', mimeType: 'image/png', size: 12 }];
    const { colorAdjustments: _colorAdjustments, ...legacyProject } = project;
    expect(parseProjectDocument(legacyProject).colorAdjustments).toEqual({});

    project.colorAdjustments = { 'asset-1': { ...defaultColorAdjustment, exposure: 101 } };
    expect(() => parseProjectDocument(project)).toThrow('This project document is not a supported Frameforge version.');
    project.colorAdjustments = { missing: defaultColorAdjustment };
    expect(() => parseProjectDocument(project)).toThrow('This project document is not a supported Frameforge version.');
  });
});
