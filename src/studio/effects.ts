export type EffectId = 'vivid' | 'monochrome' | 'vintage' | 'soft-focus' | 'warm-glow' | 'cool-tone' | 'vignette';
export type AppliedEffect = { id: string; assetId: string; type: EffectId; strength: number; enabled: boolean };
export type EffectDefinition = { id: EffectId; name: string; description: string };
export type ColorAdjustment = { exposure: number; contrast: number; saturation: number; temperature: number; tint: number };

export const defaultColorAdjustment: ColorAdjustment = { exposure: 0, contrast: 0, saturation: 0, temperature: 0, tint: 0 };

export const effectRegistry: EffectDefinition[] = [
  { id: 'vivid', name: 'Vivid', description: 'Boost color intensity.' },
  { id: 'monochrome', name: 'Monochrome', description: 'Fade color toward black and white.' },
  { id: 'vintage', name: 'Vintage', description: 'Add a warm, faded film tone.' },
  { id: 'soft-focus', name: 'Soft focus', description: 'Apply a gentle lens blur.' },
  { id: 'warm-glow', name: 'Warm glow', description: 'Warm the image with a subtle glow.' },
  { id: 'cool-tone', name: 'Cool tone', description: 'Shift the image toward cooler colors.' },
  { id: 'vignette', name: 'Vignette', description: 'Darken the edges of the frame.' },
];

export function effectStyle(effects: AppliedEffect[], assetId: string, adjustment: ColorAdjustment = defaultColorAdjustment): { filter?: string; vignette: number } {
  const filters: string[] = [];
  let vignette = 0;
  if (adjustment.exposure !== 0) filters.push(`brightness(${1 + adjustment.exposure / 100})`);
  if (adjustment.contrast !== 0) filters.push(`contrast(${1 + adjustment.contrast / 100})`);
  if (adjustment.saturation !== 0) filters.push(`saturate(${1 + adjustment.saturation / 100})`);
  if (adjustment.temperature > 0) filters.push(`sepia(${adjustment.temperature / 200})`);
  if (adjustment.temperature < 0) filters.push(`hue-rotate(${adjustment.temperature * 0.6}deg)`);
  if (adjustment.tint !== 0) filters.push(`hue-rotate(${adjustment.tint * 0.45}deg)`);
  for (const effect of effects) {
    if (effect.assetId !== assetId || !effect.enabled) continue;
    const strength = Math.min(100, Math.max(0, effect.strength)) / 100;
    switch (effect.type) {
      case 'vivid':
        filters.push(`saturate(${1 + strength * 0.8})`);
        break;
      case 'monochrome':
        filters.push(`grayscale(${strength})`);
        break;
      case 'vintage':
        filters.push(`sepia(${strength * 0.55})`, `contrast(${1 + strength * 0.12})`);
        break;
      case 'soft-focus':
        filters.push(`blur(${strength * 3}px)`);
        break;
      case 'warm-glow':
        filters.push(`sepia(${strength * 0.3})`, `brightness(${1 + strength * 0.08})`);
        break;
      case 'cool-tone':
        filters.push(`hue-rotate(${-strength * 24}deg)`, `saturate(${1 + strength * 0.15})`);
        break;
      case 'vignette':
        vignette = Math.max(vignette, strength);
        break;
    }
  }
  return { filter: filters.length ? filters.join(' ') : undefined, vignette };
}
