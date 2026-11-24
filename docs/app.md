# app.md: What is in the Planner (UI inventory)

This file lists **what the app contains**: every view, region, control, state, dialog and interaction a UI has to provide. It says nothing on colors, typography, spacing or style. Where it names a control type (switch, select, popover…), that is the kind of input the data needs, not a visual decision.

Labels in quotes are the current wording of the app.

---

## 1. Scope and platform

- Single user, no login screen in the app. A reverse proxy authenticates. The app only shows a "Session expired" notice when the proxy's session runs out.
- Built for desktop first. It also has to work on an **iPad with a pencil**: touch input, no hover, often no keyboard, sometimes no fullscreen.
- Light and dark themes, with a toggle.
- One page app with these top-level areas: **Calendar, Tasks, Notes, Review (flashcards), Stats, Settings, Project pages**. `/` opens the Calendar.
- Global features: project focus filter, search/command palette, undo/redo, focus mode, pomodoro timer, browser reminders.

---

## 2. Data the UI shows and edits

All fields are optional unless marked. "Color" means a user-chosen marker color (projects, categories, feeds).

| Entity | Fields shown/edited in the UI |
|---|---|
| **Project** | name\*, color, icon (any lucide icon, or none = default folder icon), archived, group (free name), pinned links `{title, url}` (web address or a link inside the app) |
| **Folder** | name, parent folder, project |
| **Category** | name\*, color\* |
| **Event** | title\*, start\*, end, all-day, repeat rule, skipped dates, **further times** (each with its own start/end/repeat), tentative, category, project, tags, location, description |
| **Task** | title\*, status (`todo, doing, waiting, done, cancelled` or none), priority (`urgent, high, medium, low` or none), start, end, deadline (date only), estimate (minutes), repeat rule, parent task (subtasks, nested to any depth), project, category, tags, reminders (list of date-times), description, created at, completed at |
| **Note** | title\*, type (`md` markdown / `canvas` drawing / `deck` flashcards), body, folder, project, daily date (for daily notes), tags, card template (decks) |
| **File** | name, MIME type, size; either sits in the notes tree (project + folder) or is an attachment inside a note or canvas |
| **Flashcard** | deck, front and back (Typst markup), next due date, review stats (number of reviews, lapses) |
| **External calendar (feed)** | name, type (`ICS / webcal URL` or `CalDAV`), URL, username, password, color, enabled, show (`Only in "All projects"` / `Always` / `Chosen projects` + project list), keep past events, last sync time, last error |
| **External event** | read-only: title, start, end, all-day, location, description, tentative, source feed |
| **Pomodoro session** | start, end, minutes, task, project (recorded automatically) |
| **Settings** | pomodoro lengths (focus, short break, long break, long break every N), first day of week (Mon/Sun/Sat), daily note template, flashcard template, pen presets (canvas) |

Derived states the UI has to tell apart:
- Task: **open** vs **done/cancelled**; **inbox** = open, top level, and no start, end, deadline, priority, status or reminders; **overdue / today / upcoming / unscheduled**.
- Event: **recurring** or not; **tentative**; **draft** (new, not saved yet); belongs to one of several **times**.
- Item colour comes from its category, else its project, else none (neutral).
- Flashcard: **new**, **due**, **to repeat** (answered "Again", back within 20 minutes), **not due**.
- Project: **archived**, **focused**.

---

## 3. App shell

```
┌──────────────┬────────────────────────────────────────────┐
│ Sidebar      │ Main area (current view)                   │
│ (collapsible │                                            │
│  to icons)   │                                            │
└──────────────┴────────────────────────────────────────────┘
+ overlays: command palette, task editor sheet, event editor sheet,
  choice/confirm/prompt dialog, shortcut help, toasts, drag ghost
```

### 3.1 Sidebar
Can collapse to an icon rail. In that state only icons show, with tooltips and the shortcut ("Calendar (g c)").

**Header**
- Search button: opens the command palette and shows the hint "Ctrl K".
- **Project focus selector**: "All projects" plus every project that isn't archived (an archived project stays listed while it is the focused one). Hidden while the sidebar is collapsed.

**Navigation** (icon + label + active state)
- Calendar, Tasks (badge: number of inbox tasks), Notes, Review (badge: number of due cards), Stats, Settings.

