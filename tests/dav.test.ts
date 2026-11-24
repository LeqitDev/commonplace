// CalDAV sync of events and tasks. Runs against a small CalDAV server in this file; set
// CALDAV_TEST_URL (e.g. http://127.0.0.1:5232/user/) to run it against a real one (Radicale).
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.TZ = 'Europe/Berlin';
process.env.DATA_DIR ??= mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'commonplace-test-'));

let db: typeof import('../src/lib/server/db.ts');
let dav: typeof import('../src/lib/server/dav.ts');

// ---------------------------------------------------------------- a minimal CalDAV server

const store = new Map<string, { data: string; etag: string }>();
let version = 0;
const xml = (s: string) => s.replace(/[&<>]/g, (c) => `&#${c.charCodeAt(0)};`);
const multistatus = (responses: [href: string, props: string][]) =>
	new Response(
		`<?xml version="1.0"?><multistatus xmlns="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:CS="http://calendarserver.org/ns/">${responses
			.map(
				([href, props]) =>
					`<response><href>${href}</href><propstat><prop>${props}</prop><status>HTTP/1.1 200 OK</status></propstat></response>`
			)
			.join('')}</multistatus>`,
		{ status: 207, headers: { 'content-type': 'text/xml' } }
	);
const item = (path: string, data = false) =>
	[
		path,
		`<getetag>${xml(store.get(path)!.etag)}</getetag>` +
			(data ? `<C:calendar-data>${xml(store.get(path)!.data)}</C:calendar-data>` : '')
	] as [string, string];

async function fake(req: Request) {
	const path = new URL(req.url).pathname;
	const cur = store.get(path);
	if (req.method === 'MKCALENDAR') return new Response(null, { status: 201 });
	if (req.method === 'PROPFIND') {
		const coll: [string, string] = [
			path,
			`<resourcetype><collection/><C:calendar/></resourcetype><CS:getctag>${version}</CS:getctag>`
		];
		const items = [...store.keys()].filter((p) => p.startsWith(path)).map((p) => item(p));
		return multistatus(req.headers.get('depth') === '1' ? [coll, ...items] : [coll]);
	}
	if (req.method === 'REPORT') {
		const hrefs = [...(await req.text()).matchAll(/href>([^<]+)</g)].map((m) => m[1]);
		return multistatus(hrefs.filter((h) => store.has(h)).map((h) => item(h, true)));
	}
	if (req.method === 'GET')
		return cur
			? new Response(cur.data, { headers: { etag: cur.etag } })
			: new Response(null, { status: 404 });
	const match = req.headers.get('if-match');
	if ((match && match !== cur?.etag) || (req.headers.get('if-none-match') === '*' && cur))
		return new Response(null, { status: 412 });
	if (req.method === 'PUT') {
		const etag = `"${++version}"`;
		store.set(path, { data: await req.text(), etag });
		return new Response(null, { status: cur ? 204 : 201, headers: { etag } });
	}
	if (req.method === 'DELETE') {
		version++;
		return new Response(null, { status: store.delete(path) ? 204 : 404 });
	}
	return new Response(null, { status: 405 });
}

// ---------------------------------------------------------------- setup

let server: ReturnType<typeof Bun.serve> | undefined;
let root: string;
let cal: string;
const run = Date.now().toString(36);

const mkcalendar = async (name: string) => {
	const url = `${root}${name}-${run}/`;
	await fetch(url, {
		method: 'MKCALENDAR',
		headers: { 'content-type': 'application/xml' },
		body: '<?xml version="1.0"?><C:mkcalendar xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><D:set><D:prop><C:supported-calendar-component-set><C:comp name="VEVENT"/><C:comp name="VTODO"/></C:supported-calendar-component-set></D:prop></D:set></C:mkcalendar>'
	});
	return url;
};
const remote = async (uid: string, base = cal) => {
	const res = await fetch(`${base}${uid}.ics`);
	return res.ok ? res.text() : null;
};
const remotePut = (uid: string, data: string) =>
	fetch(`${cal}${uid}.ics`, {
		method: 'PUT',
		headers: { 'content-type': 'text/calendar' },
		body: data
	});
/** A write through the API. */
const write = (coll: 'events' | 'tasks', id: string, p: Record<string, unknown>) => {
	db.patch(coll, id, p);
	dav.changed(coll, id);
};

