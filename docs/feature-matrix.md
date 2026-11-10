# Frameforge feature matrix

This is the product-level status for the two independent Frameforge repositories.
Status describes the current implementation, not the intended product.

## Status definitions

- **Fully implemented and verified:** end-to-end behavior exists and has focused automated coverage.
- **Partially implemented:** a working subset exists; the listed limitations remain.
- **Planned:** no production behavior is available yet.
- **Blocked by external dependency:** the feature needs a provider, service, or deployment dependency that is not configured.

## Product and platform

| Feature | Required behavior | Frontend implementation | Backend implementation | Processing engine / API | Tests | Status and limitations |
|---|---|---|---|---|---|---|
| Independent applications | Deploy UI and API independently | React, TypeScript, Vite app in `frontend/` | FastAPI app in `backend/` | Versioned `/api/v1` HTTP API | Frontend build and API tests | **Fully implemented and verified**; current stack is not Next.js or a monorepo |
| Account authentication | Register, sign in, identify admin role | Sign-in/register and role-aware admin entry | Password hashing, JWT access, persisted admin flag | FastAPI auth routes | API tests | **Partially implemented**; refresh-token rotation, MFA, and account lifecycle features are missing |
| Project management | Create, save, reopen, recover, duplicate, delete, and version projects | Local autosave, cloud open/save/delete, editable local duplication, save/list/restore cloud version controls | Owner-scoped project and version records; relational image-layer projection | Versioned project JSON API with version snapshot/list/restore endpoints | UI tests cover cloud delete and version restore; backend direct-route/database tests cover version restore and layer synchronization | **Partially implemented**; local draft deletion/archive, conflict resolution, and robust cross-device recovery remain missing |
| Media management | Import, validate, store, restore, and delete cloud media | IndexedDB local cache; signed-in upload, lazy restore, and delete-uploaded-copy action that preserves local project media | Authenticated upload, owner-scoped local disk storage, and owner-scoped cloud asset deletion | Typed media API | Existing upload/restore coverage; delete flow has not yet been independently verified | **Partially implemented**; object storage, resumable transfer, proxying, cross-project reference cleanup, and production retention policy are missing |
| Commercial subscriptions | Plans, billing, usage, invoices | No billing UI | No billing service | Payment provider not integrated | None | **Planned** |
| Administration | Operational reports, organizations, approvals, support tickets, audit, settings | Admin workspace and guarded pages | Admin-protected routes and persisted records | Versioned API and database | Admin UI/API tests | **Partially implemented**; no full RBAC, billing operations, or production audit retention policy |

## Video, timeline, and motion

| Feature | Required behavior | Frontend implementation | Backend implementation | Processing engine / API | Tests | Status and limitations |
|---|---|---|---|---|---|---|
| Media import and preview | Import video, image, and audio | Browser decoding and local/cloud media previews | Authenticated media upload | Browser media APIs | UI tests | **Partially implemented**; supported codecs depend on the browser |
| Timeline editing | Multiple tracks, move, trim, split, duplicate, delete, undo | Frame-snapped clip editing, typed track creation, rename/reorder/delete with clip confirmation, track lock/mute/visibility, basic undo/redo | Project JSON persistence | Browser timeline and project API | UI tests | **Partially implemented**; no multi-select, groups, ripple/roll/slip/slide edits, or scalable virtualization |
| Clip transforms | Position, scale, rotation, opacity | Inspector controls and clip-local transform keyframes | Stores project document | Shared preview/export transform model | UI/export tests | **Partially implemented**; no masks, motion paths, easing curves, or transform handles on canvas |
| Playback speed and reverse | Constant/variable speed and reverse playback | Per-clip 0.25×–4× speed control for video and audio; playback-rate preview and duration adjustment | Persists clip speed in the project document | Browser media playback and WebM export use timeline-to-source time mapping | UI, model, and export-plan tests | **Partially implemented**; reverse playback, pitch-preserving audio speed, speed ramps, and variable-speed keyframes are missing |
| Transitions and compositing | Crossfades, transition library, overlays | Per-clip fade in/out and basic layered visual clips | Stores project document | Browser timeline and Canvas export | UI/export tests | **Partially implemented**; not a transition library; no adjustment layers, nested sequences, masks, chroma key, or tracking |
| Color grading and effects | Color controls, filters, lens effects | Per-asset exposure, contrast, saturation, temperature, tint, effect strengths, preview | Persists through project document | Shared CSS filter mapping and Canvas rendering | UI/effect/export tests | **Partially implemented**; no LUTs, curves, scopes, highlights/shadows, denoise, stabilization, or GPU pipeline |
| Video export | Render editable timeline and download video | Real-time browser WebM render, progress, cancellation | No render-job service | Canvas capture, MediaRecorder, Web Audio | Export tests | **Partially implemented**; browser support/runtime limits apply; no FFmpeg, queued background jobs, MP4, preset profiles, or long-render resilience |
| Professional timeline UX | Snapping, timecode, thumbnails, waveforms, context menus | Basic ruler, zoom, tracks, frame snapping, decoded source-offset-aware audio waveforms | None required for local interaction | Browser Web Audio decoding | UI and waveform tests | **Partially implemented**; no thumbnail generation, grouping, track-height controls, context menus, or large-project virtualization |

## Image editing, design, and typography

