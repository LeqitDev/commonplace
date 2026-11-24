// Pure task/event logic (unit-tested in tasks.test.ts).
import { RRule } from 'rrule';
import { format } from 'date-fns';
import type { CalEvent, Feed, Task } from './types.ts';

export const isOpen = (t: Task) => t.status !== 'done' && t.status !== 'cancelled';

/** Inbox = open top-level task nobody has triaged yet (no dates, priority, status or reminders). */
export const isInbox = (t: Task) =>
	isOpen(t) &&
	!t.parentId &&
	!t.start &&
	!t.end &&
	!t.deadline &&
	!t.priority &&
	!t.status &&
	!t.reminders?.length;

export const isScheduled = (t: Task) => !!t.start;

/** Local wall-clock ISO without offset ("floating"), as FullCalendar/rrule expect for DST-safe recurrence. */
export const localIso = (d: Date | string | number, allDay = false) =>
	format(new Date(d), allDay ? 'yyyy-MM-dd' : "yyyy-MM-dd'T'HH:mm:ss");

/** Parse 'YYYY-MM-DD' as local midnight, anything else via Date. */
export const parseDate = (s: string) => (s.length === 10 ? new Date(`${s}T00:00:00`) : new Date(s));

// rrule.js works in "UTC that means local": shift wall-clock fields into UTC and back.
const toFloat = (d: Date) =>
	new Date(
		Date.UTC(
			d.getFullYear(),
			d.getMonth(),
			d.getDate(),
			d.getHours(),
			d.getMinutes(),
			d.getSeconds()
		)
	);
const fromFloat = (d: Date) =>
	new Date(
		d.getUTCFullYear(),
		d.getUTCMonth(),
		d.getUTCDate(),
		d.getUTCHours(),
		d.getUTCMinutes(),
		d.getUTCSeconds()
	);

/** Next occurrence strictly after max(anchor, start of today) for an RRULE body anchored at `anchor`. */
export function nextAfter(rrule: string, anchor: Date, now = new Date()): Date | null {
	const rule = new RRule({ ...RRule.parseString(rrule), dtstart: toFloat(anchor) });
	const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
	const ref = anchor > today ? anchor : today;
	const next = rule.after(toFloat(ref));
	return next ? fromFloat(next) : null;
}

/** Fields for the next instance of a recurring task (dates shifted by one recurrence), or null. */
export function nextInstance(t: Task, now = new Date()): Partial<Task> | null {
	if (!t.rrule) return null;
	const anchorStr = t.start ?? t.deadline;
	const anchor = anchorStr ? parseDate(anchorStr) : now;
	const next = nextAfter(t.rrule, anchor, now);
	if (!next) return null;
	const delta = next.getTime() - anchor.getTime();
	const shift = (s?: string | null) =>
		s
			? s.length === 10
				? localIso(parseDate(s).getTime() + delta, true)
				: new Date(new Date(s).getTime() + delta).toISOString()
			: s;
	const { id: _id, createdAt: _c, updatedAt: _u, completedAt: _d, status, ...rest } = t;
	return {
		...rest,
		status: status ? 'todo' : null,
		start: shift(t.start),
		end: shift(t.end),
		deadline: shift(t.deadline),
		reminders: t.reminders?.map((r) => shift(r)!)
	};
}

const MIN = 60_000;

/** When a task is due: its deadline, else its start. */
export const due = (t: Task) => {
	const s = t.deadline ?? t.start;
	return s ? parseDate(s) : null;
};

/** Calendar entries for a task: a block if it is scheduled (`task:<id>`) and an all-day marker
 *  on its deadline (`deadline:<id>`). */
export function taskToEvents(t: Task, color?: string) {
	const base = {
		title: t.title,
		...(color && { color }), // a `color: undefined` key becomes the string "undefined" in FC
		className: `task ${isOpen(t) ? '' : 'task-done'}`,
		extendedProps: { kind: 'task', id: t.id }
	};
	const out: (typeof base & { id: string; start: string; end?: string; allDay: boolean })[] = [];
	if (t.start) {
		const allDay = t.start.length === 10;
		const end =
			t.end ??
			(allDay
				? undefined
				: new Date(new Date(t.start).getTime() + (t.estimate ?? 30) * MIN).toISOString());
		out.push({ ...base, id: `task:${t.id}`, start: t.start, end, allDay });
	}
	if (t.deadline)
		out.push({
			...base,
			id: `deadline:${t.id}`, // drawn with a flag (`entryContent` in Calendar.svelte)
			start: t.deadline,
			allDay: true
		});
	return out;
}

