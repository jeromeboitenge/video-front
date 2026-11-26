# Frameforge Studio (frontend)

React + TypeScript + Vite editor. It talks to the Frameforge API at `VITE_API_URL` (default `http://localhost:8000/api/v1`).

```bash
npm install
npm run dev          # http://localhost:5173
npm test             # Vitest unit/component tests
npm run build        # type check + production build into dist/
npm run test:e2e     # Playwright browser test against a real API, database and renderer
```

`npm run test:e2e` starts its own API (from `../backend/.venv`) on port 8011 and editor on port 5181 with a throwaway database, uploads generated media through the real UI, edits, saves, reloads, reopens, renders MP4/PNG/WAV on the server, and verifies the downloaded files with FFmpeg/Pillow. It uses the installed Google Chrome (`E2E_BROWSER_CHANNEL` to change). See `playwright.config.ts` for PostgreSQL / external-worker options.

Production: build with `VITE_API_URL` set to the public API URL and serve `dist/` as static files with a fallback to `index.html` (see `Dockerfile` and `nginx.conf`).
