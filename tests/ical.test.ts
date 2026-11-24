import { describe, expect, test } from 'bun:test';
import ICAL from 'ical.js';

process.env.TZ = 'Europe/Berlin';
const { eventToIcs, taskToIcs, parse } = await import('../src/lib/server/ical.ts');
import type { CalEvent, Task } from '../src/lib/types.ts';

const createdAt = '2026-01-01T08:00:00.000Z';
const event = (e: Partial<CalEvent>): CalEvent => ({
	id: 'e1',
	title: 'Meeting',
	start: '',
	createdAt,
	...e
});
const task = (t: Partial<Task>): Task => ({ id: 't1', title: 'Write', createdAt, ...t });
/** Through iCalendar and back. */
const viaIcs = (e: CalEvent) => parse(eventToIcs(e)[e.id])!.docs[0];
const taskViaIcs = (t: Task) => parse(taskToIcs(t))!.docs[0];
const lines = (ics: string) => ics.split('\r\n');

describe('events', () => {
	test('timed event with every field', () => {
		const e = event({
			start: '2026-11-12T09:00:00.000Z',
			end: '2026-11-12T10:30:00.000Z',
			description: 'Agenda; with, commas\nand lines',
			location: 'Room 1',
			tags: ['work', 'a,b'],
			projectId: 'p1',
			categoryId: 'c1',
			tentative: true
		});
		const ics = eventToIcs(e)[e.id];
		expect(lines(ics)).toContain('DTSTART:20261112T090000Z');
		expect(lines(ics)).toContain('STATUS:TENTATIVE');
		expect(lines(ics)).toContain('UID:e1');
		expect(viaIcs(e)).toEqual(e);
	});
	test('all-day event: DATE values, exclusive end', () => {
		const e = event({ start: '2026-11-12', end: '2026-11-14', allDay: true });
		const ics = eventToIcs(e)[e.id];
		expect(lines(ics)).toContain('DTSTART;VALUE=DATE:20261112');
		expect(lines(ics)).toContain('DTEND;VALUE=DATE:20261114');
		expect(viaIcs(e)).toEqual(e);
	});
	test('recurring event is written in the local timezone, exdates follow', () => {
		const e = event({
			start: '2026-10-19T08:00:00.000Z', // 10:00 CEST
			end: '2026-10-19T09:00:00.000Z',
			rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
			exdates: ['2026-10-26T10:00:00'] // after the change to CET
		});
		const ics = eventToIcs(e)[e.id];
		expect(lines(ics)).toContain('DTSTART;TZID=Europe/Berlin:20261019T100000');
		expect(lines(ics)).toContain('EXDATE;TZID=Europe/Berlin:20261026T100000');
		expect(ics).toContain('BEGIN:VTIMEZONE');
		expect(viaIcs(e)).toEqual(e);
		// other apps see 10:00 local time on both sides of the DST change
		const ev = new ICAL.Event(new ICAL.Component(ICAL.parse(ics)).getFirstSubcomponent('vevent')!);
		const it = ev.iterator();
		const starts = Array.from({ length: 7 }, () => it.next().toJSDate().toISOString());
		expect(starts[4]).toBe('2026-10-23T08:00:00.000Z');
		expect(starts[5]).toBe('2026-10-27T09:00:00.000Z'); // the 26th is skipped
	});
	test('presets keep their spelling', () => {
		for (const rrule of [
			'FREQ=WEEKLY;INTERVAL=2',
			'FREQ=DAILY',
			'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR'
		])
			expect(viaIcs(event({ start: '2026-11-12', allDay: true, rrule })).rrule).toBe(rrule);
	});
	test('UNTIL gets the type of DTSTART', () => {
		const timed = eventToIcs(
			event({ start: '2026-11-12T09:00:00.000Z', rrule: 'FREQ=DAILY;UNTIL=20261120' })
		);
		expect(timed.e1).toContain('UNTIL=20261120T225959Z');
		const day = eventToIcs(
			event({ start: '2026-11-12', allDay: true, rrule: 'FREQ=DAILY;UNTIL=20261120T120000Z' })
		);
		expect(day.e1).toContain('UNTIL=20261120');
		expect(day.e1).not.toContain('UNTIL=20261120T');
	});
	test('further times are resources of their own, tied to the event', () => {
		const e = event({
			start: '2026-11-09T09:00:00.000Z',
			end: '2026-11-09T10:00:00.000Z',
			rrule: 'FREQ=WEEKLY',
			exdates: ['2026-11-16T10:00:00'],
			times: [
				{ start: '2026-11-11T13:00:00.000Z', end: '2026-11-11T14:00:00.000Z', rrule: 'FREQ=WEEKLY' }
			]
		});
		const out = eventToIcs(e);
		expect(Object.keys(out)).toEqual(['e1', 'e1_t0']);
		const t = parse(out.e1_t0)!;
		expect(t.parent).toBe('e1');
		expect(t.docs[0]).toMatchObject({ title: 'Meeting', ...e.times![0] });
		expect(parse(out.e1)!.parent).toBeUndefined();
	});
	test('what other apps wrote survives an edit', () => {
		const foreign = [
			'BEGIN:VCALENDAR',
			'VERSION:2.0',
			'PRODID:-//Other//EN',
			'BEGIN:VEVENT',
			'UID:e1',
			'DTSTAMP:20261101T000000Z',
			'DTSTART:20261112T090000Z',
			'DTEND:20261112T100000Z',
			'SUMMARY:Old',
			'ATTENDEE;CN=Ann:mailto:ann@example.com',
			'X-OTHER:keep',
			'BEGIN:VALARM',
			'ACTION:DISPLAY',
			'DESCRIPTION:x',
			'TRIGGER:-PT10M',
			'END:VALARM',
			'END:VEVENT',
			'END:VCALENDAR'
		].join('\r\n');
		const doc = parse(foreign)!.docs[0] as CalEvent;
		const ics = eventToIcs({ ...doc, title: 'New' }, { e1: foreign }).e1;
		expect(lines(ics)).toContain('SUMMARY:New');
		expect(lines(ics)).toContain('ATTENDEE;CN=Ann:mailto:ann@example.com');
		expect(lines(ics)).toContain('X-OTHER:keep');
		expect(lines(ics)).toContain('TRIGGER:-PT10M');
		expect(lines(ics)).toContain('SEQUENCE:1');
		expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1);
	});
	test('foreign timezones, with and without their definition', () => {
		const ny = (vtimezone: string[]) =>
			[
				'BEGIN:VCALENDAR',
				'VERSION:2.0',
				...vtimezone,
				'BEGIN:VEVENT',
				'UID:ny',
				'DTSTART;TZID=America/New_York:20261112T090000',
				'DURATION:PT1H',
				'SUMMARY:Call',
				'END:VEVENT',
				'END:VCALENDAR'
			].join('\r\n');
		const def = [
			'BEGIN:VTIMEZONE',
			'TZID:America/New_York',
			'BEGIN:STANDARD',
			'DTSTART:19701101T020000',
			'TZOFFSETFROM:-0400',
			'TZOFFSETTO:-0500',
			'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU',
			'END:STANDARD',
			'BEGIN:DAYLIGHT',
			'DTSTART:19700308T020000',
			'TZOFFSETFROM:-0500',
			'TZOFFSETTO:-0400',
			'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU',
			'END:DAYLIGHT',
			'END:VTIMEZONE'
		];
		for (const tz of [def, []])
			expect(parse(ny(tz))!.docs[0]).toMatchObject({
				start: '2026-11-12T14:00:00.000Z',
				end: '2026-11-12T15:00:00.000Z'
			});
	});
	test('an occurrence changed elsewhere is a doc of its own and stays an override', () => {
		const foreign = [
			'BEGIN:VCALENDAR',
			'VERSION:2.0',
			'BEGIN:VEVENT',
			'UID:s',
			'DTSTART:20261109T090000Z',
			'DTEND:20261109T100000Z',
			'RRULE:FREQ=WEEKLY',
			'SUMMARY:Series',
			'END:VEVENT',
			'BEGIN:VEVENT',
			'UID:s',
			'RECURRENCE-ID:20261116T090000Z',
			'DTSTART:20261116T110000Z',
			'DTEND:20261116T120000Z',
			'SUMMARY:Moved',
			'END:VEVENT',
			'END:VCALENDAR'
		].join('\r\n');
		const p = parse(foreign)!;
		const [series, moved] = p.docs as CalEvent[];
		expect(series.exdates).toEqual(['2026-11-16T10:00:00']);
		expect(moved).toMatchObject({
			id: 's_r20261116T090000Z',
			title: 'Moved',
			start: '2026-11-16T11:00:00.000Z'
		});
		expect(moved.rrule).toBeUndefined();
		// edited in the planner: still an override, and no EXDATE beside it
		const kept = eventToIcs(series, { s: foreign }, [{ ...moved, title: 'Moved again' }]).s;
		expect(lines(kept)).toContain('SUMMARY:Moved again');
		expect(lines(kept)).toContain('RECURRENCE-ID:20261116T090000Z');
		expect(kept).not.toContain('EXDATE');
		expect((parse(kept)!.docs[0] as CalEvent).exdates).toEqual(series.exdates);
		// deleted in the planner: the override goes, the occurrence stays skipped
		const gone = eventToIcs(series, { s: foreign }).s;
		expect(gone).not.toContain('RECURRENCE-ID');
		expect(gone).toContain('EXDATE');
	});
});

