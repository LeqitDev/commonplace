// SQLite document store (bun:sqlite) + FTS5 search index. No ORM, no migrations:
// every collection is rows of (coll, id, JSON data).
import { Database } from 'bun:sqlite';
import { error } from '@sveltejs/kit';
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { canvasText } from '../canvas.ts';
import type { SearchHit, Settings } from '../types.ts';
import { on, type ModuleId } from '#modules/registry.ts';

export const DATA_DIR = process.env.DATA_DIR ?? 'data';
export const FILES_DIR = join(DATA_DIR, 'files');
mkdirSync(FILES_DIR, { recursive: true });

export const COLLS = [
	'projects',
	'folders',
	'notes',
	'tasks',
	'events',
	'categories',
	'feeds',
	'feed_event',
	'pomodoros',
	'settings',
	'files',
	'cards',
	'mail_accounts',
	'mail_threads',
	'mail_drafts'
] as const;
export type Coll = (typeof COLLS)[number];
export const isColl = (c: string): c is Coll => (COLLS as readonly string[]).includes(c);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Doc = { id: string; [k: string]: any };

const BACKUPS = join(DATA_DIR, 'backups');

/** The app was called Planner until 2026-11-24: `planner.db` and the backups `planner-<date>.db`
 *  get the new name once, before the database is opened. Returns the file to open. */
function renameLegacyFiles() {
	if (existsSync(BACKUPS))
		for (const f of readdirSync(BACKUPS)) {
			const to = join(BACKUPS, f.replace(/^planner-/, 'commonplace-'));
			if (/^planner-.*\.db$/.test(f) && !existsSync(to)) renameSync(join(BACKUPS, f), to);
		}
	if (process.env.DB_PATH) return process.env.DB_PATH;
	const [now, old] = [join(DATA_DIR, 'commonplace.db'), join(DATA_DIR, 'planner.db')];
	if (existsSync(now) || !existsSync(old)) return now;
	// Its WAL files are there while a connection has it open, and stay after a crash. The last
	// connection to close removes them: if they're still there, another process has it (a server
	// on the same DATA_DIR, `vite build` loads this module too): keep using it, rename later.
	const inUse = () => existsSync(`${old}-wal`) || existsSync(`${old}-shm`);
	if (inUse()) new Database(old).close();
	if (inUse()) return old;
	renameSync(old, now);
	return now;
}

export const db = new Database(renameLegacyFiles(), { create: true });
db.run('PRAGMA journal_mode = WAL');
db.run(
	'CREATE TABLE IF NOT EXISTS docs (coll TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (coll, id))'
);
db.run(
	"CREATE VIRTUAL TABLE IF NOT EXISTS fts USING fts5(coll UNINDEXED, id UNINDEXED, project UNINDEXED, title, body, tokenize='unicode61 remove_diacritics 2')"
);
// Events and tasks as iCalendar, one row per calendar object resource of the CalDAV collection
// (see dav.ts): the docs of these two collections are derived from it.
db.run(
	'CREATE TABLE IF NOT EXISTS dav (uid TEXT PRIMARY KEY, coll TEXT NOT NULL, ics TEXT NOT NULL, href TEXT, etag TEXT, dirty INTEGER NOT NULL DEFAULT 0, deleted INTEGER NOT NULL DEFAULT 0)'
);
db.run('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)');

const tags = (d: Doc) => (d.tags ?? []).map((t: string) => `#${t}`).join(' ');
const indexers: Partial<Record<Coll, (d: Doc) => [string, string] | null>> = {
	projects: (d) => [d.name, ''],
	categories: (d) => [d.name, ''],
	notes: (d) => [
		d.title,
		`${d.type === 'canvas' ? canvasText(d.scene?.elements) : (d.content ?? '')} ${tags(d)}`
	],
	tasks: (d) => [d.title, `${d.description ?? ''} ${tags(d)}`],
	events: (d) => [d.title, `${d.description ?? ''} ${d.location ?? ''} ${tags(d)}`],
	feed_event: (d) => [d.title, `${d.description ?? ''} ${d.location ?? ''}`],
	files: (d) => (d.tree ? [d.name, ''] : null) // only files in the notes tree, not canvas/md images
};

const sql = {
	get: db.query<{ data: string }, [string, string]>(
		'SELECT data FROM docs WHERE coll = ? AND id = ?'
	),
	put: db.query('INSERT OR REPLACE INTO docs (coll, id, data) VALUES (?, ?, ?)'),
	del: db.query('DELETE FROM docs WHERE coll = ? AND id = ?'),
	ftsDel: db.query('DELETE FROM fts WHERE coll = ? AND id = ?'),
	ftsPut: db.query('INSERT INTO fts (coll, id, project, title, body) VALUES (?, ?, ?, ?, ?)')
};

function reindex(coll: Coll, doc: Doc | null, id: string) {
	sql.ftsDel.run(coll, id);
	const ix = indexers[coll];
	const entry = doc && ix?.(doc);
	if (entry) sql.ftsPut.run(coll, id, doc.projectId ?? null, ...entry);
}

