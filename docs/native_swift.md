# Native iPad app for handwriting (`native_swift.md`)

## Context

Handwriting in the web app goes through Excalidraw in Safari: `PenBar` + `CanvasEditor.svelte` work around missing pinch-zoom, palm handling and undo, and the ink itself (perfect-freehand, simulated or flattened pressure) is far from what the Pencil can do. `plan4.md` asks "native Swift app or is the web app enough?". This plan answers it with a small native iPad app that:

- draws with **PencilKit** (Apple's ink, latency, palm rejection, pressure/tilt, double tap, squeeze, hover all come from the system),
- gives a Noteful-like **infinite canvas** holding strokes, PDFs, images, other files and markdown notes,
- talks to the existing JSON API, so notes live in the same tree and are **viewable in the web app**,
- shows the rest of the planner (calendar, tasks, markdown, review, settings) as the web app in a web view.

Decisions taken with the user:

| Topic   | Decision                                                                                                                                                                            |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Format  | New note type `ink` with its own format; web gets a read-only viewer; the format leaves room for the web to add/move items (not strokes) later. Excalidraw canvases stay untouched. |
| Scope   | Native notes tree + native ink canvas; everything else is the web app in a `WKWebView`.                                                                                             |
| Offline | Notes that were opened are cached; offline edits are queued and sent later. Server gets a version check on save.                                                                    |
| Build   | Mac with Xcode, **free Apple ID**: installs expire after 7 days (re-run from Xcode; app data stays), no TestFlight, so no capabilities that need a paid account (push, iCloud).     |

Guiding rule stays: system frameworks only (PencilKit, PDFKit, WebKit, Vision, URLSession), no third-party Swift packages.

## 1. Data format

`Note.type` gains `'ink'`; the note doc holds the small parts, stroke data lives in blobs.

```ts
// src/lib/ink.ts (new; types + pure helpers shared by viewer and tests)
interface InkDoc {
	v: 1;
	items: InkItem[]; // placed objects, drawn below the strokes, in array order
	tiles: Record<string, string>; // "<tx>,<ty>" → file id of that tile's strokes
	text?: string; // recognised handwriting, for search
}
type InkItem = { id: string; x: number; y: number; w: number; h: number } & (
	| { kind: 'image'; fileId: string }
	| {
			kind: 'pdf';
			fileId: string;
			pdf: { gid: string; page: number; w: number; h: number; layout: PdfLayout };
	  }
	| { kind: 'note'; noteId: string } // md note, shown as a card
	| { kind: 'file'; fileId: string } // any other media: preview / player / icon
	| { kind: 'text'; text: string } // typed markdown text box
);
// tile blob (application/json at /files/<id>)
interface InkTile {
	v: 1;
	strokes: InkStroke[];
}
interface InkStroke {
	id: string;
	ink: string; // PencilKit ink type: pen | pencil | marker | monoline | fountainPen | …
	color: string; // #rrggbbaa
	t?: [number, number, number, number, number, number]; // affine transform, if not identity
	pts: number[]; // flat control points: x, y, w, h, opacity, force, azimuth, altitude, time
	mask?: string; // SVG path, only if the bitmap eraser left one (see M0)
}
```

- **Units**: points, y down, origin anywhere (negative coordinates allowed).
- **Tiles**: 1024 pt grid; a stroke belongs to the tile of its bounding box's top-left corner. Tiles are storage units only (the app loads all of a note's tiles into one `PKDrawing`); they keep a save small (only changed tiles are uploaded, the note PATCH carries ids) and let the web viewer load what is visible.
- **Tile blobs are immutable**: a changed tile is uploaded under a new id and the old file is deleted after the note PATCH succeeded. That fits `/files/[id]`'s `immutable` cache header and makes uploads idempotent retries.
- `pts` are PencilKit's B-spline control points (`PKStrokePath`), so the app rebuilds strokes without loss; `w/h` already contain the pressure effect, so the web doesn't need to know PencilKit's ink model.
- **PDFs** are stored once as the original file (not page JPEGs as in Excalidraw canvases): PDFKit draws them sharp at any zoom, the web uses the existing `pdfjs-dist`. Page placement reuses `PdfLayout`/`pdfLayout()` from `src/lib/canvas.ts` unchanged (same `pdf` shape as `customData.pdf`).

## 2. Server and web app changes (this repo)

Small and backwards compatible; old data needs no conversion.

