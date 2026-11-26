# Frontend development status

Status reflects implemented code and verification evidence from 2026-11-26. The editor talks to the API through `src/studio/api.ts`.

| Feature | Frontend | Verification | Status |
|---|---|---|---|
| Authentication | Login/register, session token, account menu, error messages | Component tests; browser E2E against the real API | Implemented |
| Projects | Local autosave (debounced, flushed on page hide), recovery after refresh, rename, duplicate, new, delete with confirmation; account save/open/delete, cloud autosave, conflict resolution, versions | Component tests; E2E save → refresh → reopen from account → delete | Implemented |
| Media | Import video/image/audio, IndexedDB cache, upload to account, lazy restore, account media browser, delete uploaded copy | E2E upload of MP4/PNG/WAV; component tests | Implemented |
| Video editing | Multitrack timeline, move/trim/split/duplicate/delete, snapping, speed, volume, fades, transforms/keyframes, effects, color, titles/captions with animations, SRT/WebVTT | Component and model tests; E2E split/delete/effect/title | Implemented |
| Image Studio | Image, text and shape layers; reorder, visibility, lock, duplicate; move/resize on canvas; transforms, opacity, blend modes, crop, ellipse mask; text and shape properties | Component tests; E2E text/shape layers persisted and rendered | Implemented |
| Export | Server render panel (MP4/WebM/PNG/JPEG/WebP/M4A/WAV, resolution, quality, audio toggle) uploads local-only media, saves, queues, polls progress, cancels, downloads; browser WebM and PNG export; editable project download | Component tests with mocked API; E2E server renders downloaded and inspected | Implemented |
| AI tools, brushes, selections, retouching | Not implemented (AI panel says so) | — | Planned |

## Verification

```bash
npm test            # 73 tests
npm run build       # type check + production build
npm run test:e2e    # full browser workflow against API, database and renderer
```

## Fixed during this phase

- Saving and refreshing immediately could reopen an older project, because only the 600 ms debounced autosave updated the restore slot. Save now writes it directly, and pending edits are flushed when the page is hidden.
- Browser PNG export cropped image layers from the wrong origin, so the export didn't match the preview.

## Known limitations

- The in-browser WebM exporter renders in real time and depends on browser codec support. It is covered by unit tests, not by the browser E2E (which uses server rendering).
- Text layers in the browser use web fonts (Manrope via Google Fonts); the server falls back to system fonts unless Manrope is installed.
- No multi-select, ripple edits, transition library, masks beyond ellipse, brushes or selections.
