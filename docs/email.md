# Email tab (`email.md`)

## Context

The planner should get a **Mail** tab, as drawn in the "Mail" row of the Planner UI Redesign canvas (artifact `T8FjZAVw1my97zokgeKv28`, boards `Mail`, `MailInvite`, `MailConvert`, `MailCompose`, `MailAccounts`). The point is not a second mail client but triage inside the planner: a mail is archived, put off to a time (it then sits in the calendar), or turned into a task, event or note that links back to it.

What the design shows:

- **Sidebar**: "Mail" between Tasks and Notes, opening into "All inboxes" plus one entry per account, each with an unread count. Accounts are marked by a square grey letter (outlined, solid or grey); round colour dots stay reserved for projects and categories.
- **Message list** (about 360 px): title + "N to triage", "Write" button, view chips Inbox / Later / Waiting / Flagged / Sent / Archive, rows grouped Today / Yesterday / Earlier with unread dot, sender, account marker, time, subject, snippet, icons for invitation / attachment / linked item, project dot.
- **Reading pane**: toolbar Archive `E`, Later `L`, Flag | Turn into Task / Event / Note | Reply `R`. Subject, chips for the project and the items the thread became, the thread with earlier messages folded, dates in the text underlined, attachment row (Open, "Save to <project> notes"), quick reply (Track the reply, From account, Send `Ctrl Enter`).
- **Invitation**: card with title/date/place/attendee counts, Accept / Maybe / Decline, and that afternoon of the calendar beside it. The event is in the calendar as tentative until answered; declining removes it and archives the mail.
- **Turn into / Later**: floating "New task from mail" panel (title, mail chip, deadline "found in the mail", project, priority, estimate, "Archive the mail", Create `Enter`); "Bring back" menu (This afternoon, Tomorrow morning, Next week, Pick a slot in the calendar…); a mail put off is a dotted block in the calendar; a task/event/note shows a chip of the mail it came from.
- **Compose**: floating panel (560 px): From, To chips, Cc, Subject, body in the notes markdown editor, attachments from the notes tree, Link `Ctrl L`, Track the reply, Send `Ctrl Enter`, "draft saved".
- **Accounts in settings**: one card per account (marker letter, name, Default badge, enabled, address, type, password "unchanged", Projects, Show, last sync / error with Retry, Sync now, remove), "Add account" presets that only fill in the servers.

Decisions (agreed with the user, 2026-11-15):

| Topic                                               | Decision                                                                                                                                                                                                                                                                                       |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Planner-only state (Later, Waiting, project, links) | Stored only in the planner, keyed by Message-ID. Read, flag, archive and sent go to the IMAP server. Other mail apps still show a "Later" mail in the inbox.                                                                                                                                   |
| Local copy                                          | Last 90 days: complete messages (searchable bodies). Older: headers + snippet of everything in Inbox, Sent, Archive; a body is fetched from IMAP when first opened, then kept.                                                                                                                 |
| Outlook                                             | Password accounts first (Gmail and iCloud with app passwords, any IMAP). OAuth2 for Outlook is the last milestone.                                                                                                                                                                             |
| Truth                                               | The IMAP server, as CalDAV is for events. The local copy is a cache that can be deleted and rebuilt.                                                                                                                                                                                           |
| Process                                             | No separate mail daemon (Go/Rust): the Bun server is the background process, as for CalDAV and feeds. It holds the IMAP IDLE connections and pushes changes to the browser by server-sent events. Fallback if `imapflow` fails under Bun (M0): the same TypeScript as a separate Node process. |

Guiding rule as always: existing libraries, as little own code as possible.

## 1. Libraries (all devDependencies)

- `imapflow`: IMAP (SPECIAL-USE folders, CONDSTORE, move, flags, part download, XOAUTH2).
- `nodemailer`: SMTP, building the MIME message (also for the copy appended to Sent), `icalEvent` for invitation replies.
- `postal-mime`: parsing a raw message into text, html, attachments, headers.
- `chrono-node`: finding dates in the mail text ("Thursday, 19 November").
- Already there and reused: `ical.js` (invitations), `marked` (markdown body → HTML part), `MarkdownEditor.svelte`, `FloatingPanel.svelte`, `AppSelect`, `DateInput`, `choose()/confirmAction()`, `notify()`.
- No sanitiser library: HTML mail is shown in an `<iframe sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" srcdoc>` (no `allow-scripts`, so nothing runs; same-origin only so the parent can measure the height) with a CSP `<meta>` that blocks everything remote until "Show images".

## 2. Data

### Docs (generic store, `src/lib/types.ts`, `COLLS` in `src/lib/server/db.ts`, `db` in `src/lib/data.svelte.ts`)

```ts
interface MailAccount extends Base {
	name: string;
	letter?: string;
	marker?: 'outline' | 'solid' | 'grey';
	address: string;
	type: 'gmail' | 'icloud' | 'outlook' | 'imap';
	imap?: { host: string; port?: number };
	smtp?: { host: string; port?: number };
	username?: string;
	password?: string; // server only, see below
	oauth?: { refreshToken: string }; // M6, server only
	folders?: { sent?: string; archive?: string }; // override of SPECIAL-USE detection
	enabled?: boolean;
	default?: boolean;
	assign?: 'rules' | 'group' | 'project';
	group?: string;
	projectId?: string; // "Projects"
	show?: 'all' | 'always' | 'projects'; // as Feed.show
	lastSync?: string;
	error?: string | null;
	errorSince?: string;
}
// Planner-only state of one thread; id = hash of the thread's root Message-ID.
interface MailThread extends Base {
	later?: string | null; // ISO: out of the inbox until then, block in the calendar
	waiting?: string | null; // ISO of our tracked mail; cleared when an answer arrives
	projectId?: string | null; // manual assignment, wins over rules
	subject?: string;
	from?: string;
	account?: string; // for the calendar block and chips
}
interface MailDraft extends Base {
	account: string;
	to: string[];
	cc?: string[];
	bcc?: string[];
	subject?: string;
	body?: string; // markdown
	files?: string[]; // ids of `files` docs
	inReplyTo?: string;
	references?: string[];
	thread?: string;
	track?: boolean;
	queued?: boolean;
	error?: string; // queued = "waiting to be sent"
}
```