**Projects section**
- Section label "Projects" with a "+" action ("New project": asks for a name, then opens the project page).
- Projects without a group first, sorted by name.
- Then one **collapsible group** per group name (chevron + group name); its projects are indented.
- Then the collapsible **"Archived"** group (closed by default).
- Each project row: project icon tinted with the project colour + name; active state when its page is open.

**Footer**
- **Pomodoro widget**: phase label ("Focus" / "Break" / "Long break"), countdown mm:ss, start/pause button, reset button, and a task selector underneath ("No task" or any open task) to track time against.
- Button row: Undo (disabled when nothing to undo), Redo (disabled likewise), Focus mode, Theme toggle, Collapse sidebar.

### 3.2 Focus mode
- Hides the app sidebar and every view's side panels (notes tree, calendar task pane), goes fullscreen where it can and mutes reminders.
- Leaves on `f`, on leaving fullscreen, or through a faint **"x" button in the top right corner** (needed on iPad).

### 3.3 Loading / failure
- Full-screen "Loading…" while all data loads at start.
- Full-screen "Could not load data: <message>" on failure.

### 3.4 Toasts (bottom right)
- Request failed (status + server text).
- "Session expired" (stays until dismissed, with a "Reload" action, text: unsaved changes are kept locally).
- Reminder fired ("⏰ <task title>" + time).
- Pomodoro finished / break over.
- Backup download failed.
- Reminders and pomodoro also send a system notification while the tab is in the background.

---

## 4. Shared controls (have to be designed once, used everywhere)

The app uses **no native browser pickers or dialogs** (except the OS file chooser).

| Control | Content / behaviour |
|---|---|
| **Select** | Single choice from a list; an empty value means "None"/"—"; shows a placeholder when empty. A multi-select variant exists (feed → chosen projects). |
| **Date input** | Button with the formatted date ("Wed 14 Nov 2026") or "No date" → popover with a month calendar (respects first day of week) and a "Clear" action. Date-time values also get a **24-hour time field** (hour/minute segments) beside it; saved when the field loses focus or on Enter. Date-only variant without time. |
| **Color picker** | Round swatch button → popover with: 16 preset swatches, up to 8 recently used colors, a saturation/brightness area, a hue slider, a preview square and a hex text field. The current colour is marked. |
| **Icon picker** | Button showing the current icon → popover with a search field and a scrolling grid of all icons, plus a "none" (default) choice; the selected icon is marked; "Loading…" while the icon set loads. |
| **Choice dialog** | Modal with a title, optional description, "Cancel" plus one or more action buttons (an action can be destructive). Used for confirm ("Delete note?"), choices ("Only this one" / "All events") and **prompt** mode (one text field, Enter = first action). |
| **Sheet** | Side panel from the right for the task and event editors. |
| **Popover**, **dropdown menu**, **context menu** (right-click), **tabs**, **toggle group** (segmented), **switch**, **checkbox**, **slider**, **tooltip**, **badge**, **kbd** hint. |
| **Meta fields** (shared block) | Project (select, archived ones left out unless already chosen), Category (select, not on notes), Tags (comma-separated text). Used in task, event and note editors. |
| **Task row** | See 6.2. Used in Tasks, Calendar pane, Project page. |

---

## 5. Command palette (Ctrl K)

Modal with a search field and grouped results.

- Placeholder: "Search, create or run a command…" (or "Link to…" in **pick mode**).
- Full-text search as you type, results grouped under **Notes, Tasks, Events, External events, Projects, Categories, Files**. Each result: title + optional one-line snippet with the matched words highlighted.
- Results respect the project focus.
- **Create** group (while there is text): "New task "<text>"" (opens the task editor), "New note "<text>"" (opens the note).
- **Commands** group, filtered by the text: Go to Calendar / Tasks / Notes / Stats / Settings, Open today's note, Toggle focus mode, Start / pause pomodoro, Toggle dark mode, Sync external calendars.
- Empty state: "Nothing found."
- **Pick mode**: the same palette is used to choose a link target (insert link in a note, embed a note in a canvas, pin an item on a project). No create/commands groups there, and projects are matched by name too.

Selecting a result navigates to it: a note opens, a task opens its editor, an event opens the calendar at its date with its editor open, an external event moves the calendar to its date, a project/file opens its page.

---

## 6. Views

### 6.1 Calendar (`/calendar`)

