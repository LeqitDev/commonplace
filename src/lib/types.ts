// Shared data model. Every collection is a JSON document store keyed by `id`.
// Timed values are UTC ISO strings; all-day values are 'YYYY-MM-DD'.

export interface Base {
	id: string;
	createdAt?: string;
	updatedAt?: string;
}

export interface Project extends Base {
	name: string;
	color?: string;
	icon?: string | null; // lucide icon name (PascalCase), default folder
	archived?: boolean;
	/** Name of the group it is listed under in the sidebar. */
	group?: string | null;
	/** Pinned links, shown on the project page: external URLs or paths inside the app. */
	links?: { title: string; url: string }[];
	/** Sender rules: mail from these addresses (or `@domain`) belongs to the project. */
	senders?: string[];
}

export interface Folder extends Base {
	name: string;
	parentId?: string | null;
	projectId?: string | null;
}

export interface Category extends Base {
	name: string;
	color: string;
}

export interface EventTime {
	start: string;
	end?: string;
	rrule?: string;
}

/** The mail a task, event or note was made from (the mail shows its items by this). */
export interface MailLink {
	thread: string;
	subject: string;
	from?: string;
}

export interface CalEvent extends Base {
	title: string;
	start: string;
	end?: string;
	allDay?: boolean;
	rrule?: string; // RRULE body only, e.g. "FREQ=WEEKLY;BYDAY=MO"
	exdates?: string[]; // ISO starts of skipped occurrences
	/** Further times of the same event, each with a recurrence of its own (Mon + Fri at 10 and
	 *  Wed at 14). They share everything else, also `allDay` and `exdates`. */
	times?: EventTime[];
	tentative?: boolean; // not settled yet: drawn shaded
	categoryId?: string | null;
	projectId?: string | null;
	tags?: string[];
	description?: string;
	location?: string;
	mail?: MailLink | null;
	/** Made from an invitation: the organizer and how we answered (none yet = NEEDS-ACTION). */
	invite?: { organizer: string; partstat?: Partstat } | null;
}

export type Partstat = 'NEEDS-ACTION' | 'ACCEPTED' | 'TENTATIVE' | 'DECLINED';

/** The calendar part of an invitation mail, as the invitation card shows it. */
export interface InviteInfo {
	method: string; // REQUEST, CANCEL, REPLY…
	uid: string;
	summary: string;
	start: string;
	end?: string;
	allDay: boolean;
	rrule?: string;
	location?: string;
	organizer: { name: string; address: string };
	attendees: { name: string; address: string; partstat: string }[];
	sequence: number;
}

export const STATUSES = ['todo', 'doing', 'waiting', 'done', 'cancelled'] as const;
export type Status = (typeof STATUSES)[number];
export const PRIORITIES = { 1: 'urgent', 2: 'high', 3: 'medium', 4: 'low' } as const;
export type Priority = keyof typeof PRIORITIES;

export interface Task extends Base {
	title: string;
	description?: string;
	status?: Status | null;
	priority?: Priority | null;
	start?: string | null;
	end?: string | null;
	deadline?: string | null; // 'YYYY-MM-DD'
	estimate?: number | null; // minutes
	rrule?: string | null;
	parentId?: string | null;
	projectId?: string | null;
	categoryId?: string | null;
	tags?: string[];
	reminders?: string[]; // ISO datetimes
	completedAt?: string | null;
	mail?: MailLink | null;
}

export interface Note extends Base {
	title: string;
	type: 'md' | 'canvas' | 'deck'; // deck: flashcards live in `cards` (deckId = note id)
	content?: string; // markdown (type md)
	scene?: { elements: CanvasElement[]; appState?: object; fileIds?: string[] }; // type canvas
	folderId?: string | null;
	projectId?: string | null;
	daily?: string | null; // 'YYYY-MM-DD' for daily notes
	cardTemplate?: string; // deck only: overrides Settings.cardTemplate when non-empty
	tags?: string[];
	mail?: MailLink | null;
}

export interface CanvasElement {
	id: string;
	type: string;
	x: number;
	y: number;
	text?: string;
	isDeleted?: boolean;
	[k: string]: unknown;
}

export interface Feed extends Base {
	name: string;
	type: 'ics' | 'caldav';
	url: string;
	username?: string;
	password?: string;
	color?: string;
	enabled?: boolean;
	/** Project focus: 'all' (default) = only when no project is focused. */
	show?: 'all' | 'always' | 'projects';
	projectIds?: string[]; // for show = 'projects'
	/** Events that have left the sync window (older than 90 days) are kept instead of dropped. */
	keepPast?: boolean;
	lastSync?: string;
	error?: string | null;
}

/** A mail account (IMAP + SMTP). `password` stays on the server: API responses leave it out. */
export interface MailAccount extends Base {
	name: string;
	/** Marker: a square letter (default: first letter of the name), outlined, solid or grey. */
	letter?: string;
	marker?: 'outline' | 'solid' | 'grey';
	address: string;
	type: 'gmail' | 'icloud' | 'outlook' | 'imap';
	imap?: { host: string; port?: number };
	smtp?: { host: string; port?: number };
	/** Name shown with the address when sending ("Alex Morgan"). */
	sender?: string;
	username?: string; // default: the address
	password?: string;
	/** Override of the folders found by SPECIAL-USE. */
	folders?: { sent?: string; archive?: string };
	enabled?: boolean;
	default?: boolean;
	/** Which project its mail belongs to: by the projects' sender rules (default), all to a group
	 *  of projects, or all to one project. */
	assign?: 'rules' | 'group' | 'project';
	group?: string;
	projectId?: string;
	/** With a project focused: 'projects' (default) = its mail shows in the projects it belongs to,
	 *  'always' = in every project, 'all' = only when no project is focused. */
	show?: 'projects' | 'always' | 'all';
	lastSync?: string;
	error?: string | null;
	errorSince?: string | null;
}