- New collections: `mail_accounts`, `mail_threads` (only threads that have state, so loading them at startup is cheap), `mail_drafts`.
- `Project.senders?: string[]` (addresses or `@domain`): the "sender rules". Assigning a project to a mail offers "Always for this sender".
- Links to a mail on the items: `Task.mail`, `CalEvent.mail`, `Note.mail` = `{ thread: string; subject: string; from?: string }`. The other direction is not stored: the reading pane finds the items by `mail.thread` in `db.tasks/events/notes`. In iCalendar this is `X-PLANNER-MAIL` (JSON) in `src/lib/server/ical.ts`.
- `CalEvent.invite?: { uid: string; organizer: string; partstat?: 'ACCEPTED' | 'TENTATIVE' }` for events created from an invitation.
- Passwords and tokens are stored in the account doc (as feeds do) and must never reach the browser: one helper strips `password`/`oauth` in `list`, `get` and in the PATCH/DELETE responses. The same fix goes to `feeds`, whose `GET /api/feeds/<id>`, PATCH and DELETE responses return the password today.

### Message cache (`DATA_DIR/mail.db` + `DATA_DIR/mail/<account>/<id>.eml`)

A second SQLite file, so that the nightly backup of `planner.db` doesn't grow by the mailbox and the cache can simply be deleted.

- `msg(id, account, folder, uid, msgid, thread, date, from_name, from_addr, to_json, subject, snippet, seen, flagged, attach, invite, cached)` with indexes on `(account, folder, date)`, `thread`, `msgid`.
- `folder_state(account, folder, uidvalidity, uidnext, modseq)`.
- `ops(id, account, kind, args, tries, error)`: pending server actions (flags, move, append to Sent), pushed right away and retried on the next sync, like `dirty` rows in `dav`.
- `mail_fts` (FTS5: subject, sender, body). `search()` in `db.ts` queries it besides `fts` and returns hits with `coll: 'mail'`.
- Raw messages as `.eml`: parsed with `postal-mime` when read (body, attachments, `text/calendar` part), so there is one cache format and attachments need no store of their own.
- Thread id: first id in `References`, else `In-Reply-To`, else the own `Message-ID`.

## 3. Server (`src/lib/server/mail.ts`, tests in `tests/mail.test.ts`)

- **Presets** (`src/lib/mail.ts`, shared with the settings form): Gmail, iCloud, Outlook → hosts/ports; "Other" asks for them.
- **`syncAccount(id)`**: connect, resolve Inbox / Sent / Archive by SPECIAL-USE (Gmail: `\All` is the archive), then per folder:
  - new UIDs since `uidnext`: envelope + flags + body structure for all; full source for messages of the last 90 days (first sync: newest first, in batches, so the list fills at once);
  - flag changes via `modseq` (CONDSTORE), else by refetching the flags of the window;
  - removed/moved messages by comparing the UID list;
  - changed `uidvalidity`: the folder's rows are dropped and read again.
  - Afterwards: clear `MailThread.waiting` where a message from someone else arrived in the thread; create events for new invitations (section 6); `patch('mail_accounts', id, { lastSync, error })`. A failed sign-in sets `error`/`errorSince` and leaves the cache alone ("Mail from before is still shown").
- **`syncAll()`**: at startup and every 5 minutes in `hooks.server.ts` `init` (beside `sync`/`syncAll` for calendars); `POST /api/mail/sync[?id=]` from the client on tab focus, every 5 minutes and "Sync now"/"Retry" (same pattern as `syncDav()` in `data.svelte.ts` and the poll in `(app)/+layout.svelte`). Returns `changed` so the client reloads the list.
- **`watch()`** (from M2): one more connection per enabled account stays in IDLE on the inbox (`imapflow` does this by itself while a mailbox is open and nothing else runs; it re-enters IDLE regularly). Its `exists`/`expunge`/`flags` events trigger a `syncAccount()` of that folder (debounced); a closed connection is reopened with a growing delay, and the 5-minute `syncAll()` stays as the safety net. Sent and Archive are only polled. The connections live on `globalThis` and are closed before new ones open, since Vite reloads server modules in dev and they would pile up; accounts that are changed, disabled or removed restart or stop their watcher.
- **Events to the browser**: every sync that changed something, and every `ops` result, is published on an in-process emitter; `GET /api/mail/events` streams it as server-sent events (`{ account, changed, counts }`, a comment line every 30 s as keep-alive).
- **Actions** update the cache at once and queue an `ops` row: seen, flagged, archive (move to the archive folder; back to Inbox for undo).
- **`send(draft)`**: `marked` turns the markdown into the HTML part, the markdown is the text part; `/files/<id>` images become inline `cid` attachments, `files` become attachments; `In-Reply-To`/`References` are set for replies; nodemailer sends; the message is appended to Sent (not for Gmail, which does that itself). On failure the draft stays with `queued: true` + `error` and is retried by the sync ("1 waiting to be sent"). With `track`, the thread gets `waiting`.
- **Routes** (`src/routes/api/mail/...`):
  - `GET /api/mail?account&view&before&limit`: threads (newest message, count, unread) for a view, paged by date.
  - `GET /api/mail/[thread]`: its messages with parsed bodies (fetching uncached ones from IMAP).
  - `PATCH /api/mail/[thread]`: `{ seen?, flagged?, archived? }`.
  - `GET /api/mail/[msg]/part/[n]` (attachment or inline image; `?download`), `POST /api/mail/[msg]/part/[n]/save` (→ `files` doc with `tree: true` and the project, reusing the code of `api/upload`).
  - `POST /api/mail/send`, `POST /api/mail/sync`, `GET /api/mail/events` (server-sent events), `GET /api/mail/counts` (unread per account for the sidebar), `GET /api/mail/contacts?q=` (addresses seen in the cache, for the To field), `POST /api/mail/[msg]/invite` (`{ answer }`).
  - Accounts, thread state and drafts use the generic `/api/[coll]` routes. A PATCH with a new password triggers a sync as the connection test.

## 4. Client