/**
 * Columns for time spans that overlap, like a calendar lays out events: `i` = column of the span,
 * `n` = number of columns of the group of overlapping spans it is in.
 */
export function columns(spans: [start: number, end: number][]) {
	const out = spans.map(() => ({ i: 0, n: 1 }));
	let group: number[] = [];
	let ends: number[] = []; // per column of the group: where its last span ends
	const close = () => {
		for (const k of group) out[k].n = ends.length;
		group = [];
		ends = [];
	};
	for (const k of spans.map((_, k) => k).sort((a, b) => spans[a][0] - spans[b][0])) {
		const [start, end] = spans[k];
		if (ends.every((e) => e <= start)) close();
		const free = ends.findIndex((e) => e <= start);
		out[k].i = free < 0 ? ends.length : free;
		ends[out[k].i] = end;
		group.push(k);
	}
	close();
	return out;
}

/** Occurrence starts of a recurring event inside [from, to], minus EXDATEs (wall-clock, DST-safe). */
export function occurrences(
	e: Pick<CalEvent, 'start' | 'rrule' | 'exdates' | 'allDay'>,
	from: Date,
	to: Date
): Date[] {
	const rule = new RRule({ ...RRule.parseString(e.rrule!), dtstart: toFloat(parseDate(e.start)) });
	const skip = new Set(e.exdates ?? []);
	return rule
		.between(toFloat(from), toFloat(to), true)
		.map(fromFloat)
		.filter((d) => !skip.has(localIso(d, e.allDay)));
}

/**
 * FullCalendar entries for an event; recurring events are expanded for the visible range. Its
 * further times (`CalEvent.times`) give entries of their own, marked with `extendedProps.time`
 * (their index).
 */
export function eventToFc(e: CalEvent, from: Date, to: Date, color?: string) {
	return [e, ...(e.times ?? [])].flatMap((t, i) => {
		const base = {
			title: e.title,
			allDay: !!e.allDay,
			...(color && { color }),
			...(e.tentative && { className: 'tentative' }),
			extendedProps: {
				kind: 'event',
				id: e.id,
				...(i > 0 && { time: i - 1 }),
				...(t.rrule && { repeats: true }),
				...(e.location && { location: e.location })
			}
		};
		const id = `event:${e.id}${i ? `:t${i - 1}` : ''}`;
		if (!t.rrule) return [{ ...base, id, start: t.start, end: t.end }];
		const dur = t.end ? parseDate(t.end).getTime() - parseDate(t.start).getTime() : 0;
		const series = { start: t.start, rrule: t.rrule, exdates: e.exdates, allDay: e.allDay };
		return occurrences(series, new Date(from.getTime() - dur), to).map((d) => ({
			...base,
			id: `${id}:${d.getTime()}`,
			start: e.allDay ? localIso(d, true) : d.toISOString(),
			end: dur
				? e.allDay
					? localIso(d.getTime() + dur, true)
					: new Date(d.getTime() + dur).toISOString()
				: undefined
		}));
	});
}

export const RECURRENCE_PRESETS: Record<string, string> = {
	'': 'Does not repeat',
	'FREQ=DAILY': 'Daily',
	'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR': 'Weekdays',
	'FREQ=WEEKLY': 'Weekly',
	'FREQ=WEEKLY;INTERVAL=2': 'Every 2 weeks',
	'FREQ=MONTHLY': 'Monthly',
	'FREQ=YEARLY': 'Yearly'
};

/** Whether an external calendar is shown while `project` is focused (null = "All projects"). */
export const feedVisible = (f: Feed, project: string | null) =>
	f.enabled !== false &&
	(!project || f.show === 'always' || (f.show === 'projects' && !!f.projectIds?.includes(project)));