```
┌───────────────────────────────────────────────┬──────────────┐
│ Toolbar                                       │ Tasks pane   │
│ [<][>][Today][Daily note]  Title  [Tasks][Day│Week│Month]     │
├───────────────────────────────────────────────┤ (hideable)   │
│ Calendar grid                                 │              │
└───────────────────────────────────────────────┴──────────────┘
```

**Toolbar**
- Previous, Next, Today, "Daily note" (opens/creates the daily note of the shown date).
- Title (range or month name; in month view it follows the month at the top of the scroll position).
- "Tasks" toggle (pressed/unpressed: show or hide tasks in the grid; remembered).
- View switch: Day / Week / Month (remembered).

**Day and week views (time grid)**
- All-day row on top (capped at 2 rows, then "+N more").
- Time column with 24 h labels, 30-minute slots, opens scrolled to 07:00, a "now" line.
- Day headers are links to that day.
- **Events**: coloured marker by category/project (neutral when none), title, time range. Variants: normal, **tentative** (has to look "not settled"), **draft** (new, unsaved), **recurring occurrence**, **external (read-only)**, **external tentative**.
- **Tasks with a start** show as **background blocks**: muted, behind events, never take width from events. Overlapping tasks split into **side-by-side columns** of their own (up to 8). Hover state + pointer cursor; clicking opens the task (an event on top wins). They can't be dragged here.
- **Deadline markers**: all-day entries "⚑ <task title>".
- Done/cancelled tasks never show.

**Month view**
- 12 months stacked vertically, scrolled as **one endless list** (more months load at both ends).
- Day cells with day number; the **whole top strip** of a cell opens that day in day view.
- Up to 3 entries per day, then "+N more".
- Only deadline markers of tasks, no task blocks.

**Interactions**
- **Drag on empty grid** (15-minute snapping) → creates a **draft** event and opens the event editor. Nothing is saved until "Create".
- Drag/resize events (15-min snap). For a recurring event a choice dialog asks **"Change recurring event": "Only this one" / "All events"**. An event with further times can't be moved between all-day and timed.
- Drag/resize the draft itself.
- Drag a task's block to reschedule it; drag a deadline marker to change the deadline.
- **Drag a task from the tasks pane onto the grid** to schedule it (duration = estimate, else 60 min).
- **Drop a scheduled task back onto the pane** to unschedule it.
- Click: event → event editor (opened on that occurrence/time); task → task editor; external event → read-only dialog.

**Tasks pane** (right, hideable, remembered)
- Header "Tasks" + "hide". When hidden, a narrow vertical "Tasks" tab brings it back.
- Hint: "Drag onto the calendar to schedule. Drop back here to unschedule."
- Sections (only when not empty): **Overdue, Today, Upcoming, Unscheduled**. Task rows in brief form (see 6.2).
- Empty: "No open tasks."

**External event dialog** (read-only): title, "<feed name> · read-only", date/time range, location, description.

### 6.2 Task row (shared)
- Checkbox (done) | colour dot (category/project) | title (struck through + muted when done) | right side: priority (only urgent/high), status (when open), start date-time, "⚑ deadline", estimate "45m", repeat icon, reminder icon, project name.
- **Brief** form (narrow lists): only the due date (deadline, else start) without the year, no project.
- Subtasks render indented below their parent, recursively.
- Click/Enter opens the task editor. It is also a drag source (calendar pane).
- Hover state.

### 6.3 Task editor (sheet)
- Link "↑ <parent title>" when it is a subtask.
- Done checkbox + editable title (large).
- "Created <date-time>".
- Fields: **Status** (—, todo, doing, waiting, done, cancelled), **Priority** (—, urgent, high, medium, low), **Start** (date-time), **End** (date-time), **Deadline** (date), **Estimate** (number, minutes, steps of 15), **Repeat** (Does not repeat / Daily / Weekdays / Weekly / Every 2 weeks / Monthly / Yearly, plus a custom rule if one is set), **Reminders** (list of date-time inputs, each removable; "+ Reminder" adds one 15 min before start/deadline, asks for notification permission), Project, Category, Tags.
- Description (multi-line).
- **Subtasks**: list with checkbox + title (click opens that subtask), and an "Add subtask…" field (Enter).
- Footer: "Delete" (deletes subtasks too; undoable).
- Every field saves on change. Completing a recurring task creates its next instance.

