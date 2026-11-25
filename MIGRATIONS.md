# Migrations

Newest first. Each entry says what changed, whether existing data keeps working, and what to do when upgrading.

## 2026-11-25: Mail triage tabs, sender history, codes, DHL tracking, summaries

**No action needed; mail of the last two weeks is triaged again by itself.** The inbox split "Needs you / Other" became the tabs All · Personal · Orders · News · Ads.

- **Question set**: the Phishing question's wording changed, so its `VERSION` changed: a browser with the model asks again about the 14-day window (as after "Run again"). Older answers keep their `needs`/`other` value; they show under All only.
- **mail.db** (a cache): table `triage` gets the columns `code`, `summary`, `labels` (added on startup; `bucket` now holds the tab), new table `parcels`. Deleting mail.db still only costs a resync.
- **commonplace.db**: new table `triage_senders` ("Move sender to …"), created on startup.
- **Stored facts**: `known` became `history` (`sent`, `fromAddr`, `fromDomain`, `since`) plus `spoof`, `replyTo`, `punycode`, `foreign`. Old answers with `known` still read; `known: false` is no longer shown as a phishing sign.
- **Browser**: the remembered split `localStorage['mail:split']` is no longer read; the tab is `mail:tab` (starts at All). The per-device triage config can now hold `summary` (optional summary model).
- **New env** (optional; README): `DHL_API_KEY`, `DHL_TRACKING_USER`, `DHL_TRACKING_PASSWORD` for DHL's "Parcel DE Tracking (Post & Parcel Germany)" API. Without the key nothing is sent to DHL.

## 2026-11-24: Renamed to Commonplace

**Stored data: converted on the first start, nothing to do by hand.** Besides the visible name (page title, README, settings texts, `package.json`, PRODID), the stored names change from "planner" to "commonplace". The new version converts them once when it starts (each step is skipped when there is nothing left to convert):

- **Database**: `DATA_DIR/planner.db` (with `-wal`/`-shm`) is renamed to `commonplace.db`, unless `commonplace.db` exists already (`renameLegacyFiles()` in `src/lib/server/db.ts`). If another process still has `planner.db` open, the app keeps using it and renames it on a later start. With `DB_PATH` set nothing is renamed: the file you named stays.
- **Backups**: `backups/planner-<date>.db` → `backups/commonplace-<date>.db`; new ones are `commonplace-<date>.db`, and only those count for the 14 kept.
- **Events and tasks**: their own iCalendar properties are `X-COMMONPLACE-*` (were `X-PLANNER-*`: project, category, mail, invite, status, end, estimate). `renameProps()` in `src/lib/server/dav.ts` rewrites the stored objects and marks them changed, so with `CALDAV_URL` set **every event and task is uploaded once** to the CalDAV server after the start. `X-PLANNER-*` is still read (old backups, objects not uploaded yet) and dropped when the item is written.
- **Mail cache**: messages without a Message-ID had the placeholder id `…@planner.invalid`, now `…@commonplace.invalid` (`renameLegacyIds()` in `src/modules/mail/server/mailstore.ts`: ids, cached `.eml` files, triage answers, queued actions). Their thread ids stay, so "later", projects and links to them are kept.
- The browser's localStorage keys never had the name in them; nothing changes there.

Steps:

1. **Stop the running server first** (`docker compose down`, or stop `bun run dev`), so the database can be renamed right away.
2. Start the new version once; its log says how many calendar objects were converted.
3. With `DB_PATH` pointing at a file called `planner.db`, rename it yourself if you like (stop the server, move `planner.db`, `-wal` and `-shm` together, change `DB_PATH`).
4. Going back to a version from before 2026-11-24 needs the files renamed back (`commonplace.db*` → `planner.db*`); it doesn't read `X-COMMONPLACE-*`, so its events and tasks would lose project, category, mail link, status, end and estimate.

**Docker: the compose service and container are now `commonplace`** (were `planner`). If you keep your own `docker-compose.yml`, nothing changes. If you take the new one:

1. `docker compose down` (removes the old `planner` container; `./data` stays).
2. `docker compose up -d --build` (this also converts the data, see above).
3. In Nginx Proxy Manager, change the proxy host's forward hostname from `planner` to `commonplace` (port 3000 as before). Rename the domain and the Authelia `access_control` rule only if you want to.