- **Navigation**: `AppSidebar.svelte` gets "Mail" (`g m`, unread badge) with the collapsible account group (`tree.collapsed['mail']`, markers from a small `AccountMark.svelte`); `SHORTCUTS`, the palette's "Go to Mail", `LABELS.mail` and `hrefFor('mail', thread)` follow.
- **Route** `src/routes/(app)/mail/[[account]]/+page.svelte`, view and open thread in the URL (`?view=later&m=<thread>`). Layout like `notes/+layout.svelte`: a fixed 360 px list and the reading pane (`max-w-[680px]` content). State in `src/lib/mail.svelte.ts` (list pages, counts, sync status); messages are **not** in `db` (fetched per view like `feed_event`). From M2 it keeps one `EventSource('/api/mail/events')` open for the whole app (started in `(app)/+layout.svelte`, so the sidebar counts and notifications work on every tab): an event reloads the counts and, if it is on screen, the list. `EventSource` reconnects by itself; the sync on tab focus stays.
- **Views**: Inbox = threads with a message in an inbox and no `later` in the future; Later; Waiting; Flagged; Sent; Archive. A thread whose `later` has passed is back on top of the inbox (and `notify()`s unless in focus mode). "N to triage" = unread threads in the inbox.
- **Visibility** `mailVisible(thread, account, ui.project)` in `src/lib/tasks.ts` beside `feedVisible()`: the thread's project is `MailThread.projectId`, else the account's `projectId`, else a `Project.senders` match. With a project focused: threads of that project, of accounts with `show: 'always'`, and of accounts whose `group` is the project's group. Without: everything except archived projects, as `inFocus()`.
- **Components** (`src/lib/components/mail/`): `MailList`, `MailRow`, `MailReader` (toolbar, chips, folded thread), `MailBody` (text in app typography with found dates as buttons; HTML in the sandboxed iframe with "Show images"), `MailAttachment`, `QuickReply`, `LaterMenu`, `InviteCard`, `Compose` (in `FloatingPanel` key `mail`, width 560, mounted in `(app)/+layout.svelte`), `MailChip` (the link shown in `TaskEditor`, `EventEditor` and on a note).
- **Keys** (only on the mail route): `e` archive, `l` later, `r` reply, `j`/`k` or arrows to move, `c` write; `Ctrl+Enter` sends.
- **Undo**: Later, Waiting and project are `update('mail_threads', …)` and so part of the global undo. Archive shows a toast with "Undo" (moves it back).
- **Later**: the menu's presets set `later`; "Pick a slot in the calendar…" goes to the calendar with `ui.slotFor = thread`, where the next drag-select sets `later` instead of creating `ui.draft`. In `Calendar.svelte` the `local` source adds one entry per thread with `later` (`ev ev-mail`: dotted border, mail icon, muted; click opens the mail; drag moves the time).
- **Turn into**:
  - Task: the "New task from mail" panel = `TaskEditor`'s fields on an unsaved task (`ui.taskDraft`, like `ui.draft` for events): title = subject without `Re:`/`Fwd:`, `mail` link, deadline from the first date `chrono-node` finds ("found in the mail"), project of the thread, "Archive the mail" (remembered), Enter creates.
  - Event: `ui.draft` with title, found date/time, `mail` link → the existing `EventEditor`.
  - Note: a markdown note in the thread's project with the text of the mail and the `mail` link; opens it.
  - Clicking an underlined date starts the task panel with that date.
- **Compose and reply**: `MarkdownEditor` (`compact`) for the body; To/Cc chips with suggestions from `/api/mail/contacts`; From = account of the thread, else the default account; attachments via `pick()` (files of the notes tree) or the OS chooser (`upload()`); drafts are `mail_drafts` docs saved with `record = false` ("draft saved"); closing keeps the draft, the list's Write button reopens it. The quick reply is a plain textarea on the same draft doc and quotes the original. Reply all and Forward (not drawn) go into a small menu on the Reply button.
- **Settings** (`settings/+page.svelte`, new section after "External calendars", same card grid): the fields of the board; password field `placeholder="unchanged"`; "Projects" = `AppSelect` (Sorted by sender rules / All mail goes to group … / to project …); "Show" = Always / Only in its projects / Only in "All projects"; marker letter and style; one account is Default.

## 5. Milestones

- **M0 spike** (done 2026-11-15, see "M0 results" below): `imapflow`, `nodemailer`, `postal-mime` under Bun, in `bun run dev` and in the `adapter-bun` build (they must bundle, since the image has no `node_modules`). Includes holding an IDLE connection for a while and getting its events. Decide here if the fallback (a separate Node process for `mail.ts`) is needed.
- **M1 read** (done 2026-11-15, see "M1 results" below): accounts in settings, sync into `mail.db`, sidebar entry with counts, list with views Inbox/Sent/Archive/Flagged, reading pane (text + HTML, attachments Open), palette search.
- **M2 triage** (done 2026-11-15, see "M2 results" below): seen/flag/archive with `ops`, Later (menu, calendar block, slot picking), projects (rules, manual, focus filtering), keys, IMAP IDLE (`watch()`) + server-sent events, new-mail notification.
- **M3 write** (done 2026-11-16, see "M3 results" below): compose panel, quick reply, drafts, send + Sent copy, outbox retry, Track the reply / Waiting.
- **M4 turn into** (done 2026-11-16, see "M4 results" below): task/event/note with links both ways (`X-PLANNER-MAIL`), date finding, "Save to notes".
- **M5 invitations** (section 6; done 2026-11-16, see "M5 results" below).
- **M6 OAuth2 for Outlook**: `MAIL_OAUTH_MS_CLIENT_ID/_SECRET`, `GET /api/mail/oauth/start?account=` → Microsoft sign-in → `/api/mail/oauth/callback` stores the refresh token; `mail.ts` refreshes access tokens and passes `accessToken` to imapflow and nodemailer. The Outlook preset appears only when the env vars are set.
- Each milestone ends with `MIGRATIONS.md` (new collections and fields, `mail.db`, env vars; all optional, old data untouched), `README.md` (env table, a "Mail" subsection, app passwords), and the `CLAUDE.md` architecture notes.

### M0 results (2026-11-15)