### 6.4 Event editor (sheet)
- Editable title (large; "New event" preselected on drafts; Enter on a draft creates it).
- **All day** (switch; converts all times).
- **Start**, **End** (date or date-time; all-day ends shown inclusive).
- **Repeat** (presets as for tasks) + **Custom** (raw RRULE text, e.g. "FREQ=MONTHLY;BYDAY=1MO").
- **Further times** (repeatable block, each titled "Another time" with a remove "x"): Start, End, Repeat (presets + "Custom…" which prompts for a rule).
- "Add another time" button.
- **Tentative** (switch), **Location**, Project, Category, Tags, Description.
- Footer, **draft**: "Cancel" + "Create". Closing a draft asks **"Discard new event?" / "It has not been created yet." / "Discard"**.
- Footer, **existing**: "Delete" (recurring: "Delete recurring event" → "Only this one" / "All events"); for a recurring occurrence also **"Edit only this occurrence"** (detaches it into its own event).

### 6.5 Tasks (`/tasks`)
- Centered column.
- Quick-add field: "Add a task to the inbox… (Enter)". New tasks go to the focused project.
- Tabs with counts: **Inbox** (newest first), **Today** (due/started until end of today, incl. overdue, by priority), **Upcoming** (by date), **All** (open, by priority then date), **Done** (latest 200, by completion). Remembered.
- Task rows with subtasks nested (flat in Done).
- Empty tab: "Nothing here."
- `?open=<id>` opens a task's editor.

### 6.6 Notes (`/notes`)

```
┌────────────────┬──────────────────────────────────────────┐
│ Notes tree     │ Note header                              │
│                ├──────────────────────────────────────────┤
│                │ Editor (markdown / canvas / deck / file) │
└────────────────┴──────────────────────────────────────────┘
```

**Tree panel** (hidden in focus mode)
- Header "Notes", "Today's note" button, "+" menu.
- Sections, each collapsible with a chevron and a hover "+" menu:
  - **Unfiled** (only without project focus),
  - one per **project** (project icon + name; only the focused one while focused; archived ones left out),
  - **Daily** (latest 60 daily notes by date, newest first; only without focus).
- Tree items, recursive with **indent guides**:
  - **Folder**: chevron, open/closed folder icon, name, hover "+" menu.
  - **Note**: icon by type (markdown / canvas / deck), title or "Untitled"; active state.
  - **File**: icon by MIME (image, video, audio, PDF/text, archive, code, other), name; active state.
- Empty section: "No notes".
- **"+" menu**: Note, Canvas, Flashcard deck, Folder, separator, Upload files… A new item opens straight into inline rename.
- **Context menus**:
  - Folder: New note, New canvas, New deck, New folder, Upload files…, Rename (F2), Delete ("Notes and subfolders inside move up one level.").
  - Note: Rename (F2), Delete ("Delete note?", undoable).
  - File: Rename (F2), Download, Delete ("The file is deleted permanently.", not undoable).
- **Inline rename**: text field in the row (F2 / double-click; Enter saves, Escape cancels).
- **Drag & drop** (pointer based): move notes, files and folders onto folders or section headers (also between projects); a folder can't go into itself. Needs a **drag ghost** (icon + label following the pointer) and a **drop-target highlight**.
- **Files from the OS** can be dropped on sections and folders (with their own highlight).

**Empty main area**: "Select a note, or press Ctrl K to create one."

**Note header**
- Editable title.
- "<n> linked from" → popover listing the notes/items that link here (backlinks).
- "Link" button (markdown only; Ctrl L): pick an item, insert a link.
- **Markdown | Canvas** segmented switch (not on decks). Canvas → markdown asks first ("Only the text is kept; drawings and embeds are dropped.").
- "…" popover: Project, Tags, "Updated <date-time>", "Delete".

**File preview** (`/notes/file/<id>`)
- Header: editable name, "<type> · <size>", "Download", delete.
- Body by type: image, PDF viewer, video player, audio player, text/code as monospace text (under 2 MB), else "No preview for this file type." Missing: "File not found."

### 6.7 Markdown editor (live preview)
The text is markdown. Syntax is **hidden wherever the cursor isn't** and shown where it is, so every element below has two looks: **rendered** and **source (cursor inside)**.