| Feature | Required behavior | Frontend implementation | Backend implementation | Processing engine / API | Tests | Status and limitations |
|---|---|---|---|---|---|---|
| Photoshop-style image studio | Non-destructive image adjustments and effects with usable image output; later layers, selections, masks, brushes, and blend modes | Dedicated Image Studio with persisted image layers, visibility, locking, ordering, direct canvas move, crop insets, transforms, opacity, four blend modes, and layered PNG output | No image-processing service | Browser Canvas 2D and image decoding | UI and renderer tests | **Partially implemented**; selections, masks, brushes, retouching, resize handles, blend-mode parity across browsers, and advanced adjustments remain missing |
| Graphic design studio | Layouts, shapes, templates, social graphics, PDF/PNG output | Basic title/caption overlays only | No design/template API | No reusable design engine | None | **Planned** |
| Text overlays | Timed title and caption overlays; basic font and color styling | Timed text with font, weight, italic, color, outline, size, and position | Persists project JSON | DOM preview and Canvas export | UI/export tests | **Partially implemented**; no font upload/library, alignment, spacing, gradient, glow, text animation, or shared image/design text engine |
| Captions | Create, import, edit, and export timed subtitles | Manual captions, SubRip import, WebVTT import/export | No speech transcription endpoint | Browser text overlays and subtitle parsers | UI/parser tests | **Partially implemented**; no automatic transcription, word timing, or caption translation |
| Social-media canvases | Presets for major aspect ratios and platform-safe areas | Portrait, landscape, square, 4:5, 4:3, and 3:2 presets; custom bounded dimensions; selectable 24/25/30/50/60 fps; configurable background color; toggleable safe-margin guides | Persists canvas settings and safe-margin preference in the project document | Preview aspect ratio, background color, and export dimensions/frame rate follow project canvas settings | UI/model/export-plan tests | **Partially implemented**; platform-safe export profiles, custom fps entry, and presets beyond the listed common formats are missing |

## Audio, AI, assets, and collaboration

| Feature | Required behavior | Frontend implementation | Backend implementation | Processing engine / API | Tests | Status and limitations |
|---|---|---|---|---|---|---|
| Audio editing and mixing | Multitrack clips, gain, fades, mixing | Audio tracks, decoded waveforms, per-clip volume, fade envelopes, mute, timeline preview/export | Persists clip state | HTML media and Web Audio | UI, waveform, and export tests | **Partially implemented**; no EQ, compression, normalization, pitch, noise reduction, ducking, recording, or extraction UI |
| AI creative tools | Submit and track protected AI jobs | AI panel explicitly reports provider not configured | No job queue or provider adapters | Requires a protected provider and worker service | None | **Blocked by external dependency**; no model keys/service configured and no AI output is generated |
| Templates and asset marketplace | Search, preview, license, apply, manage assets | No template marketplace | No template or licensing API | Storage/catalog service absent | None | **Planned** |
| Collaboration | Shared editing, comments, presence, permissions | No collaboration UI | No membership/real-time collaboration service | WebSocket/event service absent | None | **Planned** |

## Architecture, reliability, and release readiness

| Feature | Required behavior | Frontend implementation | Backend implementation | Processing engine / API | Tests | Status and limitations |
|---|---|---|---|---|---|---|
| Frontend rendering architecture | Workers, WebCodecs, GPU rendering, editor state store | React components and browser Canvas/DOM rendering | Not applicable | No Web Workers, WebCodecs, Zustand, or WebGL pipeline | Type check/build and UI tests | **Partially implemented**; current editor is a browser foundation, not a high-throughput professional render engine |
| Backend processing architecture | Async media/image/audio/render jobs | Polling/job UI not available | FastAPI, SQLAlchemy, local disk storage | No Redis/Celery, FFmpeg/FFprobe, OpenCV, or job API | API tests | **Partially implemented**; heavy work must not be added to request handlers |
| Production storage and database | Durable PostgreSQL and object storage | Uses API media references | PostgreSQL supported; local disk adapter used | No production object-storage adapter | API tests | **Partially implemented**; deployment must configure durable database/media storage |
| Security and privacy | Ownership checks, safe media handling, secret management | Access token held in session storage | Password hashing, protected routes, upload limits, owner scoping | HTTPS/production deployment configuration required | API tests | **Partially implemented**; independent security review, rate limiting, refresh rotation, privacy/retention policies, and production hardening remain |
| Automated quality | Tests, type checks, reliability and performance tests | Vitest and TypeScript build | Pytest | No browser E2E, load, or render compatibility suite | Current unit/API suites | **Partially implemented** |
| Commercial release readiness | Deployment, monitoring, legal review, support, recovery | No production operations UX | No billing/worker/object-store/observability stack | Deployment and legal/commercial providers required | No release acceptance suite | **Planned** |

## Implementation sequence

1. Complete core timeline operations and constant playback speed with preview/export parity.
2. Expand audio editing: waveforms, per-clip EQ, and robust multitrack controls.
3. Build a reusable canvas/layer model before attempting image and design editors.
4. Add editable image layers, masks, selections, and export.
5. Improve rendering with tested export profiles and a background FFmpeg job service.
6. Add transition/effect systems, animation, and advanced timeline operations.
7. Implement provider-neutral AI jobs, templates, collaboration, and commercial services only with their required secure infrastructure.
8. Complete production security, performance, accessibility, browser compatibility, deployment, and acceptance journeys.

Do not upgrade a row to **Fully implemented and verified** without an end-to-end behavior and test evidence. The system is not currently a CapCut, Photoshop, or Canva equivalent and is not yet market-ready.
