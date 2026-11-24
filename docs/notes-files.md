# Notes as files (`notes-files.md`)

Design only (2026-11-18); to be built in its own round.

## Context

Notes are rows in SQLite today: `docs(coll = 'notes')` with `content` (markdown) or `scene` (Excalidraw), and `folders` docs for the tree. Files uploaded into the tree are already real files (`DATA_DIR/files/<id>` plus a `files` doc). The wish: notes as **real files on disk**, so that they can be:

- opened and edited with other tools (an editor, Obsidian, `grep`)
- put under git or synced by other means
- kept without being locked into the planner's database

The planner has solved this kind of problem once already. Events and tasks became iCalendar resources (`dav.ts`): **the ics text is the truth, the `events`/`tasks` docs are its projection**, and the client, the API and `types.ts` didn't change. Notes can follow the same pattern: the file is the truth, the `notes` doc is its projection. The generic API, `data.svelte.ts`, the editors and the native iPad app (`native_swift.md`, which talks to the JSON API) stay as they are.

## 1. Layout on disk

```
DATA_DIR/notes/
  Thesis/                     ← project (folder name = project name, made safe for file systems)
    Literature/               ← folder doc
      Related work.md         ← md note
      Architecture.excalidraw ← canvas note (Excalidraw's own JSON, opens in excalidraw.com)
      Chapter 2.deck.md       ← deck note; its cards stay docs (see 3)
  _no project/
    Inbox.md
```

- **Identity**: front matter at the top of every `.md` (`---\nid: …\n---`, plus the planner-only fields: `mail`, `tags`, `category`, …). Canvas files keep `id` in the Excalidraw JSON's `appState`-free top level (`"planner": { "id": … }`). A file without an id (made outside) gets one on the first scan; the planner writes it back.
- Front matter vs. a sidecar index (`notes/.planner.json`). Front matter survives moves done outside and needs no second file, but it is visible to other tools. **Recommendation: front matter**, keeping it small: `id`, and only fields that are set.
- **Names**: title → file name (`/`, `\`, `:` and control characters replaced; collisions get " 2"). Renaming in the planner renames the file. Renaming the file outside changes the title.
- **Folders** are directories. The `folders` docs become their projection too (id in a `.folder.json`, or derived from the path: to decide in M1).

## 2. Server

- `src/lib/server/notefiles.ts` (like `dav.ts`):
  - `write(note)`: put the text after a PATCH or POST.
  - `project(path)`: file → doc, with `put`, so the FTS indexer runs.
  - `scan()`: at startup.
  - `watch()`: outside edits.
- Writes from the API: the generic route calls `changed('notes', id)` already (for dav). A `notes` branch there writes the file:
  - atomically: temp file + rename
  - remembering its mtime/size and hash, so the watcher can tell our own writes from outside ones
- **Watcher**: `fs.watch(…, { recursive: true })` (Bun supports it on Linux), debounced. An outside change is projected with `put`, and the browser is told through a server-sent event (the mail events stream can carry `{ coll: 'notes', id }`). The open editor reloads only if it has no unsaved local draft; otherwise it shows "changed on disk — keep mine / take theirs".
- **Conflicts**: autosave sends `If-Match: <updatedAt>`, the same check `native_swift.md` plans for the iPad app. On a mismatch, `412` plus the current doc.
- **Deletes**: a note deleted in the planner is moved to `DATA_DIR/notes/.trash/` (undo restores it). A file deleted outside removes the doc. Undo then can't bring it back, so only for files that vanished while the planner was running.
- **Backup**: `backup()` today snapshots only `planner.db`. It becomes a `.tar` (or `.zip`) of the db snapshot + `notes/`, or the README says to back up the folder. To be decided.
- **Search**: unchanged (the projection feeds `fts`).

## 3. What stays a doc

- **Cards** of a deck (`cards` docs with FSRS state change on every review, so writing them into a file per answer is churn). The deck file holds the deck's own text only. A later step could export cards as `Q:`/`A:` markdown for reading.
- **Files** of the tree (already files; they could move into the project folders as well, as a second step).
- **Canvas pictures** (`/files/<id>`): the scene refers to them by id, as now.

## 4. Migration

- `scripts/notes-to-files.ts`: writes every note and folder to disk with its id. It is idempotent (an existing file with the same id is left alone) and can run on startup through a check, like `migrate()` in `dav.ts`.
- The docs keep `content`/`scene` during a transition release, so going back is possible. After that, the projection is rebuilt from the files and the stored bodies can be dropped.
- `MIGRATIONS.md` entry with the steps; a `NOTES_DIR` env if the folder should live outside `DATA_DIR` (e.g. inside a git repo).

## 5. Milestones

1. **M1**: one-way export. The planner writes files on every save, and the DB stays the truth. This is already useful (read and grep on disk, git commits) and low-risk.
2. **M2**: the file becomes the truth: startup scan, watcher, projection, ids in front matter.
3. **M3**: conflicts (`If-Match`), trash, backup format, outside renames and moves of folders.
4. **M4** (optional): tree files and deck cards on disk.

## 6. Risks

- Watchers on network or Docker volumes: inotify events may not reach the container for bind mounts on macOS/Windows hosts. Fallback: a periodic scan by mtime.
- Editors that save by "write new + rename" look like delete + create. The scan must pair them by the id in the front matter.
- Two tools writing at once: the planner's autosave every few hundred ms against an outside editor. The `If-Match` check and the draft in `localStorage` keep both sides, but the user has to choose.
- Excalidraw scenes are large. A file per canvas is fine, but reading them all at startup costs time: the scan reads only front matter / ids, bodies on demand.

## 7. Verification

- Unit tests:
  - title ⇄ file name, front matter round trip (`mail` link, tags)
  - scan of a folder made by hand (no ids)
  - watcher: own writes ignored, outside edits projected
  - delete → trash → undo
- Playwright: edit in the planner → file changes; edit the file → the open editor reloads (or asks); rename a folder outside → the tree follows.