## 2026-11-23: Optional modules, `MODULES` build arg

**No action needed.** No stored data changed; the default build has every module, as before.

- **Build arg `MODULES`** (Dockerfile, `docker-compose.yml` `build.args`): `all` (default) or a comma list of `calendar, tasks, mail, triage, notes, cards, canvas, pomodoro`. Left-out modules are not bundled; their routes answer 404 (pages redirect to the home page). `triage` needs `mail`, `cards` and `canvas` need `notes`; the build fails with a message otherwise. To use it, add the `args` block from the new `docker-compose.yml` to yours and rebuild (`docker compose up -d --build`). Without it nothing changes.
- **Settings.features** keeps its meaning (missing = on) and now also takes `notes` and `triage`. Settings › General lists only the modules in the build.
- **Data of left-out modules stays**: the collections are the same in every build (mail accounts, decks, canvas notes, …), so building a module in again brings everything back. A canvas note or deck opened in a build without its module shows its text only.
- **Behaviour changes**:
  - Notes can be switched off (or left out). The home page falls back to Stats when no page module is on (was: notes).
  - The flashcard template moved from Settings › Templates to its own tab, Settings › Flashcards.
  - `/settings#<tab>` opens the panel over the home page (was: the calendar).
  - Without calendar and tasks in the build, the CalDAV sync doesn't run.

## 2026-11-18: Mail triage, feature switches, Pomodoro under "More"

**No action needed.** Only optional fields and new tables were added.