Elements to design:
- Headings H1–H3 (+ smaller levels), paragraphs, **bold**, *italic*, ~~strike~~, `inline code`, links (Ctrl/Cmd+click follows them), block quotes, horizontal rule, escapes.
- **Lists**: bullets (drawn as a bullet), numbered lists, **task checkboxes** (clickable; done items struck through), hanging indent per nesting level, fold toggles on items.
- **Folding**: fold arrows for headings (whole section) and list items, faintly visible all the time (touch), plus a folded state.
- **Code blocks**: own box, syntax highlighting, fences hidden away from the cursor; inside a list they start at the list's indent.
- **Images** in place: alignment left/center/right, optional width/height; click → **enlarged view** (zoom overlay).
- **File links** (uploaded non-image files).
- **Math** (Typst): inline formulas inside a line and display formulas on their own lines (also over several lines); an error state; while editing a display formula the rendered formula stays below; inline formulas get a **popup preview below** while being edited.
- **Tables** shown as real tables and edited in place: header row, alignment per column; shown as raw markdown while the cursor is on the separator row.
- Text selection, cursor, drop cursor (for dropped files).
- Margin space beside the text (clicks there land in the line).
- A **compact variant** (smaller paddings) for notes embedded in a canvas.

Editor menus (right-click):
- **Picture**: Align left / center / right, Size… (prompt "Width, or width x height (pixels)"), Original size, Edit markdown; plus the file actions when it is an uploaded file.
- **Uploaded file link**: Rename file…, Download, Delete file (permanent).
- **Table cell**: Insert row above/below, Insert column left/right, Align left/center/right, Delete row, Delete column, Delete table.
- Anywhere else: the browser's own menu (spelling, paste).

Behaviour: autosave (local draft kept until the server confirms), pasted/dropped files are uploaded (images embedded, others linked), paired brackets/backticks, typing `* _ ~` around a selection wraps it.

### 6.8 Canvas (drawing notes)
An Excalidraw whiteboard (its own toolbar, shapes, arrows, free text, freedraw, etc.) plus our additions:

- **Insert panel** (floating, top right): "Pen bar" (switch to the touch UI), "Embed note", "Insert PDF" (disabled while busy), "Embed file".
- **Embedded note**: a box with a solid background showing the note's title (link to open it) and its content; markdown notes are **editable inside the canvas** (compact editor), canvas notes show as text.
- **Embedded file**: a box showing the file in the browser's viewer.
- **PDF**: every page becomes an image; the pages form one group. While a PDF group is selected a **"PDF layout" panel** shows:
  - Pages: Column / Spread / Row (segmented),
  - Cover (only for Spread): switch "Page 1 alone" / "Pages 1 | 2",
  - Scale: 25 % … 200 %,
  - Gap: 0 / 8 / 24 / 48 px.
  Drawings on a page move along when the layout changes.
