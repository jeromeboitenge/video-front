import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { dataDir, python } from '../playwright.config';
import { fileURLToPath } from 'node:url';
import { dirname as dirnameOf } from 'node:path';

const HERE = dirnameOf(fileURLToPath(import.meta.url));

const fixtures = join(dataDir, 'fixtures');
const apiBase = 'http://localhost:8011/api/v1';

function inspect(file: string, ...args: string[]): Record<string, unknown> {
  const output = execFileSync(python, [resolve(HERE, 'media.py'), args.length ? 'frame' : 'inspect', file, ...args], { cwd: resolve(HERE, '../../backend') });
  return JSON.parse(output.toString());
}

async function api<T>(page: Page, path: string): Promise<T> {
  const token = await page.evaluate(() => sessionStorage.getItem('frameforge:access-token'));
  const response = await page.request.get(`${apiBase}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  expect(response.ok()).toBeTruthy();
  return response.json() as Promise<T>;
}

async function serverRender(page: Page, format: string, resolution: string, saveAs: string) {
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Server export format').selectOption({ label: format });
  await dialog.getByLabel('Server export resolution').selectOption(resolution);
  const exports = dialog.getByRole('list', { name: 'Server exports' }).getByRole('button', { name: /^Download / });
  const before = await exports.count();
  await dialog.getByRole('button', { name: /on server$/ }).click();
  // Progress is reported by the server while the job runs; wait for the new finished export.
  await expect(exports).toHaveCount(before + 1, { timeout: 180_000 });
  const downloadPromise = page.waitForEvent('download');
  await exports.first().click();
  const download = await downloadPromise;
  const path = join(dataDir, 'downloads', saveAs);
  await download.saveAs(path);
  await dialog.getByRole('button', { name: 'Close export' }).click();
  return { path, suggested: download.suggestedFilename() };
}

test('a creator edits, saves, reopens and exports a project end to end', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const email = `e2e-${Date.now()}@example.com`;
  const password = 'correct horse battery staple';

  // 1-2. Start the app; a wrong password is rejected, then the user registers.
  await page.goto('/');
  await expect(page.getByRole('button', { name: /Untitled story/ })).toBeVisible();
  await page.getByRole('button', { name: 'Account' }).click();
  await page.getByPlaceholder('you@example.com').fill(email);
  await page.getByPlaceholder('At least 10 characters').fill(password);
  await page.getByRole('button', { name: 'Sign in and sync' }).click();
  await expect(page.getByRole('alert')).toContainText('Email or password is incorrect');
  await page.getByRole('button', { name: 'New to Frameforge? Create account' }).click();
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.locator('.toast')).toContainText(`Signed in as ${email}`);

  // 3. Create/rename the project.
  page.once('dialog', (dialog) => dialog.accept('E2E Story'));
  await page.getByRole('button', { name: /Untitled story/ }).click();
  await page.getByRole('button', { name: 'Rename project' }).click();
  await expect(page.getByRole('button', { name: /E2E Story/ }).first()).toBeVisible();

  // 4-6. Upload a video, an image and audio; they land on the timeline and in the account library.
  await page.locator('input[type=file]').first().setInputFiles([join(fixtures, 'clip.mp4'), join(fixtures, 'photo.png'), join(fixtures, 'tone.wav')]);
  const timeline = page.locator('.timeline-content');
  await expect(timeline.getByRole('button', { name: /clip\.mp4/ })).toHaveCount(1);
  await expect(timeline.getByRole('button', { name: /photo\.png/ })).toHaveCount(1);
  await expect(timeline.getByRole('button', { name: /tone\.wav/ })).toHaveCount(1);
  const media = await api<{ name: string }[]>(page, '/media');
  expect(media.map((item) => item.name).sort()).toEqual(['clip.mp4', 'photo.png', 'tone.wav']);

  // 7. Timeline editing: split the video clip, delete the second half, add an effect and an animated title.
  const videoClip = timeline.getByRole('button', { name: /clip\.mp4/ });
  await videoClip.click(); // selects the clip (and moves the playhead to its start)
  const lane = (await timeline.boundingBox())!;
  const clipBox = (await videoClip.boundingBox())!;
  await timeline.click({ position: { x: clipBox.x - lane.x + clipBox.width / 2, y: 6 } }); // ruler: playhead to mid-clip
  await page.getByRole('button', { name: 'Split' }).click();
  await expect(timeline.getByRole('button', { name: /clip\.mp4/ })).toHaveCount(2);
  await timeline.getByRole('button', { name: /clip\.mp4/ }).nth(1).click();
  await page.getByTitle('Delete clip').click();
  await expect(timeline.getByRole('button', { name: /clip\.mp4/ })).toHaveCount(1);
  await timeline.getByRole('button', { name: /clip\.mp4/ }).click();
  await page.getByRole('button', { name: 'Effects' }).click();
  await page.getByRole('button', { name: 'Add Monochrome' }).click();
  await expect(page.getByRole('button', { name: 'Applied: Monochrome' })).toBeVisible();
  await page.getByLabel('Monochrome intensity').fill('100');
  await page.getByRole('button', { name: 'Text', exact: true }).click();
  await page.getByLabel('Title text').fill('Hello from E2E');
  await page.getByLabel('Text animation').selectOption('fade');
  await page.getByRole('button', { name: 'Add title' }).click();

  // Image editor: add and edit a text layer and a shape layer above the imported photo layer.
  await page.getByRole('button', { name: 'Image Studio' }).click();
  await page.getByRole('button', { name: 'Add text' }).click();
  await page.getByLabel('Layer text', { exact: true }).fill('E2E Poster');
  await page.getByLabel('Layer Y', { exact: true }).fill('-30');
  await page.getByRole('button', { name: 'Add shape' }).click();
  await page.getByLabel('Layer shape', { exact: true }).selectOption('ellipse');
  await page.getByLabel('Layer fill', { exact: true }).fill('#00c853');
  await expect(page.getByRole('img', { name: 'Text 1' })).toContainText('E2E Poster');

  // 8. Save to the account.
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.locator('.toast')).toContainText('saved on this device and to your account');

  // 9-10. Refresh, then reopen the account copy and confirm the editing state survived.
  await page.reload();
  await expect(page.getByRole('button', { name: /E2E Story/ }).first()).toBeVisible();
  await page.getByRole('button', { name: /E2E Story/ }).first().click();
  await page.locator('.cloud-project-row').filter({ hasText: 'E2E Story' }).getByRole('button').first().click();
  await expect(page.locator('.timeline-content').getByRole('button', { name: /clip\.mp4/ })).toHaveCount(1);
  await expect(page.locator('.timeline-content').getByRole('button', { name: /tone\.wav/ })).toHaveCount(1);
  await page.getByRole('button', { name: 'Image Studio' }).click();
  await expect(page.getByRole('button', { name: 'Text 1 Text · E2E Poster' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Shape 1 Shape · ellipse' })).toBeVisible();
  const [saved] = await api<{ name: string; document: { assets: { id: string; name: string }[]; clips: unknown[]; imageLayers: { type: string; text?: string; shape?: string; fill?: string }[]; textOverlays: { animation?: string }[]; effects: { type: string; assetId: string; strength: number; enabled: boolean }[] } }[]>(page, '/projects');
  expect(saved.name).toBe('E2E Story');
  expect(saved.document.clips).toHaveLength(3);
  expect(saved.document.imageLayers.map((layer) => layer.type)).toEqual(['image', 'text', 'shape']);
  expect(saved.document.imageLayers[1].text).toBe('E2E Poster');
  expect(saved.document.imageLayers[2]).toMatchObject({ shape: 'ellipse', fill: '#00c853' });
  expect(saved.document.textOverlays[0].animation).toBe('fade');
  expect(saved.document.effects.map((effect) => effect.type)).toEqual(['monochrome']);
  expect(saved.document.effects[0]).toMatchObject({ strength: 100, enabled: true });
  expect(saved.document.effects[0].assetId).toBe(saved.document.assets.find((asset) => asset.name === 'clip.mp4')?.id);

  // 11-13. Export an edited video (MP4 with audio), an image composition (PNG) and audio, then open and verify them.
  const video = await serverRender(page, 'Video · MP4 (H.264 + AAC)', '0.5', 'story.mp4');
  expect(video.suggested).toBe('E2E Story.mp4');
  const videoInfo = inspect(video.path);
  expect(videoInfo).toMatchObject({ has_video: true, has_audio: true, video_codec: 'h264', audio_codec: 'aac', width: 540, height: 960 });
  expect(Number(videoInfo.duration)).toBeGreaterThan(2);
  expect(Number(videoInfo.mean_volume_db)).toBeGreaterThan(-60);
  expect(Number(inspect(video.path, '1').saturation)).toBeLessThan(5); // monochrome effect on the video clip
  expect(Number(inspect(video.path, '5').saturation)).toBeGreaterThan(60); // the colorful photo clip follows

  const image = await serverRender(page, 'Image · PNG', '0.5', 'poster.png');
  const imageInfo = inspect(image.path);
  expect(imageInfo).toMatchObject({ kind: 'image', format: 'PNG', width: 540, height: 960 });
  expect(imageInfo.center).toEqual([0, 200, 83]); // the green ellipse shape layer is on top at the center

  const audio = await serverRender(page, 'Audio only · WAV', '1', 'mix.wav');
  expect(inspect(audio.path)).toMatchObject({ has_audio: true, has_video: false });

  // 14. Errors are reported: an empty project cannot be rendered.
  await page.getByRole('button', { name: /E2E Story/ }).first().click();
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: /on server$/ }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Add a timeline clip, title, or caption before exporting');
  await page.getByRole('dialog').getByRole('button', { name: 'Close export' }).click();

  // Delete the account project with confirmation.
  await page.getByRole('button', { name: /Untitled story/ }).first().click();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Delete account project E2E Story' }).click();
  await expect(page.getByRole('button', { name: 'Delete account project E2E Story' })).toHaveCount(0);
  expect((await api<unknown[]>(page, '/projects')).some((item) => (item as { name: string }).name === 'E2E Story')).toBe(false);

  expect(errors).toEqual([]);
});
