import { describe, expect, test } from 'bun:test';
import {
	columns,
	eventToFc,
	feedVisible,
	isInbox,
	localIso,
	nextAfter,
	nextInstance,
	taskToEvents
} from '../src/lib/tasks.ts';
import {
	canvasText,
	DEFAULT_PDF_LAYOUT,
	flatten,
	pdfLayout,
	touchMove
} from '../src/lib/canvas.ts';
import { applyTemplate, isDue, review } from '../src/modules/cards/cards.ts';
import type { Card, Feed, Task } from '../src/lib/types.ts';

process.env.TZ = 'Europe/Berlin';

describe('inbox rule', () => {
	test('untriaged task is in the inbox', () => expect(isInbox({ id: '1', title: 'x' })).toBe(true));
	test.each([
		['start', { start: '2026-11-10T08:00:00Z' }],
		['deadline', { deadline: '2026-11-10' }],
		['priority', { priority: 2 }],
		['status', { status: 'todo' }],
		['reminder', { reminders: ['2026-11-10T08:00:00Z'] }],
		['subtask', { parentId: 'p' }]
	])('%s removes it', (_, extra) =>
		expect(isInbox({ id: '1', title: 'x', ...extra } as Task)).toBe(false)
	);
});

describe('recurrence', () => {
	test('weekly stays at local 09:00 across DST', () => {
		const anchor = new Date('2026-10-19T09:00:00'); // Monday, CEST
		const next = nextAfter('FREQ=WEEKLY', anchor, new Date('2026-10-30T12:00:00'))!;
		expect(next.getDate()).toBe(2); // 2 Nov, after DST ended
		expect(next.getHours()).toBe(9);
	});
	test('next instance shifts dates and resets status', () => {
		const t: Task = {
			id: 'a',
			title: 'Gym',
			rrule: 'FREQ=DAILY',
			status: 'done',
			deadline: '2026-11-09',
			completedAt: 'x'
		};
		const n = nextInstance(t, new Date('2026-11-09T10:00:00'))!;
		expect(n.deadline).toBe('2026-11-10');
		expect(n.status).toBe('todo');
		expect('id' in n || 'completedAt' in n).toBe(false);
	});
	test('task without dates becomes event only when scheduled', () => {
		expect(taskToEvents({ id: 'a', title: 'x' })).toEqual([]);
		const [e] = taskToEvents({
			id: 'a',
			title: 'x',
			start: '2026-11-10T08:00:00.000Z',
			estimate: 45
		});
		expect(e.end).toBe('2026-11-10T08:45:00.000Z');
	});
	test('a scheduled task with a deadline is a block and a marker on the deadline', () => {
		const es = taskToEvents({
			id: 'a',
			title: 'x',
			start: '2026-11-10T08:00:00.000Z',
			deadline: '2026-11-12'
		});
		expect(es.map((e) => [e.id, e.start, e.allDay])).toEqual([
			['task:a', '2026-11-10T08:00:00.000Z', false],
			['deadline:a', '2026-11-12', true]
		]);
	});
	test('tentative events are marked', () => {
		const [e] = eventToFc(
			{ id: 'e', title: 'x', start: '2026-11-10', tentative: true },
			new Date(0),
			new Date()
		);
		expect(e.className).toBe('tentative');
	});
});

describe('columns of overlapping spans', () => {
	test('spans that overlap share the width, others keep it', () => {
		// 0: 9–11, 1: 10–12, 2: 10–10:30, 3: 11–12 (free column of 0), 4: 14–15 (alone)
		expect(
			columns([
				[9, 11],
				[10, 12],
				[10, 10.5],
				[11, 12],
				[14, 15]
			])
		).toEqual([
			{ i: 0, n: 3 },
			{ i: 1, n: 3 },
			{ i: 2, n: 3 },
			{ i: 0, n: 3 },
			{ i: 0, n: 1 }
		]);
	});
	test('one that ends where the next starts does not overlap it', () => {
		expect(
			columns([
				[9, 10],
				[10, 11]
			])
		).toEqual([
			{ i: 0, n: 1 },
			{ i: 0, n: 1 }
		]);
	});
});

test('canvas text in reading order', () => {
	const els = [
		{ id: '1', type: 'text', x: 0, y: 100, text: 'second' },
		{ id: '2', type: 'text', x: 0, y: 0, text: 'first' },
		{ id: '3', type: 'rectangle', x: 0, y: 50 },
		{ id: '4', type: 'text', x: 0, y: 200, text: 'gone', isDeleted: true }
	];
	expect(canvasText(els)).toBe('first\n\nsecond');
});