- **Pen bar** (touch UI, replaces Excalidraw's own UI on touch devices; can be switched per device):
  - Pen presets, each shown as a dot previewing colour, width and opacity; active pen marked. Tapping the active pen opens **pen settings**: Colour (colour picker), Width (slider 0.5–8), Opacity (slider 10–100), Pressure (switch "Follows pressure" / "Even width"), "Remove pen".
  - "Add pen", divider, Eraser, Select (active state each), divider, Undo, Redo, divider, "All tools" (back to the full Excalidraw UI).
  - Only the pencil draws; fingers pan/zoom while a pen or the eraser is active.
- Excalidraw has a separate narrow/mobile layout (below about 730 px canvas width); our panels must work in both.

### 6.9 Flashcard deck editor (deck notes)
- Info line: "<n> cards · <n> due · Typst markup, e.g. `$a^2 + b^2 = c^2$`".
- Buttons: "Template" (toggle), "+ Card", "Review" (disabled when nothing is due; opens review of this deck).
- **Template panel** (when toggled): monospace text area for the deck's Typst template, explanation text; the placeholder shows the global template when one exists.
- **Card** (one per card, in creation order): two monospace text areas, "Front (question)" / "Back (answer)", with a **rendered preview** of each below; footer "Due <date> · <n> reviews, <n> lapses" (or "new") and a delete button (hover). Saves on blur.
- Empty: "No cards yet."
- Rendered Typst has an error state (error text instead of the rendering).

### 6.10 Review (`/review`)
- Header: "Review" (or "Review: <deck>"), counts "<n> due · <n> to repeat · today <n> good · <n> again", "All decks" link when limited to one deck.
- **Card**: deck name (link) + "· repeat" marker when shown early; rendered front; after reveal a divider and the rendered back.
- Buttons: before reveal "Show answer (Space)"; after reveal "Again (1)" and "Good (2)".
- Empty: "Nothing due. Well done." or, without decks, "No decks yet: create one with "+" → Flashcard deck in the notes tree."
- Respects the project focus (or `?deck=`).

### 6.11 Project page (`/projects/<id>`)
- Header row: icon picker, colour picker, editable name (large), "Focus"/"Focused" toggle button, "Archive"/"Unarchive", "Delete" (confirm: "Its notes, tasks, events and folders are kept but unassigned.").
- Sub-line: "<x> h tracked with pomodoro", group select ("No group", existing groups, "New group…" → prompt).
- **Links** section: "+" menu with "Web address…" (prompts for URL, then title) and "Note, task, event…" (pick mode). Links appear as chips (title; full URL as tooltip; external ones open in a new tab) with a remove "x" on hover. Empty: "Nothing pinned."
- Two columns:
  - **Tasks**: open top-level tasks of the project (task rows with subtasks). Empty: "No open tasks."
  - **Notes**: the project's notes tree (same as 6.6, with "+" menu); below it **Upcoming events** (next 15; title + date or "recurring"; click opens the event editor). Empty: "None."
- Missing project: "Project not found."

### 6.12 Stats (`/stats`)
- Three totals: Today, This week, All time (focus time as "Xh Ym").
- Bar chart: "Focus minutes · last 30 days" (one bar per day, tooltip).
- Two ranked lists (top 10): **By project**, **By task**: name, time, and a proportional bar. Empty: "No sessions yet."
- Respects the project focus.

### 6.13 Settings (`/settings`)
Sections:
1. **Categories**: rows of colour picker + name field + delete; "Add category".
2. **CalDAV (events and tasks)**: when set up on the server: "Sync now" (spinner while busy), status text (error, "Synced <time>", "<n> waiting to be sent"). Otherwise an explanation that it isn't set up.
3. **External calendars (read-only, refreshed hourly)**: one card per feed with Name (colour picker + name + enabled switch), Type, Show (+ project multi-select for "Chosen projects"), URL, Keep past (switch + explanation), Username, Password (shows "unchanged"), and a row with "Sync now" (spinner), status (error or last sync) and remove (confirm). "Add calendar".
4. **Pomodoro**: four number fields: Focus (min), Short break (min), Long break (min), Long break every.
5. **General**: First day of week (Monday/Sunday/Saturday), Notifications ("Allow notifications"), Daily note template (monospace text area), Flashcard template (monospace text area + explanation), Backup ("Download database snapshot", busy state).

### 6.14 Embedded note page (`/embed/note/<id>`)
Shown inside canvas boxes, without the app shell: title (link to the full note), then the compact markdown editor (editable) or the text of a canvas note. Has a solid background.

### 6.15 Shortcut help (`?`)
Modal "Keyboard shortcuts" with a two-column list (keys | description); content in section 8.

---

## 7. Dialog and prompt inventory

| Trigger | Title / text | Actions |
|---|---|---|
| New project | "New project" (prompt, "Project name") | Cancel / Create |
| New group | "New group" (prompt, "Group name") | Cancel / OK |
| Pin web link | "Add link" ("https://…") → "Title of the link" | Cancel / Next → OK |
| Delete project | "Delete project "<name>"?" + explanation | Cancel / Delete |
| Drag recurring event | "Change recurring event" | Cancel / Only this one / All events |
| Delete recurring event | "Delete recurring event" | Cancel / Only this one / All events (destructive) |
| Close draft event | "Discard new event?" / "It has not been created yet." | Cancel / Discard |
| Event further time, custom repeat | "Repeat" (prompt, RRULE) | Cancel / OK |
| Delete note | "Delete note?" / "You can undo this." | Cancel / Delete |
| Delete folder | "Delete folder?" / "Notes and subfolders inside move up one level." | Cancel / Delete |
| Delete file | "Delete file?" / "The file is deleted permanently." | Cancel / Delete |
| Canvas → markdown | "Convert to markdown?" / "Only the text is kept; drawings and embeds are dropped." | Cancel / Convert |
| Picture size | "Picture size" (prompt) | Cancel / Set |
| Rename file (editor) | "Rename file" (prompt) | Cancel / Rename |
| Remove feed | "Remove "<name>"?" | Cancel / Delete |

Confirm dialogs opened from a sheet must sit above the sheet.

---

## 8. Keyboard shortcuts

Global (not while typing, except Ctrl K):
- Ctrl K: palette · Ctrl Z / Ctrl Shift Z / Ctrl Y: undo / redo
- g c / g t / g n / g s / g r / g ,: go to Calendar / Tasks / Notes / Stats / Review / Settings
- n: palette (quick create) · f: focus mode · p: start/pause pomodoro · ?: shortcut help

Calendar: t today · d / w / m day / week / month · j / k next / previous.

Notes: Ctrl L insert link · Ctrl B / I / E bold / italic / code · Ctrl Shift X strike · Tab / Shift Tab indent / outdent list item, or next / previous table cell · Ctrl Shift ↑ / ↓ move list item · Alt Shift ← / → new table column left / right · Enter in tables = new row (in an empty last row: leave the table) · Backspace in an empty row removes it · F2 rename in tree.

Review: Space / Enter show answer · 1 Again · 2 Good.

Shortcut hints appear in tooltips, the search button ("Ctrl K"), review buttons and context menus (F2).

---

## 9. Cross-cutting behaviour the UI must show

- **Project focus**: when a project is focused, every view shows only its items (tasks, events, notes, decks, stats, search). External calendars follow their own "Show" setting. Archived projects' items are hidden while nothing is focused. New items go into the focused project.
- **Undo/redo** for every create/update/delete (apart from note bodies, canvas content, settings and file deletion); the buttons show whether undo/redo is possible.
- **Autosave** everywhere: fields save on change/blur, there are no save buttons (except "Create" for a draft event).
- **Recurring items**: repeat presets + custom rules; "only this one" vs "all" choices; detach an occurrence.
- **Reminders**: checked while a tab is open; missed ones from the last 24 h fire on open; held back during focus mode.
- **Sync status**: CalDAV and each feed show last sync time, errors, pending count and a busy state.
- **Hover-only controls** (tree "+" menus, delete buttons on cards and links) need a touch alternative or must stay reachable on iPad.

---

## 10. Remembered UI state (per browser)

Calendar view type, calendar "Tasks" toggle, calendar tasks pane shown/hidden, Tasks tab, tree sections/folders/sidebar groups open or closed, pomodoro state, recent colours, canvas UI mode (pen bar or full) per device, daily review counters, unsaved note drafts, fired reminders, theme.

---

## 11. Checklist: what has to be designed

1. App shell: sidebar (expanded + icon rail), project groups/archived, badges, pomodoro widget, footer buttons, focus-mode exit button, loading/error screens, toasts.
2. Shared controls: select (single/multi), date input + time field, colour picker, icon picker, choice/confirm/prompt dialog, sheet, menus, tabs, segmented toggle, switch, checkbox, slider, tooltip, kbd hint, chips.
3. Command palette (search results with snippets, create, commands, pick mode, empty).
4. Calendar: toolbar, day/week/month grids, event variants (normal, coloured, neutral, tentative, draft, recurring, external, external tentative), task background blocks (incl. columns, hover), deadline markers, "+N more", now line, endless month scroll, tasks pane (sections, hidden state), external event dialog, drag states.
5. Task row (full + brief, done, nested), task editor sheet.
6. Event editor sheet (draft vs existing, further times).
7. Tasks page (quick add, tabs with counts, empty states).
8. Notes: tree (sections, folders, notes, files, indent guides, active, rename, context menus, "+" menu, drag ghost, drop targets, OS file drop), note header (backlinks, link, type switch, "…" popover), empty state, file preview.
9. Markdown editor: all elements in rendered and source form, folding, images + zoom, math + popup + error, tables, code blocks, context menus, compact variant.
10. Canvas additions: insert panel, embed boxes, PDF layout panel, pen bar + pen settings (both Excalidraw layouts).
11. Deck editor (cards, previews, template panel) and Review page (before/after reveal, counts, empty states).
12. Project page (header, links chips, tasks, notes tree, upcoming events).
13. Stats (totals, bar chart, ranked bars).
14. Settings (categories, CalDAV status, feed cards, pomodoro, general).
15. Shortcut help modal.
16. Light and dark variants of all of the above; touch (iPad) variants where hover is used.