beforeAll(async () => {
	db = await import('../src/lib/server/db.ts');
	dav = await import('../src/lib/server/dav.ts');
	if (process.env.CALDAV_TEST_URL) root = process.env.CALDAV_TEST_URL;
	else {
		server = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: fake });
		root = `http://127.0.0.1:${server.port}/`;
	}
	cal = await mkcalendar('cal');
});
afterAll(() => {
	delete process.env.CALDAV_URL;
	server?.stop(true);
});

describe('caldav', () => {
	test('without a server: resources are kept, nothing is sent', async () => {
		db.put('events', {
			id: 'dav-e',
			title: 'Standup',
			start: '2026-11-09T09:00:00.000Z',
			end: '2026-11-09T09:15:00.000Z',
			rrule: 'FREQ=WEEKLY',
			times: [
				{
					start: '2026-11-11T13:00:00.000Z',
					end: '2026-11-11T13:15:00.000Z',
					rrule: 'FREQ=WEEKLY'
				},
				{ start: '2026-11-13T08:00:00.000Z', end: '2026-11-13T08:15:00.000Z' }
			]
		});
		db.put('tasks', { id: 'dav-t', title: 'Report', deadline: '2026-11-20', priority: 2 });
		expect(dav.migrate()).toBeGreaterThanOrEqual(2);
		expect(dav.migrate()).toBe(0);
		expect(await dav.sync()).toBe(false);
		expect(dav.status()).toMatchObject({ configured: false, pending: 0 });
	});

	test('existing docs are uploaded', async () => {
		process.env.CALDAV_URL = cal;
		await dav.sync();
		expect(dav.status()).toMatchObject({ configured: true, pending: 0, error: null });
		expect(await remote('dav-e')).toContain('SUMMARY:Standup');
		expect(await remote('dav-e_t0')).toContain('RELATED-TO:dav-e');
		expect(await remote('dav-e_t1')).toContain('DTSTART:20261113T080000Z');
		expect(await remote('dav-t')).toContain('DUE;VALUE=DATE:20261120');
		// nothing to take over from our own uploads
		expect(await dav.sync()).toBe(false);
		expect(db.get('events', 'dav-e')?.times).toHaveLength(2);
	});

	test('edits here are sent', async () => {
		write('tasks', 'dav-t', { title: 'Annual report', status: 'doing' });
		expect(dav.status().pending).toBe(1);
		await dav.sync();
		const ics = (await remote('dav-t'))!;
		expect(ics).toContain('SUMMARY:Annual report');
		expect(ics).toContain('STATUS:IN-PROCESS');
		expect(dav.status().pending).toBe(0);
	});

	test('X-PLANNER-* from before the rename become X-COMMONPLACE-* here and there', async () => {
		write('tasks', 'dav-t', { projectId: 'p-x' });
		await dav.sync();
		// as written by a version from before 2026-11-24
		db.db.run(
			"UPDATE dav SET ics = replace(ics, 'X-COMMONPLACE-', 'X-PLANNER-'), dirty = 0 WHERE uid = 'dav-t'"
		);
		expect(dav.renameProps()).toBe(1);
		expect(dav.renameProps()).toBe(0);
		expect(dav.status().pending).toBe(1);
		await dav.sync();
		const ics = (await remote('dav-t'))!;
		expect(ics).toContain('X-COMMONPLACE-PROJECT:p-x');
		expect(ics).not.toContain('X-PLANNER-');
		expect(db.get('tasks', 'dav-t')?.projectId).toBe('p-x');
	});

	test('edits, new objects and deletions there are taken over', async () => {
		await remotePut(
			'dav-t',
			(await remote('dav-t'))!.replace('SUMMARY:Annual report', 'SUMMARY:From phone')
		);
		await remotePut(
			'phone',
			'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//x//EN\r\nBEGIN:VTODO\r\nUID:phone\r\nDTSTAMP:20261112T000000Z\r\nSUMMARY:Buy milk\r\nSTATUS:NEEDS-ACTION\r\nEND:VTODO\r\nEND:VCALENDAR\r\n'
		);
		expect(await dav.sync()).toBe(true);
		expect(db.get('tasks', 'dav-t')).toMatchObject({
			title: 'From phone',
			status: 'doing',
			priority: 2
		});
		expect(db.get('tasks', 'phone')?.title).toBe('Buy milk');
		expect(db.search('milk')[0]?.id).toBe('phone');
		await fetch(`${cal}phone.ics`, { method: 'DELETE' });
		expect(await dav.sync()).toBe(true);
		expect(db.get('tasks', 'phone')).toBeNull();
		expect(await dav.sync()).toBe(false);
	});

	test('changed on both sides: our fields on top of theirs', async () => {
		await remotePut(
			'dav-t',
			(await remote('dav-t'))!.replace('SUMMARY:From phone', 'SUMMARY:Theirs\r\nX-OTHER:kept')
		);
		write('tasks', 'dav-t', { priority: 1 });
		await dav.sync();
		const ics = (await remote('dav-t'))!;
		expect(ics).toContain('X-OTHER:kept');
		expect(ics).toContain('PRIORITY:1');
		expect(ics).toContain('SUMMARY:From phone');
		expect(dav.status()).toMatchObject({ pending: 0, error: null });
	});

	test('a time removed there: the others are numbered anew', async () => {
		await fetch(`${cal}dav-e_t0.ics`, { method: 'DELETE' });
		expect(await dav.sync()).toBe(true);
		expect(db.get('events', 'dav-e')?.times).toEqual([
			{ start: '2026-11-13T08:00:00.000Z', end: '2026-11-13T08:15:00.000Z' }
		]);
		expect(await remote('dav-e_t0')).toContain('DTSTART:20261113T080000Z');
		expect(await remote('dav-e_t1')).toBeNull();
	});

	test('delete, undo, delete', async () => {
		const doc = db.remove('events', 'dav-e')!;
		dav.changed('events', 'dav-e');
		db.put('events', doc); // undo before it was sent
		dav.changed('events', 'dav-e');
		await dav.sync();
		expect(await remote('dav-e')).toContain('SUMMARY:Standup');
		expect(await remote('dav-e_t0')).not.toBeNull();
		db.remove('events', 'dav-e');
		dav.changed('events', 'dav-e');
		await dav.sync();
		expect(await remote('dav-e')).toBeNull();
		expect(await remote('dav-e_t0')).toBeNull();
		db.put('events', doc); // undo after it was sent
		dav.changed('events', 'dav-e');
		await dav.sync();
		expect(await remote('dav-e')).toContain('SUMMARY:Standup');
	});

	test('an occurrence changed there is a doc of its own', async () => {
		const ics = (await remote('dav-e'))!;
		const override =
			'BEGIN:VEVENT\r\nUID:dav-e\r\nDTSTAMP:20261112T000000Z\r\nRECURRENCE-ID;TZID=Europe/Berlin:20261116T100000\r\nDTSTART;TZID=Europe/Berlin:20261116T120000\r\nDTEND;TZID=Europe/Berlin:20261116T121500\r\nSUMMARY:Standup (late)\r\nEND:VEVENT\r\n';
		await remotePut('dav-e', ics.replace('END:VCALENDAR', `${override}END:VCALENDAR`));
		expect(await dav.sync()).toBe(true);
		const id = 'dav-e_r20261116T100000';
		expect(db.get('events', id)).toMatchObject({
			title: 'Standup (late)',
			start: '2026-11-16T11:00:00.000Z'
		});
		expect(db.get('events', 'dav-e')?.exdates).toEqual(['2026-11-16T10:00:00']);
		write('events', id, { title: 'Standup (moved)' });
		await dav.sync();
		expect(await remote('dav-e')).toContain('SUMMARY:Standup (moved)');
		expect(await remote(id)).toBeNull();
		db.remove('events', id);
		dav.changed('events', id);
		await dav.sync();
		const after = (await remote('dav-e'))!;
		expect(after).not.toContain('RECURRENCE-ID');
		expect(after).toContain('EXDATE;TZID=Europe/Berlin:20261116T100000');
	});

	test('a server that fails deletes nothing', async () => {
		const n = db.list('tasks').length;
		process.env.CALDAV_URL = 'http://127.0.0.1:9/none/';
		expect(await dav.sync()).toBe(false);
		expect(dav.status().error).toBeTruthy();
		expect(db.list('tasks')).toHaveLength(n);
		process.env.CALDAV_URL = cal;
	});

	test('another collection gets everything, nothing is dropped here', async () => {
		const other = await mkcalendar('other');
		process.env.CALDAV_URL = other;
		expect(await dav.sync()).toBe(false);
		expect(dav.status()).toMatchObject({ pending: 0, error: null });
		expect(db.get('tasks', 'dav-t')?.title).toBe('From phone');
		expect(await remote('dav-t', other)).toContain('SUMMARY:From phone');
		expect(await remote('dav-e', other)).toContain('SUMMARY:Standup');
	});
});