- **Settings** gained `features` (parts switched off: `{ mail: false, … }`, missing = on) and `triage.about` (who you are, told to the triage model). Settings from before have everything switched on.
- **`mail.db`** gets a table `triage` (the model's answers per Message-ID, with the state it was given), created at startup. It is a cache like the rest of `mail.db`: deleting it means the last two weeks are asked again.
- **`planner.db`** gets a table `triage_labels` (answers corrected by hand, with the state and the model's answers), created at startup. It is part of the backups.
- **No server env vars.** The model runs on the client PC (LM Studio, `http://127.0.0.1:1234/v1/decisions`); its address is stored per browser (`localStorage['triage:device']`). See the README, "Mail triage".
- **Behaviour**:
  - Switching Mail off stops syncing and IMAP IDLE.
  - Switching Calendar off stops the hourly feed sync (CalDAV keeps running while Tasks are on).
  - `/` opens the first page that is on (the calendar by default).
  - The Pomodoro timer moved from the sidebar footer into a panel under "More" (with Stats); a running session shows as a chip in the footer.

## 2026-11-16: Calendar invitations in mail

**No action needed.** Only optional fields and tables were added.

- **Events** gained `invite` (`{ organizer, partstat }`) for events made from an invitation, written to the iCalendar object as `X-PLANNER-INVITE` (JSON). The event's iCalendar text is the organizer's (ORGANIZER, ATTENDEE and the rest are kept), so the planner's CalDAV calendar now also holds such events.
- **`mail.db`** gets a table `invites` (which invitations were handled, by UID and SEQUENCE), created at startup. Deleting `mail.db` forgets it: invitations of the last 90 days whose event you deleted or declined are imported again by the next sync (delete those events again, or don't delete the cache).
- **Drafts** may carry `ical` (the calendar part of an invitation reply).
- **Behaviour**: new invitations in the inbox (last 90 days, not over yet) appear in the calendar as tentative events by themselves.

## 2026-11-16: Turning mail into tasks, events and notes

**No action needed.** Only an optional field was added.

- **Tasks, events and notes** gained `mail` (`{ thread, subject, from }`): the mail they were made from. Tasks and events carry it in their iCalendar object as `X-PLANNER-MAIL` (JSON), so it survives the CalDAV round trip (apps that drop X- properties lose it).
- **New dependency** `chrono-node` (devDependency, bundled like the others).

## 2026-11-16: Writing mail

**No action needed.** Only optional fields and a new collection were added.

- **New collection** `mail_drafts` (in `planner.db`): messages being written, sent and then deleted. A draft whose sending failed stays with `queued: true` and `error` and is sent with the next sync.
- **Mail accounts** gained `sender` ("Your name", shown with the address when sending; without it only the address is used). Sending uses the account's SMTP server (presets for Gmail and iCloud, "SMTP server" for other accounts): port 465 = TLS, any other port STARTTLS.
- **`mail_threads`** gained `waiting` (Track the reply).
- **Changed behaviour**: a new message joins the conversation of a message it answers when that one is known already. Conversations that were split before stay as they are in the cache until it is rebuilt (delete `mail.db` with the app stopped to rebuild it; changes not sent to the server yet are lost then).

## 2026-11-15: Mail triage (later, projects, IDLE)

**No action needed.** Only optional fields and a new collection were added.

- **New collection** `mail_threads` (in `planner.db`): planner-only state of a conversation, keyed by its thread id: `later` (put off until then; a block in the calendar), `projectId` (set by hand), and `subject`/`from`/`fromAddr`/`account` for the calendar block. Nothing of it is written to the mail server: other mail apps still show a "later" mail in the inbox.
- **Projects** gained `senders` (addresses or `@domain`): mail from them belongs to the project. Edited on the project page ("Mail from") or with "Always … for …" in a mail.
- **Mail accounts** gained `assign` (`rules` default / `group` + `group` / `project` + `projectId`) and `show` (`projects` default / `always` / `all`). Accounts from before behave as "Sorted by sender rules" and "Only in its projects": with a project focused, their mail shows only where a rule or a manual choice puts it.
- **`mail.db`** gets a table `ops` (changes still to be sent to the mail server) and a column `folder_state.special`, both added at startup. Deleting `mail.db` also drops changes that weren't sent yet.
- **Connections**: the server keeps one more IMAP connection per enabled account open (IDLE on the inbox). Providers limit parallel connections (Gmail: 15); the planner uses at most three per account (IDLE, sync, opening an old message).

## 2026-11-15: Mail (reading), passwords no longer sent to the browser, longer response timeout

**No action needed.** Everything is new and optional; existing data is untouched.

- **New collection** `mail_accounts` (in `planner.db`, so in the backups): name, marker, address, type (`gmail`/`icloud`/`imap`), servers, username, password, enabled, default, sync state. The password is stored in plain text, as feed passwords are.
- **New files in `DATA_DIR`**: `mail.db` (the message cache: list, flags, snippets, search index) and `mail/<account>/*.eml` (complete messages of the last 90 days, older ones once they were opened). Both are only a copy of what is on the mail server: they are **not** in the nightly backup, and deleting them (with the app stopped) is safe; the next sync reads everything again.
- **API**: responses of `/api/feeds` and `/api/mail_accounts` (list, single, POST, PATCH, DELETE) no longer contain `password`. Before, `GET /api/feeds/<id>` and the PATCH/DELETE responses did. Nothing in the app read it there. Undoing the removal of a feed brings it back without its password (feeds were removed without undo before as well).
- **New env vars**: `CONNECTION_IDLE_TIMEOUT` is set to `255` in the Dockerfile (Bun's default of 10 s cut off slow sync responses). If you run the image with your own environment, keep it. `MAIL_TLS_INSECURE=true` (optional) accepts self-signed certificates of a mail server.
- **Proxy**: `/api/mail/events` is a server-sent events stream. Nginx Proxy Manager must not buffer it (the route sends `X-Accel-Buffering: no`, which Nginx honours by default). See the README.
- **To use it**: Settings → Mail accounts → Add account. Gmail and iCloud need an app password (README, "Mail").

## 2026-11-12: Events and tasks as iCalendar (RFC 5545), kept on a CalDAV server

**No action needed to keep working as before; set `CALDAV_URL` to move events and tasks to a CalDAV server.** Existing events and tasks are converted automatically at the first start (idempotent: only what has no iCalendar object yet is converted). The docs of `events` and `tasks` keep their shape and ids, so links, subtasks and pomodoros still resolve.

- **Database**: two new tables in `planner.db`, created at startup: `dav` (one row per calendar object resource: `uid`, iCalendar text, `href`/`etag` on the server, `dirty`/`deleted` = still to be sent) and `meta` (sync state). The iCalendar text is the authoritative copy of an event or task; its doc in `docs` is derived from it (and written back into it on every change), so search and the API work as before. Both tables are part of the nightly backup.
- **New env vars** (all optional): `CALDAV_URL` (one calendar collection that accepts VEVENT and VTODO), `CALDAV_USER`, `CALDAV_PASSWORD`, `CALDAV_TASKS_URL` (if tasks are in a calendar of their own). `TZ` should be the timezone you use the planner in: recurring events are written with it as their TZID. See the README.
- **To move to a CalDAV server**:
  1. Take a backup (`POST /api/backup`, or copy `data/planner.db`).
  2. Create an empty calendar on the server and set the env vars (`docker-compose.yml` has them commented out, with an example Radicale service).
  3. Restart. Everything is uploaded at the first sync and what is in the calendar is taken over; Settings → CalDAV shows the state ("N waiting to be sent", errors).
  4. If that calendar was also set up as a read-only external calendar (feed), remove the feed, or its events show twice.
- **Mapping**: UID = doc id. Tags → `CATEGORIES`, reminders → `VALARM`, subtasks → `RELATED-TO`, deadline → `DUE`, priority 1/2/3/4 → `PRIORITY` 1/3/5/9, done/cancelled/doing → `STATUS` `COMPLETED`/`CANCELLED`/`IN-PROCESS`, tentative → `STATUS:TENTATIVE`. Planner-only fields are `X-PLANNER-PROJECT`, `X-PLANNER-CATEGORY`, `X-PLANNER-STATUS` (`todo`/`waiting`), `X-PLANNER-ESTIMATE`, `X-PLANNER-END`. A further time of an event (`times[n]`) is a VEVENT of its own with UID `<id>_t<n>` and `RELATED-TO:<id>`. Since 2026-11-24 these are `X-COMMONPLACE-*` (see "Renamed to Commonplace"; `X-PLANNER-*` is still read).
- **Behaviour to know about**:
  - A task created in another app without a planner status lands in the Inbox.
  - An occurrence of a recurring event that another app changed ("only this event") shows up as an event of its own with the id `<uid>_r<recurrence-id>`; it stays an override of the series on the server.
  - If the same object was changed here and on the server between two syncs, the planner's fields win; properties the planner doesn't know are kept.
  - Project and category are ids in X- properties: they mean something to this planner's database only, and a few apps drop X- properties when they edit an object.
  - A recurring event created elsewhere in another timezone is repeated at the planner's local wall-clock time.
  - iCalendar times have no milliseconds: a doc that comes back from the server has them cut off (`createdAt`, reminders).
  - Removing a time from the middle of an event's `times` renumbers the `_t<n>` objects after it.
- **To go back**: unset `CALDAV_URL`. The planner keeps its copy and works on it alone; nothing is deleted on the server.

## 2026-11-11: Events with several times, archived projects, picture options

**No action needed.** Only an optional field and a convention inside markdown were added.

- **Events** gained `times` (`{ start, end?, rrule? }[]`): further times of the same event, each with a recurrence of its own. They share the event's other fields, also `allDay` and `exdates`. Events without it behave as before.
- **Projects**: `archived` existed already. New behaviour: with "All projects", tasks, events, decks and pomodoros of an archived project are left out (they show while the project is focused), and archived projects are listed under "Archived" at the end of the sidebar instead of being hidden. To get the old behaviour for a project, unarchive it.
- **Notes**: options of a picture are written into its alt text, the way Obsidian does: `![alt|center|300](src)`, `![alt|300x200](src)`. A `|` part at the end of an alt text that is `left`, `center`, `right`, a number or `NxM` is now read as an option; other alt texts are untouched, and nothing is rewritten unless an option is set from the picture's menu.
- **Browser state**: `localStorage.collapsed` may hold the key `archived` (the "Archived" group is open). Folded headings and list items of a note are not stored.

## 2026-11-11: Canvas pen bar

**No action needed.** One optional field was added.

- **Settings** gained `pens` (`{ color, width, opacity, pressure }[]`): the pen presets of the canvas pen bar. Without it the five default pens are used; it is written the first time a pen is changed.
- **Canvas scenes** are unchanged. Strokes drawn with a pen whose pressure is off are ordinary Excalidraw `freedraw` elements with `simulatePressure: false` and all pressures 0.5; widths other than Excalidraw's 1/2/4 are plain `strokeWidth` values.
- **Browser state**: `localStorage.canvasUi` (`pen`/`full`) remembers per device whether the canvas shows the pen bar or Excalidraw's own UI. Without it, devices with a touch screen start with the pen bar.

## 2026-11-11: Project links and groups, tentative events, feeds that keep past events

**No action needed.** Only optional fields were added; documents without them behave as before.

- **Projects** gained `links` (`{ title, url }[]`, pinned on the project page; `url` is a web address or a path inside the app) and `group` (name of the sidebar group).
- **Events** gained `tentative` (drawn striped). Feed events get it from `STATUS:TENTATIVE` at the next sync.
- **Feeds** gained `keepPast`. Off (default): a sync replaces all events of the feed, so events older than 90 days go, as before. On: events that ended before that window stay. Events that were already dropped don't come back.
- **Calendar**: a task with a start and a deadline now also shows a `⚑` marker on its deadline; the month view shows only these markers for tasks.
- **Browser state**: the tasks pane beside the calendar is remembered in `localStorage.calPane` (`show`/`hide`); `calTasks` is only the "Tasks" toggle of the calendar now. A leftover `calTasks` of `true`/`false` reads as "show".

## 2026-11-11: New markdown editor, Milkdown removed

**No action needed.** Note bodies are still plain markdown in `Note.content`, and the new CodeMirror editor reads and writes that text as it is. It never reserialises, so opening a note doesn't change it.

- Notes saved by Milkdown keep the markdown Milkdown wrote, including its escapes (e.g. `\*`, `\_`) and `<br />` for hard breaks. The new editor hides the backslashes unless the cursor is on them, so these notes look the same as before. You can clean up the source by hand, but you don't need to.
- The "Classic editor" switch is gone. The leftover `localStorage.mdEditor` key in browsers is ignored. You can delete it, but you don't have to.
- **Docker image**: smaller, because `@milkdown/*` is no longer bundled. Rebuild as usual (`docker compose build`); no compose or env changes.

## 2026-11-10: Flashcards, files in the notes tree, project icons (`docs/plan2.md`)

**No action needed.** Every change is backwards compatible: all new fields are optional and nothing has to be converted.

- **Projects** gained an optional `icon` (a lucide icon name such as `GraduationCap`). Projects without one keep the folder icon.
- **Files** (`files` docs) gained optional `tree`, `projectId` and `folderId`. Only files uploaded into the notes tree get `tree: true`. Canvas and markdown images are unchanged and stay out of the tree. Tree files are also indexed for search. Existing files are not indexed and don't need to be.
- **Notes** can have `type: 'deck'` (a flashcard deck). There is a new collection **`cards`** (`deckId`, `front`, `back`, `due`, `srs`). It is created on first write; the SQLite schema is unchanged. Card templates are optional strings: `Settings.cardTemplate` (global) and `Note.cardTemplate` (per deck); when missing, cards render as before.
- **New data directory `DATA_DIR/typst-fonts/`**: on first use, the server downloads 6 Typst fonts from the pinned `typst/typst-assets@v0.13.1` release (jsdelivr) and caches them there. So the container needs outbound HTTPS once. To run fully offline, put those files there yourself; the list is in `src/lib/typst-fonts.ts`. They are not part of the nightly DB backup and don't need to be.
- **Client-side only**: the calendar's month view is now a scrolling multi-month view. A saved `calView = dayGridMonth` in localStorage is mapped to it automatically.
- **Docker image**: about 30 MB larger, because of the Typst WASM compiler. Rebuild as usual (`docker compose build`); no compose or env changes.

## 2026-11-09: UI polish round (`docs/plan1.md`)

**No action needed.** Every change is backwards compatible.

- **Feeds** gained optional `show` (`'all' | 'always' | 'projects'`) and `projectIds`. When `show` is missing it is treated as `'all'`: the feed shows only when no project is focused. Before this change, feeds showed in every project focus. To get that back for a feed, set "Show → Always" in Settings.
- **Canvas PDFs** inserted from now on are grouped page images with `customData.pdf`. PDFs inserted earlier stay as loose images and still work, but they have no layout panel. To get the panel, insert the PDF again.
- **Canvas embeds** are matched by path (`/embed/…`, `/files/…`) and rewritten to the current origin. Old absolute links from another host (e.g. dev vs. prod) now work again.
- **Events**: no data change. New events are only stored after "Create".
