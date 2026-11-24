import { beforeAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { Database } from 'bun:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.TZ = 'Europe/Berlin';
process.env.DATA_DIR = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'commonplace-test-'));

let db: typeof import('../src/lib/server/db.ts');
let feeds: typeof import('../src/modules/calendar/server/feeds.ts');
beforeAll(async () => {
	db = await import('../src/lib/server/db.ts');
	feeds = await import('../src/modules/calendar/server/feeds.ts');
});

describe('document store', () => {
	test('merge patch, null deletes, search follows', () => {
		const t = db.put('tasks', {
			id: '',
			title: 'Buy groceries',
			description: 'milk and bread',
			tags: ['home']
		});
		expect(db.search('bread')[0].id).toBe(t.id);
		expect(db.search('home')[0].id).toBe(t.id);
		const p = db.patch('tasks', t.id, { description: null, priority: 2 })!;
		expect(p.description).toBeUndefined();
		expect(p.priority).toBe(2);
		expect(db.search('bread')).toHaveLength(0);
		expect(db.remove('tasks', t.id)?.title).toBe('Buy groceries');
		expect(db.search('groceries')).toHaveLength(0);
	});
	test('snippets are HTML-escaped', () => {
		db.put('events', {
			id: 'x',
			title: 'evil',
			start: '2026-01-01',
			description: '<img src=x onerror=alert(1)> payload'
		});
		expect(db.search('payload')[0].snippet).not.toContain('<img');
	});
	test('range filter', () => {
		db.put('feed_event', {
			id: 'a',
			feedId: 'f',
			title: 'in',
			start: '2026-03-02T10:00:00.000Z',
			end: '2026-03-02T11:00:00.000Z'
		});
		db.put('feed_event', { id: 'b', feedId: 'f', title: 'out', start: '2026-05-02T10:00:00.000Z' });
		const r = db.list('feed_event', { start: '2026-03-01T00:00:00Z', end: '2026-03-08T00:00:00Z' });
		expect(r.map((d) => d.title)).toEqual(['in']);
	});
	test('replacing only what is stale keeps the rest (feeds that keep past events)', () => {
		const ev = (id: string, start: string) => ({ id, feedId: 'keep', title: id, start });
		db.replaceAll('feed_event', { feedId: 'keep' }, [
			ev('old', '2026-01-05'),
			ev('gone', '2026-06-01T10:00:00.000Z'),
			ev('stays', '2026-06-02T10:00:00.000Z')
		]);
		db.replaceAll(
			'feed_event',
			{ feedId: 'keep' },
			[ev('stays', '2026-06-02T10:00:00.000Z'), ev('new', '2026-06-03')],
			(d) => (d.start as string) >= '2026-03-01T00:00:00.000Z'
		);
		const ids = db.list('feed_event', { where: { feedId: 'keep' } }).map((d) => d.id);
		expect(ids.sort()).toEqual(['new', 'old', 'stays']);
	});
});

