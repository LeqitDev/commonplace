// Client data layer: every collection is loaded once into a reactive record, mutations are
// optimistic and recorded as before/after snapshots for global undo/redo.
import { toast } from 'svelte-sonner';
import { DEFAULT_PENS } from './canvas.ts';
import { on, type ModuleId } from '#modules/registry.ts';
import type {
	Card,
	CalEvent,
	Category,
	Feed,
	FileMeta,
	Folder,
	MailAccount,
	MailThread,
	MailDraft,
	Note,
	Pomodoro,
	Project,
	Settings,
	Task
} from './types.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Doc = { id: string; [k: string]: any };
export type CollName =
	| 'projects'
	| 'folders'
	| 'notes'
	| 'tasks'
	| 'events'
	| 'categories'
	| 'feeds'
	| 'pomodoros'
	| 'settings'
	| 'files'
	| 'cards'
	| 'mail_accounts'
	| 'mail_threads'
	| 'mail_drafts';

let authWarned = false;
export async function api<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
	const res = await fetch(path, {
		...init,
		redirect: 'manual',
		headers: init.body instanceof FormData ? {} : { 'content-type': 'application/json' }
	});
	// Authelia answers expired sessions with a redirect to its portal.
	if (res.type === 'opaqueredirect' || res.status === 401) {
		if (!authWarned) {
			authWarned = true;
			toast.error('Session expired', {
				description: 'Unsaved changes are kept locally. Reload to sign in again.',
				duration: Infinity,
				action: { label: 'Reload', onClick: () => location.reload() }
			});
		}
		throw new Error('unauthorized');
	}
	if (!res.ok) {
		toast.error(`Request failed (${res.status})`, { description: await res.text() });
		throw new Error(String(res.status));
	}
	return res.status === 204 ? (null as T) : res.json();
}

export class Coll<T extends Doc> {
	items: Record<string, T> = $state({});
	all: T[] = $derived(Object.values(this.items));
	constructor(
		public name: CollName,
		private omit = ''
	) {}
	async load() {
		const list = await api<T[]>(`/api/${this.name}${this.omit ? `?omit=${this.omit}` : ''}`);
		this.items = Object.fromEntries(list.map((d) => [d.id, d]));
	}
}

export const db = {
	projects: new Coll<Project>('projects'),
	folders: new Coll<Folder>('folders'),
	notes: new Coll<Note>('notes', 'content,scene'),
	tasks: new Coll<Task>('tasks'),
	events: new Coll<CalEvent>('events'),
	categories: new Coll<Category>('categories'),
	feeds: new Coll<Feed>('feeds'),
	pomodoros: new Coll<Pomodoro>('pomodoros'),
	settings: new Coll<Settings>('settings'),
	files: new Coll<FileMeta>('files'),
	cards: new Coll<Card>('cards'),
	mail_accounts: new Coll<MailAccount>('mail_accounts'),
	mail_threads: new Coll<MailThread>('mail_threads'),
	mail_drafts: new Coll<MailDraft>('mail_drafts')
};
type DocOf<C extends CollName> = (typeof db)[C] extends Coll<infer T> ? T : never;

export const loadAll = () => Promise.all(Object.values(db).map((c) => c.load()));

/** State of the CalDAV sync of events and tasks (`/api/dav`). */
export const dav = $state({
	configured: false,
	lastSync: null as string | null,
	error: null as string | null,
	pending: 0,
	busy: false
});

/** Sync events and tasks with the CalDAV server and take over what was changed there. */
export async function syncDav() {
	if (dav.busy) return;
	dav.busy = true;
	try {
		const r = await api<Omit<typeof dav, 'busy'> & { changed: boolean }>('/api/dav', {
			method: 'POST'
		});
		Object.assign(dav, r);
		if (r.changed) await Promise.all([db.events.load(), db.tasks.load()]);
	} finally {
		dav.busy = false;
	}
}

// ---------------------------------------------------------------- mutations + history

interface Op {
	coll: CollName;
	id: string;
	before: Doc | null;
	after: Doc | null;
}

const clone = <T>(x: T): T => structuredClone($state.snapshot(x)) as T;

/** Merge patch from a → b (removed keys become null). */
function diff(a: Doc, b: Doc) {
	const p: Record<string, unknown> = {};
	for (const k of new Set([...Object.keys(a), ...Object.keys(b)]))
		if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) p[k] = b[k] ?? null;
	return p;
}