1. `src/lib/types.ts`: `type: 'md' | 'canvas' | 'deck' | 'ink'`, `ink?: InkDoc`.
2. `src/routes/api/[coll]/[id]/+server.ts`: **version check**. `PATCH` with header `If-Match: <updatedAt>` answers `412` plus the current doc when it differs. No header = today's behaviour, so the web client is unaffected.
3. `src/lib/data.svelte.ts`: notes are loaded with `omit=content,scene`; add `ink`.
4. `src/lib/server/db.ts` `indexers.notes`: body of an ink note = `ink.text` + text items.
5. `src/lib/ink.ts`: types, `tileOf()`, `outline(stroke)` (variable-width outline from `pts` via `perfect-freehand`, which is already in the tree through Excalidraw; add it as a direct devDependency), `InkDoc` merge helper used later for web item editing.
6. `src/lib/components/notes/InkViewer.svelte` (read-only): one transformed layer; pan/zoom with wheel + `touchMove()` from `canvas.ts`; items as DOM (`<img>`, pdfjs page canvases rendered when visible, `<iframe src="/embed/note/<id>">` for md notes, `<iframe>`/`<video>`/link for files); strokes as one `<svg>` per visible tile (marker ink = low opacity + `mix-blend-mode: multiply`). Refetches the note on tab focus.
7. Wire-up: `notes/[id]/+page.svelte` (render `InkViewer`, no type toggle for ink), `FileIcon`/`FolderTree` icon, `NewNoteMenu` ("Ink note", creates an empty one), `embed/note/[id]` (ink note → its `text`), `CommandPalette` needs nothing (it goes by collection).
8. **Native shell hooks** (only active inside the app, detected by `window.webkit?.messageHandlers?.planner`): `(app)/+layout.svelte` hides `AppSidebar`; opening an ink note posts `{ open: id }` to the app instead of showing the viewer.
9. Docs: `MIGRATIONS.md` entry (new optional type and field, nothing to convert, replaced/deleted ink notes leave no orphan tiles but deleted notes keep their files like canvases do), `CLAUDE.md` architecture section, `README.md` paragraph on the app.
10. Tests: `tests/server.test.ts` (412 path), `tests/logic.test.ts` (`tileOf`, `outline`), fixtures in `tests/fixtures/ink/` that the Swift tests read too.

## 3. The app (`ios/`)

```
ios/
  Planner.xcodeproj            app target, iPadOS 17+, Swift 6, SwiftUI lifecycle
  PlannerKit/                  local Swift package, Foundation only (also testable with `swift test` on Linux)
    Models.swift               Codable: Project, Folder, NoteMeta, InkDoc, InkItem, InkTile, InkStroke, FileMeta
    API.swift                  list/get/post/patch(ifMatch)/delete/upload/file over URLSession
    Tiles.swift                tileOf, bucket strokes → tiles, digest per tile
    Merge.swift                3-way merge of InkDoc + tiles (base, local, remote)
    PdfLayout.swift            port of pdfLayout() (same fixtures as the TS tests)
    Store.swift                on-disk cache + outbox
  App/
    PlannerApp.swift, Session.swift       server URL, login state, reachability
    Sidebar.swift                         notes tree + Calendar / Tasks / Review / Settings entries
    WebScreen.swift                       WKWebView on the web app, message bridge
    InkScreen.swift, InkCanvas.swift      PKCanvasView wrapper, item layer, tool picker
    Items/                                ImageItem, PdfItem (PDFKit), NoteItem, FileItem, TextItem
    StrokeCoding.swift                    PKStroke ⇄ InkStroke
```

**Auth**: the first launch asks for the server URL and opens it in the web view; Authelia's login happens there. The session cookie is copied from `WKHTTPCookieStore` to `HTTPCookieStorage.shared` (and kept in sync), so `URLSession` calls pass the proxy. A 401 or a redirect to the Authelia host from the API brings the login sheet back; unsent edits stay in the outbox meanwhile.

**Shell**: `NavigationSplitView`. Sidebar = projects → folders → notes and tree files (from `/api/projects|folders|files` and `/api/notes?omit=content,scene,ink`, cached for offline). Ink notes open natively; every other item and the Calendar/Tasks/Review/Settings entries load the matching web route in one shared `WKWebView` (`applicationNameForUserAgent = "PlannerApp"`). The bridge message `{ open: id }` from the web (search palette, project links) switches to the native canvas. Create/rename/move/delete of ink notes in the tree use the generic API.

**Canvas**:

