# Frontend development status

This is the frontend repository. It communicates with the independently deployable API through the versioned client in `src/studio/api.ts`.

| Feature | Frontend | Backend | Database | Tests | Status |
|---|---|---|---|---|---|
| Authentication | Login/register UI, access-token requests, account refresh | Auth endpoints and roles exist | User records | UI/API tests exist; end-to-end runtime not verified here | Partial |
| Project persistence | Local autosave/recovery, cloud list/open/save/delete, project duplication, save/list/restore cloud versions | Owner-scoped project and version endpoints with typed image-layer validation and relational layer synchronization | Project JSON, relational image-layer rows, and version snapshots | UI tests cover cloud open/delete/version restore; backend direct route/database tests pass; HTTP transport remains unverified | Partial |
| Media | Browser import, IndexedDB cache, cloud upload and lazy restore | Authenticated upload/list/content endpoints | Media metadata rows; local-disk file storage | UI/API tests exist | Partial |
| Video editing | Multitrack timeline, move/trim/split, transforms/keyframes, captions, effects, audio controls | No server-side rendering implementation | Editing project document persisted | Focused editor tests and production build pass | Partial |
| Image Studio | Layer stack, direct canvas move, crop insets, transforms, visibility/lock/order, opacity, blend modes, PNG output | Layer contract validates, persists in project documents, and mirrors to relational rows on create/save | Project JSON plus `project_image_layers` projection table | Editor/export and cloud-load tests pass; HTTP transport test remains unverified | Partial |
| Audio/video export | Browser WebM and image PNG renderers | No server render jobs or export download endpoint | No export history records | Renderer tests cover browser output plans | Partial |
| AI, masks, brushes, selection, advanced retouching | Not implemented | No provider or processing services | None | None | Planned |

## Verification

The latest frontend production build passed. Focused editor and export tests passed, including image-layer editing, PNG crop rendering, and cloud project layer restoration. Backend direct route/database tests and Alembic migration pass; HTTP transport is not marked verified because API health requests hang in the current Python runtime.

## Next frontend work

1. Keep cloud project load/save behavior aligned with backend project schemas and error states.
2. Add resize handles and selection workflows to Image Studio, then masks and brush operations with matching export behavior.
3. Integrate server-side export job creation/progress/download once the backend rendering service exists.
4. Add end-to-end tests against a running backend and persistent database.