async function apply(op: Op, to: 'before' | 'after') {
	const from = to === 'after' ? 'before' : 'after';
	const target = op[to];
	const items = db[op.coll].items as Record<string, Doc>;
	if (!target) {
		delete items[op.id];
		const full = await api<Doc | null>(`/api/${op.coll}/${op.id}`, { method: 'DELETE' });
		if (full) op[from] = full; // keep omitted fields (note bodies) for undo
	} else if (!op[from]) {
		items[op.id] = clone(target);
		await api(`/api/${op.coll}`, { method: 'POST', body: JSON.stringify(target) });
	} else {
		items[op.id] = clone(target);
		await api(`/api/${op.coll}/${op.id}`, {
			method: 'PATCH',
			body: JSON.stringify(diff(op[from]!, target))
		});
	}
}

const stacks: { undo: Op[][]; redo: Op[][] } = { undo: [], redo: [] };
let version = $state(0);
let group: Op[] | null = null;

export const history = {
	get canUndo() {
		void version;
		return stacks.undo.length > 0;
	},
	get canRedo() {
		void version;
		return stacks.redo.length > 0;
	}
};

async function run(ops: Op[], record: boolean) {
	for (const op of ops) await apply(op, 'after');
	if (!record) return;
	if (group) group.push(...ops);
	else {
		stacks.undo.push(ops);
		if (stacks.undo.length > 200) stacks.undo.shift();
		stacks.redo = [];
		version++;
	}
}

/** Group several mutations into one undo step. */
export async function batch(fn: () => Promise<unknown>) {
	const outer = group;
	group = outer ?? [];
	try {
		await fn();
	} finally {
		if (!outer) {
			const ops = group;
			group = null;
			if (ops.length) {
				stacks.undo.push(ops);
				stacks.redo = [];
				version++;
			}
		}
	}
}

export async function undo() {
	const ops = stacks.undo.pop();
	if (!ops) return;
	for (const op of [...ops].reverse()) await apply(op, 'before');
	stacks.redo.push(ops);
	version++;
}

export async function redo() {
	const ops = stacks.redo.pop();
	if (!ops) return;
	for (const op of ops) await apply(op, 'after');
	stacks.undo.push(ops);
	version++;
}

export async function create<C extends CollName>(coll: C, doc: Partial<DocOf<C>>, record = true) {
	const now = new Date().toISOString();
	const d = { id: crypto.randomUUID(), createdAt: now, ...clone(doc) } as unknown as DocOf<C>;
	await run([{ coll, id: d.id, before: null, after: d }], record);
	return db[coll].items[d.id] as DocOf<C>;
}

export async function update<C extends CollName>(
	coll: C,
	id: string,
	patch: Partial<DocOf<C>>,
	record = true
) {
	const cur = db[coll].items[id];
	if (!cur) return;
	const before = clone(cur) as Doc;
	const after: Doc = { ...before, ...clone(patch) };
	for (const k of Object.keys(after))
		if (after[k] === null || after[k] === undefined) delete after[k];
	await run([{ coll, id, before, after }], record);
}

export async function remove(coll: CollName, id: string, record = true) {
	const cur = db[coll].items[id];
	if (!cur) return;
	await run([{ coll, id, before: clone(cur) as Doc, after: null }], record);
}

/** Fetch a full doc (e.g. a note with its body) without touching the local cache. */
export const fetchDoc = <C extends CollName>(coll: C, id: string) =>
	api<DocOf<C>>(`/api/${coll}/${id}`);

export const DEFAULT_SETTINGS: Required<Omit<Settings, keyof import('./types.ts').Base>> = {
	pomodoro: { work: 25, short: 5, long: 15, every: 4 },
	dailyTemplate: '## Plan\n\n- \n\n## Log\n\n',
	cardTemplate: '',
	firstDay: 1,
	pens: DEFAULT_PENS,
	features: {},
	triage: {}
};
export const settings = () => ({ ...DEFAULT_SETTINGS, ...db.settings.items.settings });
/** Is this module built and switched on (Settings › General), with what it needs? */
export const featureOn = (id: ModuleId) => on(settings(), id);
export async function saveSettings(patch: Partial<Settings>) {
	if (db.settings.items.settings) await update('settings', 'settings', patch, false);
	else await create('settings', { id: 'settings', ...patch }, false);
}

/** Upload a blob to /data/files; returns its URL. With `place`, it becomes a notes-tree item. */
export async function upload(
	file: Blob,
	name = 'file',
	id?: string,
	place?: { projectId: string | null; folderId: string | null }
) {
	const form = new FormData();
	form.append('file', file instanceof File ? file : new File([file], name, { type: file.type }));
	if (id) form.append('id', id);
	if (place) {
		form.append('projectId', place.projectId ?? '');
		form.append('folderId', place.folderId ?? '');
	}
	const meta = await api<FileMeta>('/api/upload', { method: 'POST', body: form });
	db.files.items[meta.id] = meta;
	return `/files/${meta.id}`;
}