describe('calendar colours', () => {
	// a `color: undefined` key turns into the string "undefined" in FullCalendar (transparent fill)
	test('uncoloured items carry no color key', () => {
		expect('color' in taskToEvents({ id: 'a', title: 'x', deadline: '2026-11-10' })[0]).toBe(false);
		const [e] = eventToFc({ id: 'e', title: 'x', start: '2026-11-10' }, new Date(0), new Date());
		expect('color' in e).toBe(false);
		expect(taskToEvents({ id: 'a', title: 'x', deadline: '2026-11-10' }, '#f00')[0].color).toBe(
			'#f00'
		);
	});
});

describe('feed visibility', () => {
	const feed = (p: Partial<Feed>): Feed => ({ id: 'f', name: 'f', type: 'ics', url: '', ...p });
	test('"All projects" shows every feed', () => {
		for (const show of [undefined, 'all', 'always', 'projects'] as const)
			expect(feedVisible(feed({ show }), null)).toBe(true);
	});
	test('default: hidden while a project is focused', () => {
		expect(feedVisible(feed({}), 'p1')).toBe(false);
		expect(feedVisible(feed({ show: 'all' }), 'p1')).toBe(false);
	});
	test('always', () => expect(feedVisible(feed({ show: 'always' }), 'p1')).toBe(true));
	test('disabled feeds are never shown', () => {
		expect(feedVisible(feed({ enabled: false }), null)).toBe(false);
		expect(feedVisible(feed({ enabled: false, show: 'always' }), 'p1')).toBe(false);
	});
	test('chosen projects', () => {
		const f = feed({ show: 'projects', projectIds: ['p1', 'p2'] });
		expect(feedVisible(f, 'p2')).toBe(true);
		expect(feedVisible(f, 'p3')).toBe(false);
		expect(feedVisible(feed({ show: 'projects' }), 'p1')).toBe(false);
	});
});

describe('pdf layout', () => {
	const pages = [
		{ w: 100, h: 140 },
		{ w: 100, h: 140 },
		{ w: 100, h: 140 }
	];
	const o = (p: Partial<typeof DEFAULT_PDF_LAYOUT>) => ({ ...DEFAULT_PDF_LAYOUT, gap: 10, ...p });
	test('column', () =>
		expect(pdfLayout(pages, o({})).map((r) => [r.x, r.y])).toEqual([
			[0, 0],
			[0, 150],
			[0, 300]
		]));
	test('row with scale', () =>
		expect(pdfLayout(pages, o({ layout: 'row', scale: 0.5 }))).toEqual([
			{ x: 0, y: 0, width: 50, height: 70 },
			{ x: 60, y: 0, width: 50, height: 70 },
			{ x: 120, y: 0, width: 50, height: 70 }
		]));
	test('spread, cover page alone (odd start)', () =>
		expect(
			pdfLayout(pages, o({ layout: 'spread', coverAlone: true })).map((r) => [r.x, r.y])
		).toEqual([
			[110, 0], // right of the spine
			[0, 150],
			[110, 150]
		]));
	test('spread, pages 1–2 together (even start)', () =>
		expect(
			pdfLayout(pages, o({ layout: 'spread', coverAlone: false })).map((r) => [r.x, r.y])
		).toEqual([
			[0, 0],
			[110, 0],
			[0, 150]
		]));
});

describe('flashcard scheduling', () => {
	const now = new Date('2026-11-10T12:00:00Z');
	const card = (p: Partial<Card> = {}): Card => ({
		id: 'c',
		deckId: 'd',
		front: 'q',
		back: 'a',
		...p
	});
	const mins = (iso: string) => (new Date(iso).getTime() - now.getTime()) / 60_000;

	test('new cards are due', () => expect(isDue(card(), now)).toBe(true));
	test('again comes back within minutes, good much later', () => {
		const again = review(card(), false, now);
		const good = review(card(), true, now);
		expect(mins(again.due!)).toBeLessThan(15);
		expect(mins(good.due!)).toBeGreaterThan(mins(again.due!));
		expect(isDue({ due: again.due }, now)).toBe(false);
	});
	test('good leaves the session: new card and after again are scheduled ≥ 1 day', () => {
		const DAY = 24 * 60;
		expect(mins(review(card(), true, now).due!)).toBeGreaterThanOrEqual(DAY);
		const again = { ...card(), ...review(card(), false, now) };
		expect(mins(again.due!)).toBeLessThanOrEqual(1);
		const t = new Date(again.due!);
		const good = review(again, true, t);
		expect((new Date(good.due!).getTime() - t.getTime()) / 60_000).toBeGreaterThanOrEqual(DAY);
	});
	test('intervals grow with repeated good answers', () => {
		let c = card();
		let t = now;
		const gaps: number[] = [];
		for (let i = 0; i < 4; i++) {
			const r = review(c, true, t);
			gaps.push(new Date(r.due!).getTime() - t.getTime());
			t = new Date(r.due!);
			c = { ...c, ...r };
		}
		expect(gaps[3]).toBeGreaterThan(gaps[1]);
		expect(c.srs!.reps).toBe(4);
		// stored state is plain JSON (no Date objects)
		expect(JSON.parse(JSON.stringify(c))).toEqual(c);
	});
	test('again after good counts a lapse', () => {
		let c = card();
		let t = now;
		for (let i = 0; i < 3; i++) {
			const r = review(c, true, t);
			t = new Date(r.due!);
			c = { ...c, ...r };
		}
		c = { ...c, ...review(c, false, t) };
		expect(c.srs!.lapses).toBe(1);
	});
});