/** Fields that never leave the server (passwords of feeds and mail accounts). */
const SECRET: Partial<Record<Coll, string[]>> = {
	feeds: ['password'],
	mail_accounts: ['password', 'oauth']
};
/** The doc as the browser may see it. */
export function pub<T extends Doc | null>(coll: Coll, doc: T): T {
	if (!doc || !SECRET[coll]) return doc;
	const d = { ...doc };
	for (const k of SECRET[coll]) delete d[k];
	return d;
}

export interface ListOpts {
	omit?: string[];
	start?: string;
	end?: string;
	where?: Record<string, string>;
}

export function list(coll: Coll, o: ListOpts = {}): Doc[] {
	let q = 'SELECT data FROM docs WHERE coll = ?';
	const args: string[] = [coll];
	if (o.start && o.end) {
		q +=
			" AND json_extract(data, '$.start') < ? AND coalesce(json_extract(data, '$.end'), json_extract(data, '$.start')) >= ?";
		args.push(o.end, o.start);
	}
	for (const [k, v] of Object.entries(o.where ?? {})) {
		if (!/^\w+$/.test(k)) continue;
		q += ` AND json_extract(data, '$.${k}') = ?`;
		args.push(v);
	}
	const rows = db.query<{ data: string }, string[]>(q).all(...args);
	return rows.map((r) => {
		const d = JSON.parse(r.data);
		for (const k of o.omit ?? []) delete d[k];
		return pub(coll, d);
	});
}

export function get(coll: Coll, id: string): Doc | null {
	const r = sql.get.get(coll, id);
	return r ? JSON.parse(r.data) : null;
}

export const put = db.transaction((coll: Coll, doc: Doc): Doc => {
	const now = new Date().toISOString();
	doc = {
		...doc,
		id: doc.id || crypto.randomUUID(),
		createdAt: doc.createdAt ?? now,
		updatedAt: now
	};
	sql.put.run(coll, doc.id, JSON.stringify(doc));
	reindex(coll, doc, doc.id);
	return doc;
});

/** JSON merge patch: `null` deletes a key. */
export const patch = db.transaction(
	(coll: Coll, id: string, p: Record<string, unknown>): Doc | null => {
		const cur = get(coll, id);
		if (!cur) return null;
		for (const [k, v] of Object.entries(p)) {
			if (k === 'id') continue;
			if (v === null) delete cur[k];
			else cur[k] = v;
		}
		return put(coll, cur);
	}
);

export const remove = db.transaction((coll: Coll, id: string): Doc | null => {
	const cur = get(coll, id);
	sql.del.run(coll, id);
	reindex(coll, null, id);
	if (coll === 'files') rmSync(join(FILES_DIR, id), { force: true });
	if (coll === 'feeds')
		for (const d of list('feed_event', { where: { feedId: id } })) remove('feed_event', d.id);
	return cur;
});

/** The docs matching `where` (of those only the ones `stale` picks, if given) make way for `docs`. */
export const replaceAll = db.transaction(
	(coll: Coll, where: Record<string, string>, docs: Doc[], stale?: (d: Doc) => boolean) => {
		for (const d of list(coll, { where })) if (!stale || stale(d)) remove(coll, d.id);
		for (const d of docs) put(coll, d);
	}
);

export function search(text: string, limit = 40): SearchHit[] {
	const terms = text.match(/[\p{L}\p{N}_-]+/gu);
	if (!terms) return [];
	const match = terms.map((t) => `"${t}"*`).join(' ');
	return db
		.query<SearchHit, [string, number]>(
			"SELECT coll, id, project, title, snippet(fts, 4, char(1), char(2), '…', 12) AS snippet FROM fts WHERE fts MATCH ? ORDER BY bm25(fts, 0, 0, 0, 5, 1) LIMIT ?"
		)
		.all(match, limit)
		.map((h) => ({
			...h,
			snippet: escapeHtml(h.snippet).replaceAll('\x01', '<mark>').replaceAll('\x02', '</mark>')
		}));
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Nightly snapshot into DATA_DIR/backups, keeping the newest 14. */
export function backup() {
	mkdirSync(BACKUPS, { recursive: true });
	const file = join(BACKUPS, `commonplace-${new Date().toISOString().slice(0, 10)}.db`);
	rmSync(file, { force: true });
	db.run(`VACUUM INTO '${file.replaceAll("'", "''")}'`);
	const ours = readdirSync(BACKUPS).filter((f) => /^commonplace-.*\.db$/.test(f));
	for (const old of ours.sort().reverse().slice(14)) rmSync(join(BACKUPS, old));
	return file;
}

/** Validate a collection name from a URL; `feed_event` is read-only. */
export function coll(name: string, write = false): Coll {
	if (!isColl(name) || (write && name === 'feed_event')) error(404, 'Unknown collection');
	return name;
}

/** Is this part of the planner switched on (Settings › General)? Off = no background work for it. */
export const featureOn = (id: ModuleId) => on(get('settings', 'settings') as Settings | null, id);
