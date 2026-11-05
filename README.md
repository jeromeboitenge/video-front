# Frameforge Studio

React + TypeScript editing workspace. Install Node.js 20+, then run `npm install` and `npm run dev`. Create `.env.local` with `VITE_API_URL=http://localhost:8000/api/v1` if the API runs somewhere else.

The browser keeps project drafts in local storage and media files in IndexedDB. Signed-in imports upload supported media to the API; project documents store those media references, and the browser restores cloud-synced media on demand. Signed-out imports remain device-local. Configure persistent API storage before relying on cloud media across sessions.