- `PKCanvasView` (a `UIScrollView`), `drawingPolicy = .pencilOnly`: the Pencil draws, fingers pan and pinch-zoom, palm rejection is the system's. A toggle allows finger drawing.
- Infinite: a very large fixed content area with the document origin in its centre (M0 checks PencilKit's behaviour at that size; fallback is a content area that grows and shifts the drawing).
- Item layer: a view below the transparent canvas that follows its offset and zoom; PDF pages are tiled layers drawn by `PDFPage.draw`, images are image views, md notes are cards showing a cached snapshot of `/embed/note/<id>` (tapping one makes it a live web view, so the note is edited with the real markdown editor), other files use QuickLook thumbnails and open in QuickLook.
- Tools: `PKToolPicker` (pens, pencil, marker, fountain pen, eraser, lasso, ruler, colours). Double tap, Pencil Pro squeeze and hover preview are handled by it according to the system settings; `UIPencilInteraction` is only added if a custom double-tap action is wanted.
- A "select" mode moves, resizes and deletes items; selecting a PDF group shows the layout panel (column / spread / row, scale, gap) and strokes lying on a page move along, as on the web.
- Insert: Files picker (PDF, images, anything), Photos, camera/document scanner, drag and drop from other apps, and "Embed note" (note picker over the cached tree).
- Undo/redo: PencilKit's `UndoManager`, item operations registered on the same one; three-finger gestures work as in Notes.

**Saving** (debounced ~2 s, and on background/close): strokes are bucketed into tiles, tiles with a changed digest are written locally and queued; new media files are queued under their client-generated ids; then the note is PATCHed (`{ ink }`, `If-Match`). Local write first, network second.

**Offline and conflicts**: per opened note the store keeps the last server version (base), the local version and the files. The outbox is replayed when `NWPathMonitor` reports a connection and on foreground. On `412` the app fetches the remote doc and merges three ways: items by id, tiles by key; a tile changed on both sides is merged per stroke id (local deletions since base are respected, local wins on the same stroke). Notes created offline get a client id and are POSTed later. A cached note whose `updatedAt` in the list differs is refreshed on open. Notes never opened are not available offline.

**Search**: after a save, changed tiles are rendered to an image and run through Vision text recognition; the joined result goes to `ink.text`, so handwriting is found by the planner's search.

## 4. Milestones

| #     | Content                                                                                                                                                                                                                                                                                          | Done when                                                                 |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| M0    | Spikes on the Mac: huge `PKCanvasView` content + item layer under it while zooming; `PKStroke` → JSON → `PKStroke` round trip (all inks, lasso moves, bitmap eraser: does it leave masks?); cookie hand-over through Authelia; perfect-freehand outline of PencilKit points next to a screenshot | Each question has a yes/no and the format in §1 is confirmed or adjusted  |
| M1    | Server + format (§2, items 1–5, 9, 10)                                                                                                                                                                                                                                                           | `bun run check && bun test && bun run build`                              |
| M2    | Web viewer + wire-up (§2, items 6–8)                                                                                                                                                                                                                                                             | A hand-made fixture note shows in the browser, light and dark             |
| M3    | App skeleton: server URL, login, API, tree, web screens, bridge                                                                                                                                                                                                                                  | Tree matches the web app; calendar usable inside the app                  |
| M4    | Ink canvas online: draw, tools, tiles, save/load                                                                                                                                                                                                                                                 | A note written on the iPad shows in the web viewer after a reload         |
| M5    | Items: images, PDF with layout, md note cards, files, text boxes                                                                                                                                                                                                                                 | Annotated PDF looks the same on both sides                                |
| M6    | Offline cache, outbox, 412 merge                                                                                                                                                                                                                                                                 | Write in flight mode, reconnect, nothing lost; edit on two devices merges |
| M7    | Handwriting search, PDF/image export of a note, polish                                                                                                                                                                                                                                           | Search for a handwritten word finds the note                              |
| Later | Web editing of items (add/move/resize/delete, PATCH with `If-Match`)                                                                                                                                                                                                                             | –                                                                         |

## 5. Risks and open points

- **No Mac in this dev environment**: the Swift code is written here but can only be built in Xcode. `PlannerKit` is Foundation-only so its tests run here with `nix shell nixpkgs#swift -c swift test`; everything UI is verified on the Mac/iPad (or the sessions for M0 and M3–M7 run on the Mac).
- **Free Apple ID**: weekly re-install from Xcode; if that gets tiring, a paid account changes nothing in the code.
- **Look on the web** differs from PencilKit (textured pencil, marker blending). If that matters, the fallback is a PNG per tile uploaded by the app beside the vector data.
- **PencilKit limits**: zoom range and re-render behaviour of very large drawings; M0 decides whether one `PKDrawing` per note holds or the visible region has to be windowed.
- **Server must be reachable over HTTPS** (App Transport Security); plain HTTP only works for local-network addresses with `NSAllowsLocalNetworking`.
- Deleting an ink note leaves its tile and media files in `DATA_DIR/files`, as canvas notes do today (undo on the web needs them); a `scripts/gc-files.ts` can follow if it adds up.

## 6. Verification

- Repo: `nix develop -c bun run check && bun test && bun run build`; Playwright run against a scratch `DATA_DIR` (port ≠ 5199, `127.0.0.1`): fixture ink note renders, pans/zooms, PDF page and embedded md note appear, tree shows the new type, search finds `ink.text`, PATCH with a stale `If-Match` returns 412.
- `PlannerKit`: `swift test` (tiles, merge, pdfLayout, model decoding against `tests/fixtures/ink/`), runnable on NixOS.
- iPad (manual, per milestone): pressure/tilt strokes, palm resting while writing, double tap and squeeze, finger pan/zoom during writing, insert PDF + relayout, edit an embedded md note, flight-mode edit then sync, same note open in the browser shows the result after focus.