describe('tasks', () => {
	test('every field', () => {
		const t = task({
			description: 'Chapter 2',
			status: 'doing',
			priority: 2,
			start: '2026-11-12T09:00:00.000Z',
			end: '2026-11-12T11:00:00.000Z',
			estimate: 90,
			parentId: 't0',
			projectId: 'p1',
			categoryId: 'c1',
			tags: ['thesis'],
			reminders: ['2026-11-12T08:45:00.000Z']
		});
		const ics = taskToIcs(t);
		expect(lines(ics)).toContain('STATUS:IN-PROCESS');
		expect(lines(ics)).toContain('PRIORITY:3');
		expect(lines(ics)).toContain('DURATION:PT2H');
		expect(lines(ics)).toContain('RELATED-TO:t0');
		expect(lines(ics)).toContain('TRIGGER;VALUE=DATE-TIME:20261112T084500Z');
		expect(taskViaIcs(t)).toEqual(t);
	});
	test('statuses and priorities', () => {
		for (const status of ['todo', 'doing', 'waiting', 'done', 'cancelled', undefined] as const)
			expect(taskViaIcs(task({ status })).status).toBe(status);
		for (const priority of [1, 2, 3, 4, undefined] as const)
			expect(taskViaIcs(task({ priority })).priority).toBe(priority);
		const done = task({ status: 'done', completedAt: '2026-11-12T12:00:00.000Z' });
		expect(lines(taskToIcs(done))).toContain('COMPLETED:20261112T120000Z');
		expect(taskViaIcs(done)).toEqual(done);
	});
	test('deadline: a DATE, or the end of its day beside a timed start', () => {
		const day = task({ deadline: '2026-11-20' });
		expect(lines(taskToIcs(day))).toContain('DUE;VALUE=DATE:20261120');
		expect(taskViaIcs(day)).toEqual(day);
		const timed = task({
			start: '2026-11-12T09:00:00.000Z',
			end: '2026-11-12T10:00:00.000Z',
			deadline: '2026-11-20'
		});
		const ics = taskToIcs(timed);
		expect(lines(ics)).toContain('DUE:20261120T225959Z');
		expect(ics).not.toContain('DURATION');
		expect(taskViaIcs(timed)).toEqual(timed);
		const allDay = task({ start: '2026-11-12', end: '2026-11-14' });
		expect(lines(taskToIcs(allDay))).toContain('DURATION:P2D');
		expect(taskViaIcs(allDay)).toEqual(allDay);
	});
	test('recurring task with only a deadline', () => {
		const t = task({ deadline: '2026-11-20', rrule: 'FREQ=WEEKLY' });
		expect(lines(taskToIcs(t))).toContain('DTSTART;VALUE=DATE:20261120');
		expect(taskViaIcs(t)).toEqual(t);
	});
	test('a task from another app: inbox, relative alarm, its alarm is kept', () => {
		const foreign = [
			'BEGIN:VCALENDAR',
			'VERSION:2.0',
			'BEGIN:VTODO',
			'UID:x',
			'SUMMARY:Call back',
			'STATUS:NEEDS-ACTION',
			'PRIORITY:9',
			'DTSTART:20261112T090000Z',
			'CATEGORIES:phone,home',
			'BEGIN:VALARM',
			'ACTION:AUDIO',
			'TRIGGER:-PT15M',
			'END:VALARM',
			'END:VTODO',
			'END:VCALENDAR'
		].join('\r\n');
		const p = parse(foreign)!;
		expect(p.coll).toBe('tasks');
		const t = p.docs[0] as Task;
		expect(t).toMatchObject({
			id: 'x',
			title: 'Call back',
			priority: 4,
			tags: ['phone', 'home'],
			reminders: ['2026-11-12T08:45:00.000Z']
		});
		expect(t.status).toBeUndefined();
		const ics = taskToIcs(
			{ ...t, reminders: [...t.reminders!, '2026-11-12T08:00:00.000Z'] },
			foreign
		);
		expect(lines(ics)).toContain('ACTION:AUDIO');
		expect(lines(ics)).toContain('TRIGGER:-PT15M');
		expect(ics.match(/BEGIN:VALARM/g)).toHaveLength(2);
		expect(taskToIcs({ ...t, reminders: undefined }, foreign)).not.toContain('VALARM');
	});
	test('other resources are skipped', () => {
		expect(
			parse('BEGIN:VCALENDAR\r\nBEGIN:VJOURNAL\r\nUID:j\r\nEND:VJOURNAL\r\nEND:VCALENDAR')
		).toBeNull();
	});
});

describe('mail link (X-PLANNER-MAIL)', () => {
	const mail = { thread: 'abc123', subject: 'Re: Chapter 2; draft, v2', from: 'Anna Keller' };
	test('tasks and events keep the mail they came from', () => {
		const t = taskViaIcs({ id: 'tm1', title: 'Send draft', mail } as Task);
		expect(t.mail).toEqual(mail);
		expect(
			viaIcs({ id: 'em1', title: 'Meeting', start: '2026-11-19T13:00:00.000Z', mail } as CalEvent)
				.mail
		).toEqual(mail);
		expect(taskViaIcs({ id: 'tm2', title: 'No mail' } as Task).mail).toBeUndefined();
	});
});
