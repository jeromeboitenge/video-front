# Frontend development status

This is the frontend repository. It communicates with the independently deployable API through the versioned client in `src/studio/api.ts`.

| Feature | Frontend | Backend | Database | Tests | Status |
|---|---|---|---|---|---|
| Authentication | Login/register UI, access-token requests, account refresh | Auth endpoints and roles exist | User records | UI/API tests exist; end-to-end runtime not verified here | Partial |
| Project persistence | Local autosave/recovery, cloud list/open/save/delete, local draft deletion, project duplication, save/list/restore cloud versions, and conflict resolution | Owner-scoped project/version endpoints with typed image-layer validation, relational layer sync, and revision-checked updates | Project JSON, relational image-layer rows, version snapshots, and project revisions | Existing UI tests cover cloud project flows; local draft deletion and revision conflict flows not yet independently verified; HTTP transport remains unverified | Partial |
| Media | Browser import, IndexedDB cache, cloud upload/lazy restore, account media browsing, add cloud media to a project, and delete uploaded copy while preserving local project media | Authenticated upload/list/content/delete endpoints | Media metadata rows; local-disk file storage | Existing UI/API tests cover upload/restore; new cloud browser/add flow not yet independently verified | Partial |
| Video editing | Multitrack timeline, move/trim/split, transforms/keyframes, captions, text styling and alignment, effects, audio controls | No server-side rendering implementation | Editing project document persisted | Existing text coverage; alignment behavior has not yet been verified | Partial |
| Image Studio | Layer stack, direct canvas move, crop insets, transforms, visibility/lock/order, opacity, blend modes, ellipse layer masks, PNG output | Layer contract validates, persists in project documents, and mirrors to relational rows on create/save | Project JSON plus `project_image_layers` projection table; migration 0009 stores masks | Existing image-layer coverage; mask behavior has not yet been verified | Partial |
| Audio/video export | Browser WebM and image PNG renderers | No server render jobs or export download endpoint | No export history records | Renderer tests cover browser output plans | Partial |
| AI, masks, brushes, selection, advanced retouching | Not implemented | No provider or processing services | None | None | Planned |

## Verification

The latest frontend production build passed. Focused editor and export tests passed, including image-layer editing, PNG crop rendering, and cloud project layer restoration. Backend direct route/database tests and Alembic migration pass; HTTP transport is not marked verified because API health requests hang in the current Python runtime.

## Next frontend work

1. Keep cloud project load/save behavior aligned with backend project schemas and error states.
2. Expand Image Studio masks and selection workflows, then add brush operations with matching export behavior.
3. Integrate server-side export job creation/progress/download once the backend rendering service exists.
4. Add end-to-end tests against a running backend and persistent database.