describe('card templates', () => {
	test('marker is replaced (every occurrence, `$` patterns stay literal)', () => {
		expect(applyTemplate('$x$', '*Q:* %box_content%')).toBe('*Q:* $x$');
		expect(applyTemplate('$$ and $&', '[%box_content%|%box_content%]')).toBe(
			'[$$ and $&|$$ and $&]'
		);
	});
	test('deck template wins, empty falls back to global, none = content', () => {
		expect(applyTemplate('a', 'deck %box_content%', 'global %box_content%')).toBe('deck a');
		expect(applyTemplate('a', '  ', 'global %box_content%')).toBe('global a');
		expect(applyTemplate('a', undefined, '')).toBe('a');
	});
	test('template without marker is a preamble; empty boxes render nothing', () => {
		expect(applyTemplate('a', '#set text(red)')).toBe('#set text(red)\na');
		expect(applyTemplate('  ', 'x %box_content%')).toBe('');
	});
});

describe('canvas pen UI', () => {
	test('flatten gives an even width once', () => {
		const stroke = { points: [1, 2, 3], simulatePressure: true, pressures: [] as number[] };
		const flat = flatten(stroke)!;
		expect(flat).toEqual({ simulatePressure: false, pressures: [0.5, 0.5, 0.5] });
		expect(flatten({ ...stroke, ...flat })).toBeNull();
		expect(flatten({ ...stroke, simulatePressure: false, pressures: [0.2, 0.9, 0.4] })).toEqual(
			flat
		);
	});
	test('one finger pans by its way in scene units', () => {
		const v = touchMove(
			{ scrollX: 10, scrollY: 20, zoom: 2 },
			[{ x: 100, y: 100 }],
			[{ x: 140, y: 90 }]
		);
		expect(v).toEqual({ scrollX: 30, scrollY: 15, zoom: 2 });
	});
	test('two fingers zoom around their centre', () => {
		const view = { scrollX: 0, scrollY: 0, zoom: 1 };
		const prev = [
			{ x: 100, y: 200 },
			{ x: 200, y: 200 }
		];
		const next = [
			{ x: 50, y: 200 },
			{ x: 250, y: 200 }
		];
		const v = touchMove(view, prev, next);
		expect(v.zoom).toBe(2);
		// the scene point under the centre (150, 200) is still there: x / zoom - scroll
		expect([150 / v.zoom - v.scrollX, 200 / v.zoom - v.scrollY]).toEqual([150, 200]);
		expect(touchMove({ ...view, zoom: 20 }, prev, next).zoom).toBe(30);
	});
});

describe('events with further times', () => {
	const range = [new Date(2026, 10, 9), new Date(2026, 10, 16)] as const; // a week from Monday
	const event = {
		id: 'e',
		title: 'Lecture',
		start: new Date(2026, 10, 9, 10).toISOString(), // Monday 10:00
		end: new Date(2026, 10, 9, 11).toISOString(),
		rrule: 'FREQ=WEEKLY;BYDAY=MO,FR',
		times: [
			{
				start: new Date(2026, 10, 11, 14).toISOString(), // Wednesday 14:00
				end: new Date(2026, 10, 11, 16).toISOString(),
				rrule: 'FREQ=WEEKLY'
			},
			{ start: new Date(2026, 10, 12, 8).toISOString() } // once, on Thursday
		]
	};
	const hours = (es: ReturnType<typeof eventToFc>) =>
		es.map((e) => [new Date(e.start).getDay(), new Date(e.start).getHours(), e.extendedProps.time]);

	test('every time gives its own entries', () => {
		const es = eventToFc(event, ...range);
		expect(hours(es)).toEqual([
			[1, 10, undefined],
			[5, 10, undefined],
			[3, 14, 0],
			[4, 8, 1]
		]);
		expect(new Set(es.map((e) => e.id)).size).toBe(es.length);
		expect(new Date(es[2].end!).getHours()).toBe(16);
	});

	test('skipped occurrences are shared', () => {
		const exdates = [localIso(new Date(2026, 10, 11, 14)), localIso(new Date(2026, 10, 13, 10))];
		expect(hours(eventToFc({ ...event, exdates }, ...range)).map(([day]) => day)).toEqual([1, 4]);
	});
});