/** Planner-only state of a conversation (not on the mail server); id = the thread id. */
export interface MailThread extends Base {
	/** Out of the inbox until then; a block in the calendar. */
	later?: string | null;
	/** "Track the reply": when we wrote; cleared when someone answers in the thread (Waiting view). */
	waiting?: string | null;
	/** Manual project: wins over the account's and the sender rules. */
	projectId?: string | null;
	// for the calendar block, and the project of a thread that isn't loaded
	subject?: string;
	from?: string;
	fromAddr?: string;
	account?: string;
}

/** A message being written (autosaved). Sent and then deleted; if sending fails it stays with
 *  `queued` and `error` and is retried with every sync. */
export interface MailDraft extends Base {
	account: string;
	to: string[];
	cc?: string[];
	bcc?: string[];
	subject?: string;
	body?: string; // markdown
	/** Quoted original of a reply/forward, added below the body when sending. */
	quote?: string;
	files?: string[]; // ids of `files` docs
	/** Forward: the attachments of this message (cache id) go along. */
	forward?: number;
	/** An invitation reply (METHOD:REPLY) that goes along as the calendar part. */
	ical?: { method: string; content: string };
	inReplyTo?: string;
	references?: string[];
	thread?: string;
	track?: boolean;
	/** Written in the quick reply under the conversation (not the compose panel). */
	quick?: boolean;
	queued?: boolean;
	error?: string | null;
}

/** One conversation in the mail cache (`/api/mail`), as the list shows it. */
export interface MailThreadRow {
	thread: string;
	account: string; // of the newest message
	date: string;
	fromName: string;
	fromAddr: string;
	to: { name: string; address: string }[];
	/** Everyone who wrote in it (for the sender rules). */
	senders: string[];
	/** Sort key: newest message, or a later time that has passed. Pages go by it. */
	sort: string;
	subject: string;
	snippet: string;
	count: number;
	unread: number;
	flagged: boolean;
	attach: boolean;
	invite: boolean;
	/** What the decision model said about its newest triaged message (`src/lib/triage.ts`). */
	triage?: {
		answers: import('#modules/mail/triage/triage.ts').Answers;
		facts: import('#modules/mail/triage/triage.ts').Facts;
		at: string;
	};
}

export interface MailAttachment {
	n: number; // index in the parsed message, used in /api/mail/part/<msg>/<n>
	filename: string;
	mime: string;
	size: number;
	inline: boolean; // shown inside the HTML body (cid:)
}

/** One message of a thread with its parsed body (`/api/mail/<thread>`). */
export interface MailMessage {
	id: number;
	invite?: InviteInfo;
	msgid: string;
	references: string[];
	account: string;
	folder: 'inbox' | 'sent' | 'archive';
	date: string;
	fromName: string;
	fromAddr: string;
	to: { name: string; address: string }[];
	cc: { name: string; address: string }[];
	subject: string;
	snippet: string;
	seen: boolean;
	flagged: boolean;
	text?: string;
	/** `text` is markdown made from the HTML (`**bold**`, `_italic_`, links; its own specials escaped). */
	md?: boolean;
	html?: string; // cid: links point to /api/mail/part/...
	/** The HTML is text in fact: `text` is its conversion and is what the reader shows. */
	simple?: boolean;
	/** Pictures of a `simple` message that the text doesn't show. */
	pictures?: number;
	attachments: MailAttachment[];
	/** The body could not be fetched (account offline). */
	missing?: boolean;
}

export interface FeedEvent extends Base {
	feedId: string;
	title: string;
	start: string;
	end?: string;
	allDay?: boolean;
	description?: string;
	location?: string;
	tentative?: boolean; // STATUS:TENTATIVE
}

export interface Pomodoro extends Base {
	start: string;
	end: string;
	minutes: number;
	taskId?: string | null;
	projectId?: string | null;
}

export interface FileMeta extends Base {
	name: string;
	mime: string;
	size: number;
	/** Uploaded into the notes tree (canvas/markdown images have no tree placement). */
	tree?: boolean;
	projectId?: string | null;
	folderId?: string | null;
}

export interface Settings extends Base {
	pomodoro?: { work: number; short: number; long: number; every: number };
	dailyTemplate?: string;
	/** Typst template for flashcard boxes; `%box_content%` marks where front/back go. */
	cardTemplate?: string;
	firstDay?: number;
	/** Pen presets of the canvas pen bar. */
	pens?: import('./canvas.ts').Pen[];
	/** Parts switched off (`false`); missing = on. */
	features?: Partial<Record<import('#modules/registry.ts').ModuleId, boolean>>;
	/** Mail triage: who the recipient is ("Informatik master's student …"), told to the model. */
	triage?: { about?: string };
}

export interface SearchHit {
	coll: string;
	id: string;
	project: string | null;
	title: string;
	snippet: string;
}

/** Flashcard of a deck note. Front/back are Typst markup. */
export interface Card extends Base {
	deckId: string;
	front: string;
	back: string;
	/** Next review (ISO); missing = new card, due now. */
	due?: string;
	/** FSRS scheduler state (ts-fsrs Card minus `due`); missing = never reviewed. */
	srs?: {
		stability: number;
		difficulty: number;
		scheduled_days: number;
		learning_steps: number;
		reps: number;
		lapses: number;
		state: number;
		last_review?: string;
	};
}
