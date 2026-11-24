// Events and tasks live on a CalDAV server as VEVENT/VTODO resources. The `dav` table is the local
// copy of those resources (also without a server: iCalendar is the format either way); the docs of
// `events` and `tasks` are derived from it, and written back into it by `changed()`.
import {
	createCalendarObject,
	deleteCalendarObject,
	fetchCalendarObjects,
	getBasicAuthHeaders,
	propfind,
	updateCalendarObject
} from 'tsdav';
import ICAL from 'ical.js';
import { db, get, list, put, remove, type Coll } from './db.ts';
import { eventToIcs, parse, partOf, taskToIcs } from './ical.ts';
import type { CalEvent, Task } from '../types.ts';

interface Row {
	uid: string;
	coll: string;
	ics: string;
	href: string | null;
	etag: string | null;
	dirty: number;
	deleted: number;
}

const env = () => ({
	events: process.env.CALDAV_URL,
	tasks: process.env.CALDAV_TASKS_URL || process.env.CALDAV_URL
});
const headers = () =>
	process.env.CALDAV_USER
		? getBasicAuthHeaders({
				username: process.env.CALDAV_USER,
				password: process.env.CALDAV_PASSWORD ?? ''
			})
		: {};
const dir = (url: string) => url.replace(/\/*$/, '/');

const sql = {
	get: db.query<Row, [string]>('SELECT * FROM dav WHERE uid = ?'),
	family: db.query<Row, [string, string]>(
		'SELECT * FROM dav WHERE substr(uid, 1, length(?1)) = ?1 AND coll = ?2'
	),
	put: db.query(
		'INSERT INTO dav (uid, coll, ics, dirty) VALUES (?1, ?2, ?3, 1) ON CONFLICT (uid) DO UPDATE SET coll = ?2, ics = ?3, dirty = 1, deleted = 0'
	),
	pulled: db.query(
		'INSERT INTO dav (uid, coll, ics, href, etag) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT (uid) DO UPDATE SET coll = ?2, ics = ?3, href = ?4, etag = ?5'
	),
	del: db.query('DELETE FROM dav WHERE uid = ?'),
	bury: db.query('UPDATE dav SET dirty = 1, deleted = 1 WHERE uid = ?'),
	pushed: db.query('UPDATE dav SET href = ?2, etag = ?3, dirty = (ics != ?4) WHERE uid = ?1'),
	dirty: db.query<Row, []>('SELECT * FROM dav WHERE dirty = 1'),
	synced: db.query<Row, []>('SELECT * FROM dav WHERE href IS NOT NULL'),
	overrides: db.query<{ data: string }, [string]>(
		"SELECT data FROM docs WHERE coll = 'events' AND substr(id, 1, length(?1)) = ?1"
	),
	meta: db.query<{ value: string }, [string]>('SELECT value FROM meta WHERE key = ?'),
	setMeta: db.query('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)')
};
const meta = (key: string) => sql.meta.get(key)?.value ?? null;
const setMeta = (key: string, value: string | null) => sql.setMeta.run(key, value);

/** The resources holding the further times of event `id`, by index. */
const timeRows = (id: string) =>
	sql.family
		.all(`${id}_t`, 'events')
		.filter((r) => !r.deleted && /^\d+$/.test(r.uid.slice(id.length + 2)))
		.map((r) => [Number(r.uid.slice(id.length + 2)), r] as const)
		.sort((a, b) => a[0] - b[0]);
/** The docs of the occurrences of event `id` that were changed in another app. */
const overrideDocs = (id: string) =>
	sql.overrides
		.all(`${id}_r`)
		.map((r) => JSON.parse(r.data) as CalEvent)
		.filter((d) => partOf(d.id)?.[0] === id);

/** The doc that owns the resources doc `id` is written to (a changed occurrence is in its series'). */
function owner(coll: Coll, id: string) {
	const part = coll === 'events' && !sql.get.get(id) ? partOf(id) : null;
	return part && part[1] === undefined && sql.get.get(part[0]) ? part[0] : id;
}

/** Bring the resources of a doc in line with it (they become dirty; a missing doc buries them). */
const rebuild = db.transaction((coll: 'events' | 'tasks', docId: string) => {
	const id = owner(coll, docId);
	const doc = get(coll, id);
	const rows = [sql.get.get(id), ...(coll === 'events' ? timeRows(id).map(([, r]) => r) : [])];
	const prev = Object.fromEntries(rows.filter((r) => !!r).map((r) => [r.uid, r.ics]));
	const next = !doc
		? {}
		: coll === 'tasks'
			? { [id]: taskToIcs(doc as Task, prev[id]) }
			: eventToIcs(doc as CalEvent, prev, overrideDocs(id));
	for (const [uid, ics] of Object.entries(next)) sql.put.run(uid, coll, ics);
	for (const r of rows) if (r && !(r.uid in next)) (r.href ? sql.bury : sql.del).run(r.uid);
	if (!doc && coll === 'events') for (const d of overrideDocs(id)) remove('events', d.id);
});

/** An event or task was written through the API. */
export function changed(coll: Coll, id: string) {
	if (coll !== 'events' && coll !== 'tasks') return;
	rebuild(coll, id);
	clearTimeout(timer);
	timer = setTimeout(() => void sync(false), 1000); // the editors save field by field
}
let timer: ReturnType<typeof setTimeout> | undefined;

/** One-time conversion: docs from before there were resources get theirs. Returns how many. */
export function migrate() {
	let n = 0;
	for (const coll of ['events', 'tasks'] as const)
		for (const d of list(coll))
			if (!sql.get.get(owner(coll, d.id))) {
				rebuild(coll, d.id);
				n++;
			}
	return n;
}

/** One-time conversion: our properties were X-PLANNER-* until 2026-11-24 (now X-COMMONPLACE-*).
 *  The rows become dirty, so the next push takes the new text to the CalDAV server. */
export const renameProps = db.transaction(() => {
	const rows = db
		.query<Row, []>("SELECT * FROM dav WHERE deleted = 0 AND ics LIKE '%X-PLANNER-%'")
		.all();
	const update = db.query('UPDATE dav SET ics = ?2, dirty = 1 WHERE uid = ?1');
	for (const r of rows) update.run(r.uid, r.ics.replace(/^X-PLANNER-/gm, 'X-COMMONPLACE-'));
	return rows.length;
});

/** Derive the docs from a resource. Returns false if nothing came of it. */
const project = db.transaction((row: Row): boolean => {
	const p = parse(row.ics);
	if (!p) return false;
	if (p.coll === 'tasks') {
		put('tasks', p.docs[0]);
		return true;
	}
	const parent = p.parent && sql.get.get(p.parent);
	if (parent && !parent.deleted) return project(parent);
	const [event, ...overrides] = p.docs as CalEvent[];
	const rows = timeRows(p.uid);
	const times = rows.flatMap(([, r]) => {
		const t = parse(r.ics)?.docs[0] as CalEvent | undefined;
		if (!t) return [];
		for (const x of t.exdates ?? [])
			if (!event.exdates?.includes(x)) event.exdates = [...(event.exdates ?? []), x];
		return [{ start: t.start, ...(t.end && { end: t.end }), ...(t.rrule && { rrule: t.rrule }) }];
	});
	put('events', { ...event, ...(times.length && { times }) });
	for (const d of overrideDocs(p.uid))
		if (!overrides.some((o) => o.id === d.id)) remove('events', d.id);
	for (const o of overrides) put('events', o);
	// a time was removed elsewhere: number the ones after it anew
	if (rows.some(([n], i) => n !== i)) rebuild('events', p.uid);
	return true;
});

/** A resource is gone from the server. */
const dropped = db.transaction((row: Row) => {
	sql.del.run(row.uid);
	const p = row.coll === 'other' ? null : parse(row.ics);
	if (!p) return;
	const parent = p.parent && sql.get.get(p.parent);
	if (parent && !parent.deleted) return void project(parent);
	remove(p.coll, p.uid);
	if (p.coll !== 'events') return;
	for (const d of overrideDocs(p.uid)) remove('events', d.id);
	for (const [, r] of timeRows(p.uid)) (r.href ? sql.bury : sql.del).run(r.uid);
});

// ---------------------------------------------------------------- talking to the server

const fetchOne = async (url: string) =>
	(
		await fetchCalendarObjects({
			calendar: { url: dir(new URL('.', url).href) },
			objectUrls: [url],
			urlFilter: () => true,
			headers: headers()
		})
	)[0];

async function send(r: Row, base: string) {
	const url = r.href ?? new URL(`${encodeURIComponent(r.uid)}.ics`, dir(base)).href;
	if (r.deleted) {
		// what was changed on the server in the meantime goes as well
		const res = r.href
			? await deleteCalendarObject({ calendarObject: { url, etag: '' }, headers: headers() })
			: null;
		if (res && !res.ok && res.status !== 404) throw new Error(`DELETE ${res.status}`);
		return void sql.del.run(r.uid);
	}
	const res = r.href
		? await updateCalendarObject({
				calendarObject: { url, data: r.ics, etag: r.etag ?? '' },
				headers: headers()
			})
		: await createCalendarObject({
				calendar: { url: dir(base) },
				filename: `${encodeURIComponent(r.uid)}.ics`,
				iCalString: r.ics,
				headers: headers()
			});
	if (res.ok) return void sql.pushed.run(r.uid, url, res.headers.get('etag'), r.ics);
	if (res.status !== 412 && res.status !== 404) throw new Error(`PUT ${res.status}`);
	// changed (or gone) on the server since we saw it: our fields go on top of what is there now
	const remote = res.status === 412 ? await fetchOne(url) : undefined;
	sql.pulled.run(r.uid, r.coll, remote?.data ?? r.ics, remote ? url : null, remote?.etag ?? null);
	rebuild(r.coll as 'events' | 'tasks', r.uid);
	return true;
}

async function push() {
	const urls = env();
	for (let round = 0; round < 2; round++) {
		let again = false;
		for (const r of sql.dirty.all()) {
			const base = urls[r.coll as 'events' | 'tasks'];
			if (base && (await send(r, base))) again = true;
		}
		if (!again) return;
	}
}

const prop = (r: { props?: Record<string, unknown> } | undefined, name: string) => {
	const v = r?.props?.[name];
	return typeof v === 'string' || typeof v === 'number' ? String(v) : null;
};
/** PROPFIND that throws unless the server answered with properties: a failed request (or a login
 *  page) must not read as an empty collection, or everything here would count as deleted there. */
async function props(url: string, names: string[], depth: '0' | '1') {
	const res = await propfind({
		url,
		props: Object.fromEntries(['d:resourcetype', ...names].map((n) => [n, {}])),
		depth,
		headers: headers()
	});
	if (!res.some((r) => r.props)) throw new Error(`PROPFIND ${res[0]?.status ?? ''} ${url}`);
	return res;
}

/** Take over what changed on the server. Returns whether any doc changed. */
async function pull() {
	let changes = false;
	const known = new Map(sql.synced.all().map((r) => [r.href!, r]));
	for (const base of new Set(Object.values(env()).map((u) => dir(u!)))) {
		const ctag = prop((await props(base, ['cs:getctag'], '0'))[0], 'getctag');
		if (ctag && ctag === meta(`ctag:${base}`)) continue;
		const remote = new Map(
			(await props(base, ['d:getetag'], '1'))
				.filter((r) => r.href && prop(r, 'getetag') && new URL(r.href, base).href !== base)
				.map((r) => [new URL(r.href!, base).href, prop(r, 'getetag')!])
		);
		const fetch = [...remote].filter(([href, etag]) => known.get(href)?.etag !== etag);
		const objects = fetch.length
			? await fetchCalendarObjects({
					calendar: { url: base },
					objectUrls: fetch.map(([href]) => href),
					urlFilter: () => true,
					headers: headers()
				})
			: [];
		const touched: Row[] = [];
		for (const o of objects) {
			if (typeof o.data !== 'string') throw new Error(`REPORT failed for ${o.url}`);
			const href = new URL(o.url, base).href;
			const p = parse(o.data);
			// remembered, so it isn't fetched again
			if (!p) {
				sql.pulled.run(href, 'other', '', href, o.etag ?? null);
				continue;
			}
			const cur = sql.get.get(p.uid);
			sql.pulled.run(p.uid, p.coll, o.data, href, o.etag ?? null);
			// changed here as well: our fields go on top, and it stays to be pushed
			if (cur?.dirty) {
				if (!cur.deleted) rebuild(p.coll, p.uid);
			} else touched.push(sql.get.get(p.uid)!);
		}
		// all rows first: a further time may come before its event
		for (const r of touched) if (project(r)) changes = true;
		for (const [href, r] of known) {
			if (!href.startsWith(base) || remote.has(href)) continue;
			if (r.dirty && !r.deleted)
				sql.pulled.run(r.uid, r.coll, r.ics, null, null); // push it again
			else {
				dropped(r);
				changes ||= r.coll !== 'other' && !r.deleted;
			}
		}
		if (ctag) setMeta(`ctag:${base}`, ctag);
	}
	return changes;
}

// ---------------------------------------------------------------- sync

let running: Promise<boolean> = Promise.resolve(false);

/** Push what changed here, then (unless `full` is false) take over what changed there. */
export function sync(full = true): Promise<boolean> {
	return (running = running.then(async () => {
		const urls = env();
		if (!urls.events) return false;
		try {
			// another collection than last time: nothing here is known to it, and nothing missing in
			// it was deleted
			const target = `${urls.events} ${urls.tasks}`;
			if (meta('target') !== target) {
				db.run("DELETE FROM dav WHERE deleted = 1 OR coll = 'other'");
				db.run('UPDATE dav SET href = NULL, etag = NULL, dirty = 1');
				db.run("DELETE FROM meta WHERE key LIKE 'ctag:%'");
				setMeta('target', target);
			}
			await push();
			const changes = full ? await pull() : false;
			if (full) await push(); // what the pull merged
			setMeta('lastSync', new Date().toISOString());
			setMeta('error', null);
			return changes;
		} catch (e) {
			setMeta('error', String(e));
			return false;
		}
	}));
}

export const status = () => ({
	configured: !!env().events,
	lastSync: meta('lastSync'),
	error: meta('error'),
	pending: env().events ? sql.dirty.all().length : 0
});

// ---------------------------------------------------------------- invitations

/** An event from elsewhere (an invitation): its iCalendar text is kept as it is (ORGANIZER,
 *  ATTENDEE, …; only METHOD goes, which a calendar resource must not have), and `extra` are the
 *  planner's fields on top. Returns the event's id (its UID). */
export function importEvent(ics: string, extra: Partial<CalEvent>): string | null {
	const cal = new ICAL.Component(ICAL.parse(ics));
	cal.removeAllProperties('method');
	const text = cal.toString();
	const p = parse(text);
	if (!p || p.coll !== 'events') return null;
	db.transaction(() => {
		sql.put.run(p.uid, 'events', text);
		put('events', { ...(p.docs[0] as CalEvent), ...extra });
		rebuild('events', p.uid); // writes our fields into the text, the rest stays
	})();
	changed('events', p.uid);
	return p.uid;
}

/** Set the PARTSTAT of our ATTENDEE line (by address) in an event's resource. */
export function setPartstat(uid: string, address: string, partstat: string) {
	const row = sql.get.get(uid);
	if (!row) return false;
	const cal = new ICAL.Component(ICAL.parse(row.ics));
	let found = false;
	for (const v of cal.getAllSubcomponents('vevent'))
		for (const a of v.getAllProperties('attendee'))
			if (
				String(a.getFirstValue())
					.replace(/^mailto:/i, '')
					.toLowerCase() === address.toLowerCase()
			) {
				a.setParameter('partstat', partstat);
				a.removeParameter('rsvp');
				found = true;
			}
	if (found) sql.put.run(uid, 'events', cal.toString());
	return found;
}

/** The iCalendar text of an event's own resource. */
export const eventIcs = (uid: string) => sql.get.get(uid)?.ics ?? null;
