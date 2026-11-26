import { defineConfig } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname as dirnameOf } from 'node:path';

const HERE = dirnameOf(fileURLToPath(import.meta.url));

/**
 * End-to-end tests drive the real UI against a real API, database, file storage and FFmpeg renderer.
 * Both servers run on dedicated ports with a throwaway SQLite database and storage directory.
 * E2E_PYTHON points at the backend virtualenv's Python (default: ../backend/.venv/bin/python).
 * E2E_DATABASE_URL overrides the database (e.g. a PostgreSQL URL); E2E_DATA_DIR fixes the storage directory.
 */
const backendDir = resolve(HERE, '../backend');
const python = process.env.E2E_PYTHON ?? join(backendDir, process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python');
// Set once in the runner process; test workers inherit the same directory through the environment.
process.env.E2E_DATA_DIR ??= join(tmpdir(), `frameforge-e2e-${Date.now()}`);
const dataDir = process.env.E2E_DATA_DIR;
mkdirSync(dataDir, { recursive: true }); // web servers start before globalSetup
const apiPort = 8011;
const webPort = 5181;

export default defineConfig({
  testDir: './e2e',
  timeout: 300_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: `http://localhost:${webPort}`,
    channel: process.env.E2E_BROWSER_CHANNEL ?? 'chrome',
    headless: true,
    acceptDownloads: true,
    viewport: { width: 1600, height: 1000 },
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: `"${python}" -m alembic upgrade head && "${python}" -m uvicorn app.main:app --port ${apiPort}`,
      cwd: backendDir,
      url: `http://localhost:${apiPort}/api/v1/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        ENVIRONMENT: 'test',
        DATABASE_URL: process.env.E2E_DATABASE_URL ?? `sqlite:///${join(dataDir, 'e2e.db')}`,
        MEDIA_ROOT: join(dataDir, 'media'),
        RENDER_ROOT: join(dataDir, 'renders'),
        CORS_ORIGINS: `http://localhost:${webPort}`,
        JWT_SECRET: 'e2e-only-secret',
        // Set E2E_RENDER_WORKER=external and run `python -m app.worker` with the same settings to test the standalone worker.
        RENDER_WORKER: process.env.E2E_RENDER_WORKER ?? 'embedded',
      },
    },
    {
      command: `npx vite --port ${webPort} --strictPort`,
      url: `http://localhost:${webPort}`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { VITE_API_URL: `http://localhost:${apiPort}/api/v1` },
    },
  ],
});

export { dataDir, python };