Installed (devDependencies): `imapflow` 2.11, `nodemailer` 10.5 (+ `@types/nodemailer`), `postal-mime` 4.2. `scripts/mail-spike.ts` (`SPIKE_*` env; writes to the account, scratch mailboxes only) ran against Dovecot 2.3 (`nix shell nixpkgs#dovecot`, static passdb, maildir, Sent/Archive with SPECIAL-USE) and Mailpit as SMTP sink, under plain Bun 1.4, in `bun run dev` (temporary route) and in the `adapter-bun` build copied to a folder without `node_modules`. Everything passed in all three:

- nodemailer builds MIME (html + text, inline `cid` image, attachment, `icalEvent`) via `streamTransport`, and sends over SMTP with STARTTLS + AUTH.
- imapflow over implicit TLS and over STARTTLS; SPECIAL-USE folders; append (also with `\Seen` to Sent); fetch of envelope/flags/body structure/source; part download; flag store; `changedSince` (CONDSTORE is enabled by imapflow itself); move with UID map.
- postal-mime parses the messages back (text, html, inline image by `contentId`, the `text/calendar` part).
- IDLE: a second connection on the inbox gets `exists` within ~15 ms of a message being appended by another connection; a 6-minute hold (past Dovecot's 2-minute IDLE keep-alive) still delivers it. A server-side `doveadm kick` fires `close` with `usable = false`.
- Types: all three ship/get TypeScript types; `bun run check` is clean.

**Decision: no Node fallback needed**; `mail.ts` runs inside the Bun server as planned.

What the spike changed in the plan:

- **imapflow enters IDLE only after 15 s of inactivity** (`autoIdleDelay`, default 15000). Until then, changes arrive only with the next command. `watch()` passes a short `autoIdleDelay` (e.g. 1000).
- `client.mailbox` is a live object (its `highestModseq` moves with every untagged response): copy `uidValidity`/`uidNext`/`highestModseq` right after opening, before storing them in `folder_state`.
- **The `adapter-bun` build drops responses that take longer than 10 s** (Bun's default `idleTimeout`; `CONNECTION_IDLE_TIMEOUT` raises it, max 255 s; `bun run dev` doesn't do this, so it only shows in production). This already applies to a slow `POST /api/dav` or feed sync today. For mail: `POST /api/mail/sync` must not wait for a long first sync (it starts the sync and returns; the result comes as a server-sent event, the client reloads on it), and a `GET /api/mail/[thread]` that fetches from IMAP needs a time limit. The Dockerfile now sets `CONNECTION_IDLE_TIMEOUT=255` as a general safety net (agreed 2026-11-15).
- Server-sent events are not affected by that timeout: a stream stayed open through 30 s of silence in dev and in the build. The keep-alive comment stays at 30 s (below Nginx's default `proxy_read_timeout` of 60 s).

### M1 results (2026-11-15)

Built as in sections 2–4, with these differences from the plan:

- **Server-sent events came forward from M2**, because of the 10 s finding above: `POST /api/mail/sync[?id=]` starts the sync and answers `202` at once; `GET /api/mail/events` streams `{ account, changed, syncing, error }` (while a first sync runs, at most every 2 s, so the list fills); `startMail()` in `src/lib/mail.svelte.ts` keeps one `EventSource` for the whole app (started in `(app)/+layout.svelte`) and reloads counts, accounts and (via `mail.version`) the list. The client doesn't poll: the server syncs every 5 minutes, the client asks for a sync on tab focus (> 60 s since the last) and on "Sync now". IDLE (`watch()`) stays in M2.
- **Attachment route** is `GET /api/mail/part/[msg]/[n]` (not `/api/mail/[msg]/part/[n]`, which would share a segment with `[thread]`). It answers with `Content-Security-Policy: sandbox` and `nosniff`, so an HTML or SVG attachment opened in a tab can't run as the app.
- **Folders in the cache are roles** (`inbox`/`sent`/`archive`), the IMAP path lives in `folder_state`. Archive = `\Archive`, else `\All` (Gmail, and servers without an archive folder); the Archive view = threads with a message there and none in the inbox.
- **`.eml` files are named by a hash of the Message-ID** (`mail/<account>/<sha1>.eml`), so the same message in two folders (Gmail Inbox + All Mail) is downloaded and stored once; `cached` is per row.
- **Snippets of old mail** (outside the 90 days) come from the first 2 KB of the text part (`textPart()` from the body structure, fetched with a partial `BODY.PEEK`, decoded by postal-mime). All of them are fetched in the first sync, in batches of 100.
- **List date** = the server's arrival time (INTERNALDATE), not the Date header.
- **Account settings in M1**: marker (letter + style), name, Default, enabled, address, type, IMAP/SMTP server and username (type "Other"), password, status with Sync now/Retry, remove. "Projects" and "Show" come with the project filtering in M2. A changed password, username, address, server or enabled starts a sync (the connection test). Port 143 = STARTTLS, any other port = TLS. `MAIL_TLS_INSECURE=true` accepts self-signed certificates (own server, tests).
- **Removing an account** deletes its cache rows and `.eml` files (also when a sync was still running). Its mail stays on the server. Deleting the account can't be undone in the planner (the password isn't sent back to the browser), as for feeds.
- Not in M1 yet (M2): marking as read when opened, archive/flag, keys, project filtering of the list and of mail hits in the palette.
- **Verification**: `tests/mail.test.ts` (unit tests on fixtures, and with `MAIL_TEST_IMAP=127.0.0.1:<port>` against a scratch Dovecot: first sync of Inbox/Sent/Archive, bodies of recent mail, snippets of old mail, fetching an old body on opening, attachment parts, flag changes, removals, a reset UIDVALIDITY, a wrong password keeping the cache). Driven with playwright-core on a scratch `DATA_DIR`: account added in Settings → synced; no password in `/api/mail_accounts` (list and single); sidebar counts; thread with a folded earlier message and attachments; HTML mail with its `<script>` blocked, remote image blocked until "Show images", inline `cid` image shown; Archive paging from 50 to 71 on scrolling; palette search finds an old mail by its subject and opens it (its body fetched from IMAP); dark mode. Also checked in the `adapter-bun` build without `node_modules` (password set → sync → events → list).

### M2 results (2026-11-15)

Built as in sections 2–4 (server-sent events were already in M1), with these details and differences:

- **Actions** (`PATCH /api/mail/[thread]` → `act()`): the cache changes in one transaction and an `ops` row is queued per account and folder; `pushOps()` sends them right away, and every sync runs them first (otherwise its flag fetch would read the old state back). Everything that talks to one account's server (sync, ops) runs through one queue per account (`serial()`), so they never overlap. Ops carry Message-IDs plus the UIDs known at the time; a missing UID (a message moved a moment ago) is looked up with `SEARCH HEADER Message-ID`. After 10 failed tries an op is dropped and the next sync shows the server's state.
- **Read**: opening an unread conversation marks all its messages read; "Mark as unread" (and `u`) marks only the newest one, as mail apps do. **Flag** flags the newest message and unflags all.
- **Archive** moves the inbox messages to the archive folder; the rows move in the cache at once with a placeholder (negative) UID, which is replaced from MOVE's UID map (UIDPLUS) or by the next sync. Where the archive is `\All` (Gmail), archiving only drops the inbox row, and "back to the inbox" is a COPY (All Mail keeps everything). `folder_state.special` (new column, added on startup) remembers the folder's SPECIAL-USE. Undo is the toast's "Undo" (moves it back); the page moves on to the next conversation.
- **Views**: Inbox, Later, Flagged, Sent, Archive (Waiting comes with "Track the reply" in M3). Later state is passed into the SQL as JSON (`json_each`): threads put off are out of the inbox and in Later; a thread whose time has passed is sorted by that time, so it is back on top. Rows carry `sort` (the page key) and `senders`.
- **Later**: presets This afternoon (before 14:00), This evening (before 18:00), Tomorrow morning (08:00), Next week (Monday 08:00); "Pick a slot in the calendar…" sets `ui.slotFor` and goes to the calendar, which shows a banner; the next drag-select sets `later` (toast "Back in the inbox …"). A put-off mail is a dotted, muted 30-minute block with a mail icon (`.ev-mail`); clicking opens it in the Later view, dragging moves the time. Later and project are `mail_threads` docs, so they are part of the global undo. When a later time passes, the browser reloads the list and notifies once (`localStorage['mail:later-notified']`, missed ones up to 24 h, not in focus mode).
- **Projects**: `threadProject()` / `mailVisible()` in `src/lib/mail.ts` (shared by server and client, not in `tasks.ts`): manual project, else the account's project ("All mail goes to …"), else the first non-archived project with a matching sender rule (`@domain` also matches subdomains). With a project focused, a thread shows when its project is that one, or its account is "All mail goes to group …" of that project's group and nothing else assigned it, or the account has Show = Always; Show = "Only in “All projects”" hides the account's mail whenever a project is focused. The server filters the list (`?project=`, filling pages up), the counts and the palette's mail hits (they carry their project). The reading pane's project chip sets a manual project and offers "Always <project> for <sender>" (a sender rule); the project page has a "Mail from" list to edit the rules.
- **Keys** on the mail page: `j`/`k` and the arrows, `e` archive, `l` later menu, `u` read/unread, `Escape` closes the conversation.
- **IDLE** (`watch()`): one connection per enabled account in IDLE on INBOX (`autoIdleDelay: 1000`), `exists`/`expunge`/`flags` start a sync 1.5 s later, a closed connection reopens after 5 s, doubling up to 5 min. Watchers live on `globalThis` (stopped and restarted when Vite reloads the module), start at `init` and after a successful sync, restart when the account's login changes, stop when it is disabled or removed.
- **New mail**: a sync reports new unread inbox messages (`fresh`, not on the first sync of a folder); the browser notifies (one or "N new mails") for those that show with the focused project, not in focus mode.
- **Verification**: unit tests for projects/focus, later presets, the Later views and sort, and the cache side of read/flag/archive (ops, placeholders, Gmail's All Mail); against Dovecot: read/flag/archive/undo arrive on the server with the UID from MOVE, and a message delivered while idling starts a sync and is announced. With playwright-core: opening marks read (count 3 → 2, `\Seen` on the server), flag, `e` + Undo (server Archive and back), `l` → Tomorrow morning → gone from the inbox, in Later with its time, a block in the calendar; "Pick a slot" → banner → drag-select → second block → Ctrl Z removes it; focusing Thesis shows only Anna's mail (sender rule), Home shows none; a message appended while the page is open is notified within ~2–4 s and listed.

### M3 results (2026-11-16)

Built as in sections 2–4, with these details and differences:

- **Drafts** are `mail_drafts` docs saved without undo steps (subject and body after a 0.6 s pause, the rest at once; the panel shows "Saving…" / "Draft saved"). A reply or forward keeps the quoted original in `quote` (shown folded under the body in the panel, added below the body when sending: in the text part as `> ` lines, in the HTML part as a blockquote), so the quick reply's textarea holds only what you type. `quick: true` = the draft belongs to the quick reply; "Open in the editor" moves it to the panel. Write (`c`) reopens the new message that was closed unsent; there is no draft list.
- **Compose panel** (`Compose.svelte`, `FloatingPanel` key `mail`, 560 px): From (accounts), To with suggestions from `/api/mail/contacts` (senders, and recipients of our Sent mail, by frequency), Cc/Bcc behind a link, Subject, body in `MarkdownEditor` (compact), attachments "From the notes…" (`pick()`, files of the notes tree) or "From this computer…" (`upload()`, a plain `files` doc), Link (`Ctrl L`: asks for a web address; links to planner pages would mean nothing to the recipient), Track the reply, Send (`Ctrl Enter`, caught in the capture phase so a focused switch doesn't take the Enter).
- **Reply**: the toolbar's Reply (`r`) goes to the quick reply under the conversation; its menu has "Reply in the editor", "Reply all" and "Forward". `replyDraft()` in `src/lib/mail.ts`: reply to the sender (to the recipients when the newest message is ours), reply all puts the others in Cc (never ourselves), forward takes the newest message someone else wrote, with a "Forwarded message" header in the quote and its attachments (`forward` = cache id). Subjects get `Re: ` / `Fwd: ` once (`baseSubject()`).
- **Sending** (`send()` in `mail.ts`, `POST /api/mail/send`): nodemailer builds the message once (`streamTransport`, used for SMTP and the Sent copy); `/files/<id>` pictures become inline `cid:` parts; From carries the account's new "Your name" (`MailAccount.sender`); SMTP port 465 = TLS, others STARTTLS (required). The Sent copy is appended separately (not for Gmail) and a failure there doesn't make it send twice. A failed send keeps the draft with `queued` + `error` (toast "Not sent yet …"; the card in Settings shows "N waiting to be sent"); every sync tries the queued drafts again, and so does changing the account's SMTP server.
- **Track the reply / Waiting**: a sent message with Track sets `MailThread.waiting`; the Waiting view lists those threads (hourglass and the time in the row); a sync clears it when someone else wrote in the thread since (compared at whole seconds: IMAP arrival times have no milliseconds).
- **Threading**: a message now joins the conversation of a message it refers to (In-Reply-To, then References from the end) when that one is in the cache already; otherwise the References rule as before. So an answer whose References don't start at the conversation's first message stays in it.
- **Verification**: unit tests for `replyDraft()` (reply, reply all, forward, after our own message), the composed MIME (text with quote, HTML with `<strong>`, blockquote and the inline `cid` picture, the file, From name, Message-ID, In-Reply-To, References), contacts and `answered()`; with `MAIL_TEST_SMTP=127.0.0.1:<port>` (Mailpit with STARTTLS, its API on 18025) a send that fails stays queued, the next sync sends it, the copy lands in Sent, Waiting is set and then cleared by an answer. With playwright-core: `r` → quick reply with Track → received by Mailpit with the sender name, In-Reply-To and the quote → Waiting view; `c` → suggestion for "jon" → markdown body + an attachment → "Draft saved" → Escape → Write reopens it → sent (HTML bold, attachment); Forward with the original's PDF; a failed send → "1 waiting to be sent" → SMTP fixed → sent; an answer clears Waiting.

### M4 results (2026-11-16)

Built as in sections 2–4, with these details and differences:

- **Turn into** (toolbar group Task / Event / Note; the actions live in `src/lib/mail.svelte.ts`, they use the newest message someone else wrote):
  - **Task**: its own small panel `MailToTask.svelte` (FloatingPanel key `mail-task`) instead of a `ui.taskDraft` in `TaskEditor`: title (subject without `Re:`/`Fwd:`), the mail chip, deadline (the first date from today on that chrono-node finds, marked "found in the mail"), project of the thread, priority, estimate, "Archive the mail" (remembered in `localStorage['mail:task-archives']`). Enter creates it from anywhere in the panel (not on the pickers); the task editor opens on the new task.
  - **Event**: `ui.draft` with the found date (a time → one hour, or the found end; only a day → all day; nothing found → the next full hour) and the mail link; the existing `EventEditor` creates it.
  - **Note**: a markdown note in the thread's project, "_From …, date_" and the mail's text (HTML mail as text), with the link; opens it.
- **Dates** (`src/lib/dates.ts`, `findDates()` / `firstDate()`): chrono-node in English and German, `forwardDate`, only results with a certain day, no bare numbers, a leading "am/on/by/bis…" left out of the mark, overlaps dropped. In the text of a mail (not in quotes, not in HTML mail, which stays in its iframe) they are dotted underlines measured from when the mail was sent; a click opens the task panel with that date.
- **Links both ways**: `Task.mail`, `CalEvent.mail`, `Note.mail` = `{ thread, subject, from }` (`MailLink`); `X-PLANNER-MAIL` (JSON) in the iCalendar of events and tasks. The reading pane shows chips of the items found by `mail.thread` (task with deadline, event with its time, note); the list row gets a square-check icon. `MailChip.svelte` (opens the mail) is in the task details (removable while editing), the event details and the note header.
- **Save to notes**: `POST /api/mail/part/[msg]/[n]/save` `{ projectId }` writes the attachment as a `files` doc with `tree: true` in the thread's project (the button says "Save to <project> notes"), then "In the notes" links to it.
- **Verification**: unit tests for `findDates()` (English, German with time, no false hits from numbers and versions, `firstDate()`) and the `X-PLANNER-MAIL` round trip for tasks and events. With playwright-core: the underlined "Thursday, 19 November" opens the task panel with that deadline, "found in the mail" and the project from the sender rule; Archive the mail + Enter → the task (with the link) and the mail archived; the task's chip opens the mail, which shows the task chip; Event → the event editor's draft → created with the link and a chip in the mail; Note → the note with the text and its chip; an attachment saved to the project's notes. The M2 and M3 browser runs pass again on top.

## 6. Invitations

- A message with a `text/calendar` part and `METHOD:REQUEST` is marked `invite`. The sync creates the event from it: the VEVENT text becomes the resource in the `dav` table under its own UID (so ORGANIZER/ATTENDEE survive, as foreign properties do today), projected to an `events` doc with `tentative: true`, `invite` and `mail`.
- Skipped when an event or feed event with that UID exists already (a subscribed calendar may deliver the same invitation).
- `InviteCard` shows title, date, duration, location, "N invited · M accepted" (from the ATTENDEE lines) and the hours around it from `db.events` + `occurrences()` with "no conflicts" / the conflicting titles.
- Accept / Maybe / Decline: sets our ATTENDEE's PARTSTAT, sends the `METHOD:REPLY` mail to the organizer (`icalEvent`), then Accept → `tentative: false`; Maybe → stays tentative; Decline → the event is removed and the mail archived.
- `METHOD:CANCEL` removes the event if it still is the invitation's.

### M5 results (2026-11-16)

Built as in section 6, with these details and differences:

- **Import** (`handleInvites()` in a sync, after the folders; cached inbox mail of the 90-day window with a calendar part): `METHOD:REQUEST` → `importEvent()` in `dav.ts` stores the VEVENT text as the event's resource under its own UID (METHOD removed: a CalDAV resource must not have one), projects it, then writes our fields on top (`rebuild`), so ORGANIZER and ATTENDEE stay. The doc gets `tentative: true`, `invite: { organizer, partstat }` (as `X-PLANNER-INVITE` in the iCalendar; the event id is the UID, so no `uid` field) and the `mail` link. Skipped: an invitation that is over, an own event with that UID, a subscribed calendar that has it.
- **Memory**: table `invites (uid, seq)` in `mail.db` (highest SEQUENCE handled, `-1` = cancelled), so a declined or deleted event doesn't come back with the next sync; a REQUEST with a higher SEQUENCE (the organizer changed it) imports it again, as tentative and unanswered.
- **Answer** (`POST /api/mail/invite/[msg]` `{ answer }` → `answerInvite()`): PARTSTAT on our ATTENDEE line (the address of any of our accounts that is invited, else the account's; `setPartstat()`), `invite.partstat` on the doc; Accept → not tentative, Maybe → tentative, Decline → the event is removed and the mail archived. The REPLY goes as a draft (`MailDraft.ical`, nodemailer `icalEvent` with `method: REPLY`: subject "Accepted: …", a line of text, a VCALENDAR with the event's identity and only our ATTENDEE), so a failure waits in the queue like any mail. An invitation without ORGANIZER gets no reply (nobody to tell). Answering an invitation whose event is gone (deleted by hand) imports it first.
- **Cancel**: `METHOD:CANCEL` removes the event if it came from an invitation.
- **InviteCard** (`InviteCard.svelte`, in the message): title, date and time, duration, "repeats", location, "N invited · M accepted · by organizer", "No conflicts" / "Clashes with …" (own events of the focused project, recurring ones expanded with `occurrences()`), Accept / Maybe / Decline with our answer, and a strip of the hours around it (2 before, 2 after) with the other events beside the invitation. A message with an invitation stays open in its conversation (a reply would fold it), and its calendar parts aren't listed as attachments. CANCEL shows a line instead of the card.
- **Verification**: unit tests for `inviteOf()`, `replyIcs()` (METHOD:REPLY, one ATTENDEE with PARTSTAT), `importEvent()` (no METHOD, ORGANIZER kept, STATUS:TENTATIVE, X-PLANNER-INVITE, the doc) and `setPartstat()`; against Dovecot + Mailpit: an invitation becomes a tentative event, Accept settles it and the REPLY reaches the organizer, the same invitation again changes nothing, a CANCEL removes the event and it doesn't come back, Decline removes the event and archives the mail. With playwright-core: the card with "Clashes with Seminar prep" (an own event at the same time), Accept on an invitation without organizer (no reply, the entry in the calendar no longer striped), Accept on one with organizer and three attendees (REPLY with PARTSTAT=ACCEPTED in Mailpit, no draft left), Decline (event gone, mail out of the inbox).

### After M5 (2026-11-16)

- **Simple HTML as text**: `readThread()` marks HTML that is text in fact (`classify()`: pixels and icons ignored, up to 3 other pictures left out and counted in `pictures`, data tables written as markdown tables that `MailBody` draws; forms, media, backgrounds and layout tables keep the frame) as `simple` and sends its conversion (`htmlText()` on `html-to-text`: links as `text [url]`, quotes with `> `, list items with `- `) as `text`. `MailBody` shows it in the text view; "Show original" switches to the frame. `html-to-text` also replaces the regex behind snippets and search text.
- **Maximised compose**: a button in the compose panel (Ctrl Shift F) lets it fill the window with a centred 80ch column; remembered in `localStorage.composeFull`.

### M7 Triage with a local decision model (2026-11-18)

Not in the original milestones; built from the user's question set (`src/lib/triage-questions.json`, 17 questions) and notes on GLiDE.

| Topic                | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Where the model runs | On the **client PC** in LM Studio, never on the server. A browser tab calls it while it is open (server → browser → model → browser → server); there is no background helper.                                                                                                                                                                                                                                                                                                                                                                                                                                |
| API                  | LM Studio's `POST /v1/decisions` (not Fastino's cloud, not `/v1/systemone`). Probed on 2026-11-18: `{ model, input: string, questions: [{ type: 'predicate' \| 'choice' \| 'score', name, instructions, choices: [{value, description?}] \| levels: [{label, description?}] }] }` → `answers[]` by `name`: predicate `probability`; choice `probabilities: [{value, probability}]`, `confidence` (top − second); score `score` (expected level), `probabilities: [{value: index, label, probability}]`. `input` must be a string (the state as JSON text). LM Studio sends `Access-Control-Allow-Origin: *`. |
| UI                   | Markers per row, inbox split All / Needs you / Other, a summary line, a phishing warning and corrections in the reader. **Nothing moves on the IMAP server.**                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Labels               | Corrections go to `triage_labels` in `planner.db` (in the backups), with the exact state; `scripts/triage-eval.ts` evaluates.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

Built:

- **Shared** (`src/lib/triage.ts`):
  - `toRequest()` (placeholders `{{weekday}}`, `{{today}}`, `{{received}}`)
  - `readResponse()` → compact answers: P(true), P per option, P per level
  - `nextQuestions()`: three rounds at most
    - round 1: Phishing, Spam, Category, Sender, Recipient role, Relevance; it stops for phishing/spam ≥ 0.5 or newsletter + ads ≥ 0.5
    - round 2: Action needed?, Attention, Importance, Follow-up, Calendar, plus Transaction type / One-time code by category
    - round 3: Primary action, Urgency driver, Reply effort if action ≥ 0.5; Event type if calendar ≥ 0.5 or an invitation is attached
  - `decide()` (takes the request function; `all` for the eval)
  - `effective()`: header facts override Recipient role, Sender, Calendar, Event type
  - `summary()`: bucket, due from Attention relative to the triage time in business days, importance, action label, phishing, code, follow-up
  - thresholds in `T`
  - `VERSION` = hash of the question set (a change asks again)
- **Server** (`src/lib/server/triage.ts`):
  - `itemOf()` builds the state of the notes from the cached `.eml`: now with time zone, recipient (`Settings.triage.about` + account), received with "N h ago", from/to/cc as "you + N others", subject, thread ("3 messages; the previous one was yours"), attachments, fact lines, body.
  - `fromHtml()` (htmlparser2 DOM):
    - drops script, style, hidden elements (inline `display:none`, `font-size:0` …, `hidden`) and quoted history (`blockquote[type=cite]`, `.gmail_quote`, Outlook's `#divRplyFwdMsg`/`#appendonsend` and what follows)
    - pictures become meaningful alt text
    - links become "text (→ domain)"; a link text naming another site becomes a `mismatch` fact
    - data tables become markdown (`mdTable` from `mail.ts`)
  - `tidy()`: NFKC, invisible characters, reply headers in English and German, footer lines, a short signature, head + tail truncation at ~6000 characters (the model's tokenizer isn't available).
  - `factsOf()` reads:
    - List-Unsubscribe / List-Id / Precedence, Auto-Submitted / no-reply, the calendar METHOD
    - Authentication-Results spf/dkim/dmarc
    - own domain (not freemail), known contact (an address of our Sent mail), To/CC
- **Storage and routes**:
  - Table `triage` in `mail.db` (by Message-ID, with thread, date, state, facts, answers, bucket, due, importance). It goes with the message's last row.
  - `threads()` returns `triage` per row and takes `split: 'needs' | 'other'`. "needs" is unpaged and sorted by due, then importance; untriaged mail inside the window counts as needs.
  - `GET /api/mail/triage?limit=` gives waiting items (inbox, last 14 days, cached, not from us, no answers of this `VERSION`) plus counts. Items are leased for 2 min, so two devices don't do the same mail.
  - `POST` stores; `DELETE` = run again; `GET ?thread=` gives the reader's triage with labels; `POST /api/mail/triage/label`.
  - New answers go out as a mail event `{ triaged: true }`, debounced to 2 s; the client only reloads the list.
- **Client**:
  - `src/lib/triage.svelte.ts`: per-device config in `localStorage['triage:device']` (on, URL, model, token). `drain()` runs in one tab per browser (Web Locks): at start, after mail events with changes (`onMailChange()`), every 5 min. Stops when the model can't be reached; skips a mail the model refuses (up to 3 in a row).
  - Settings › Mail › Triage (`Triage.svelte`): switch, server, model (from `/v1/models`), token, **Test** (the click that lets Chrome ask for local network access), status, Run again, About you.
  - `MailList` markers.
  - The split control on the mail page (`localStorage['mail:split']`).
  - `TriageStrip.svelte` (line, phishing box with the signals, Details popover with corrections).
  - `toTask()` takes the triage due when the mail has no date ("suggested by triage").
- **Also in this round**: a found date opens a menu (Task due …, Event …, Bring back …) instead of the task panel at once, and `findDates()` reads "Blatt 5 bis Freitag, 20. November" (a range from 5 o'clock to chrono) as the 20th.
- **Verification**:
  - Unit tests (`tests/triage.test.ts`): requests, the probed responses, gating, `decide()` rounds, summary/due across a weekend, overrides, `fromHtml`/`fromText`/`tidy`/`bodyOf`, facts, and pending → state → answers → split → labels → run again.
  - `TRIAGE_TEST_URL` against LM Studio (`fastino_glide-9b`): shipping notice → Transactions; fake PayPal with DKIM fail → phishing ≥ 0.3; colleague asking for corrections → Action needed, Work; three mails in ~1.3 s.
  - playwright-core on a scratch `DATA_DIR` with four seeded mails and the real model:
    - Test answered in ~40 ms
    - Erika's mail: Needs you, "Task · Mon"
    - the newsletter, the fake PayPal (99%, its signals listed) and a code mail from an unknown `github.example` (rated phishing 77%) went to Other
    - corrections saved as labels
    - the date menu → event draft at Thu 19 Nov 14:00 / task panel "found in the mail"
- **Open**: calibrating the thresholds needs 150–300 labelled mails. A mail of an unknown domain without Authentication-Results can look like phishing to the model; real providers' DKIM pass is told to it.

## 7. Risks and open points

- **Bun + imapflow** (TLS sockets, bundling): checked in M0, works (see "M0 results").
- **Gmail** needs an app password (2-step verification on) and IMAP enabled; its labels make a message appear in several folders, so only Inbox, Sent and All Mail are synced and rows are deduplicated by Message-ID.
- **Microsoft**: OAuth needs an app registration, and Microsoft 365 tenants can have SMTP AUTH switched off.
- **Passwords in plain text** in `planner.db` and so in its backups (same as feed passwords today).
- **Size**: 90 days of complete messages incl. attachments on the data volume; older `.eml` files that were opened stay. A cleanup can come later if it matters.
- **HTML mail in dark mode** is shown on a light card (mails bring their own colours).
- **Search** covers bodies only inside the 90-day window; older mail is found by subject, sender and snippet. A "search on the server" (IMAP SEARCH) is a possible later step.
- **IDLE** costs one more open connection per account (providers limit them; Gmail allows 15), and only the inbox is watched. Until M2, new mail arrives with the next sync (5 minutes or tab focus).
- **Server-sent events behind the proxy**: Nginx Proxy Manager must not buffer `/api/mail/events` (the route sends `X-Accel-Buffering: no` and `Cache-Control: no-cache`); to be checked on the server, with the README noting it.
- Tests can't cheaply run a fake IMAP server inside `bun test`.

## 8. Verification

- `bun run check && bun test && bun run build`.
- `tests/mail.test.ts` on `.eml` fixtures: parsing, thread ids, views, `mailVisible()`, sender rules, date finding, building a reply (headers, quote, `cid` images), invitation → event → REPLY text, stripping of passwords from every API response.
- Opt-in integration test like `CALDAV_TEST_URL`: `MAIL_TEST_IMAP=…` against a Dovecot from `nix shell nixpkgs#dovecot` with a scratch maildir (sync, flag, archive, append to Sent, uidvalidity reset, a message delivered while idling arrives as an event, reconnect after the server drops the connection).
- UI with playwright-core on a scratch `DATA_DIR` and the test account: add an account, list and open a mail, archive + undo, Later → block in the calendar → back in the inbox, turn into task (chip on the task, chip in the mail), reply with Track the reply → Waiting, compose with an attachment from the notes tree, accept an invitation, focus a project and check the list.
- By hand with a real Gmail and iCloud account before M3 sends anything.