const ICS = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VTIMEZONE
TZID:Europe/Berlin
BEGIN:DAYLIGHT
TZOFFSETFROM:+0100
TZOFFSETTO:+0200
DTSTART:19700329T020000
RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU
END:DAYLIGHT
BEGIN:STANDARD
TZOFFSETFROM:+0200
TZOFFSETTO:+0100
DTSTART:19701025T030000
RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU
END:STANDARD
END:VTIMEZONE
BEGIN:VEVENT
UID:standup
DTSTART;TZID=Europe/Berlin:20261019T090000
DTEND;TZID=Europe/Berlin:20261019T091500
RRULE:FREQ=WEEKLY;COUNT=4
EXDATE;TZID=Europe/Berlin:20261026T090000
SUMMARY:Standup
END:VEVENT
BEGIN:VEVENT
UID:standup
RECURRENCE-ID;TZID=Europe/Berlin:20261102T090000
DTSTART;TZID=Europe/Berlin:20261102T140000
DTEND;TZID=Europe/Berlin:20261102T141500
SUMMARY:Standup (moved)
END:VEVENT
BEGIN:VEVENT
UID:holiday
DTSTART;VALUE=DATE:20261225
DTEND;VALUE=DATE:20261226
SUMMARY:Christmas
END:VEVENT
END:VCALENDAR`;

test('ICS expansion: RRULE + EXDATE + RECURRENCE-ID + TZID + all-day', () => {
	const evs = feeds.expandIcs([ICS], 'f1', new Date('2026-10-01'), new Date('2027-01-01'));
	const standups = evs.filter((e) => e.title.startsWith('Standup'));
	expect(standups).toHaveLength(3); // 4 occurrences minus one EXDATE
	expect(standups[0].start).toBe('2026-10-19T07:00:00.000Z'); // 09:00 CEST
	expect(standups.find((e) => e.title === 'Standup (moved)')?.start).toBe(
		'2026-11-02T13:00:00.000Z'
	); // 14:00 CET
	expect(standups.at(-1)!.start).toBe('2026-11-09T08:00:00.000Z'); // 09:00 CET after DST
	const xmas = evs.find((e) => e.title === 'Christmas')!;
	expect(xmas).toMatchObject({ start: '2026-12-25', allDay: true });
});

test('planner.db and its backups from before the rename get the new name', () => {
	const dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'commonplace-test-'));
	const old = new Database(join(dir, 'planner.db'));
	old.run(
		'CREATE TABLE docs (coll TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (coll, id))'
	);
	old.run(`INSERT INTO docs VALUES ('notes', 'n1', '{"id":"n1","title":"Kept","type":"md"}')`);
	old.close();
	mkdirSync(join(dir, 'backups'));
	writeFileSync(join(dir, 'backups', 'planner-2026-01-01.db'), '');
	// db.ts renames when it is loaded: in a process of its own with that DATA_DIR
	const run = Bun.spawnSync(
		[
			'bun',
			'-e',
			`const db = await import('${import.meta.dir}/../src/lib/server/db.ts'); console.log(db.get('notes', 'n1')?.title)`
		],
		{ env: { ...process.env, DATA_DIR: dir }, cwd: `${import.meta.dir}/..` }
	);
	expect(run.stderr.toString()).toBe('');
	expect(run.stdout.toString().trim()).toBe('Kept');
	expect(existsSync(join(dir, 'planner.db'))).toBe(false);
	expect(existsSync(join(dir, 'commonplace.db'))).toBe(true);
	expect(readdirSync(join(dir, 'backups'))).toEqual(['commonplace-2026-01-01.db']);
});

test('a planner.db that is open elsewhere is used as it is and renamed later', () => {
	const dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'commonplace-test-'));
	const open = new Database(join(dir, 'planner.db'));
	open.run('PRAGMA journal_mode = WAL'); // another server has it: -wal and -shm are there
	open.run(
		'CREATE TABLE docs (coll TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (coll, id))'
	);
	open.run(`INSERT INTO docs VALUES ('notes', 'n1', '{"id":"n1","title":"Kept","type":"md"}')`);
	const load = () =>
		Bun.spawnSync(
			[
				'bun',
				'-e',
				`const db = await import('${import.meta.dir}/../src/lib/server/db.ts'); console.log(db.get('notes', 'n1')?.title)`
			],
			{ env: { ...process.env, DATA_DIR: dir }, cwd: `${import.meta.dir}/..` }
		)
			.stdout.toString()
			.trim();
	expect(load()).toBe('Kept');
	expect(existsSync(join(dir, 'planner.db'))).toBe(true);
	expect(existsSync(join(dir, 'commonplace.db'))).toBe(false);
	open.close(); // the other server stops
	expect(load()).toBe('Kept');
	expect(existsSync(join(dir, 'commonplace.db'))).toBe(true);
});
