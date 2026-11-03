# Frameforge Studio

React + TypeScript editing workspace. Install Node.js 20+, then run `npm install` and `npm run dev`. Create `.env.local` with `VITE_API_URL=http://localhost:8000/api/v1` if the API runs somewhere else.

The browser keeps project drafts in local storage and media files in IndexedDB. Account sign-in syncs project documents through the API; source media remains on the device until the media upload API is implemented.
