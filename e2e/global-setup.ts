import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { dataDir, python } from '../playwright.config';
import { fileURLToPath } from 'node:url';
import { dirname as dirnameOf } from 'node:path';

const HERE = dirnameOf(fileURLToPath(import.meta.url));

export const fixturesDir = () => join(dataDir, 'fixtures');

export default function globalSetup() {
  mkdirSync(dataDir, { recursive: true });
  execFileSync(python, [resolve(HERE, 'media.py'), 'fixtures', fixturesDir()], { cwd: resolve(HERE, '../../backend'), stdio: 'inherit' });
}
