// Events and tasks as RFC 5545 objects: CalEvent ⇄ VEVENT, Task ⇄ VTODO. Writing patches our
// properties into the previous text of the resource, so what other apps put there survives.
// What iCalendar has no property for goes into X-PLANNER-* properties.
import ICAL from 'ical.js';
import { tzlib_get_ical_block } from 'timezones-ical-library';
import { localIso, parseDate } from '../tasks.ts';
import type { CalEvent, EventTime, Priority, Task } from '../types.ts';

type Comp = ICAL.Component;
type Kind = 'date' | 'utc' | 'local';

const zones = new Map<string, ICAL.Timezone | null>();
/** Definition of a timezone from the tz database (for ours, and for TZIDs that come without one). */
function zone(tzid: string) {
	if (!zones.has(tzid)) {
		const block = tzlib_get_ical_block(tzid)[0];
		const component = block ? new ICAL.Component(ICAL.parse(block)) : null;
		// the library answers aliases with the canonical zone (UTC → Etc/UTC)
		const id = component && String(component.getFirstPropertyValue('tzid'));
		zones.set(tzid, component && id ? new ICAL.Timezone({ component, tzid: id }) : null);
	}
	return zones.get(tzid) ?? null;
}
/** The planner's timezone: recurring events are written in it, so they follow its DST changes. */
const local = () => zone(process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone);

function toTime(v: string, kind: Kind) {
	if (kind === 'date') return ICAL.Time.fromDateString(v.slice(0, 10));
	const d = parseDate(v);
	if (kind === 'utc') return ICAL.Time.fromJSDate(d, true);
	return new ICAL.Time(
		{
			year: d.getFullYear(),
			month: d.getMonth() + 1,
			day: d.getDate(),
			hour: d.getHours(),
			minute: d.getMinutes(),
			second: d.getSeconds(),
			isDate: false
		},
		local()!
	);
}

function addTime(c: Comp, name: string, v: string, kind: Kind) {
	const p = c.addPropertyWithValue(name, toTime(v, kind));
	if (kind !== 'local') return;
	const tz = local()!;
	p.setParameter('tzid', tz.tzid);
	const cal = c.parent ?? c;
	if (
		!cal.getAllSubcomponents('vtimezone').some((z) => z.getFirstPropertyValue('tzid') === tz.tzid)
	)
		cal.addSubcomponent(ICAL.Component.fromString(tz.component!.toString()));
}

function setTime(c: Comp, name: string, v: string | null | undefined, kind: Kind) {
	c.removeAllProperties(name);
	if (v) addTime(c, name, v, kind);
}

function set(c: Comp, name: string, v: unknown) {
	if (v === null || v === undefined || v === '') c.removeAllProperties(name);
	else c.updatePropertyWithValue(name, v);
}

/** A time property as a Date; `null` if it is a DATE. */
function jsDate(p: ICAL.Property, t = p.getFirstValue() as ICAL.Time) {
	if (t.isDate) return null;
	const tzid = p.getParameter('tzid');
	// a TZID without its VTIMEZONE in the file
	if (typeof tzid === 'string' && (!t.zone || t.zone === ICAL.Timezone.localTimezone)) {
		const z = zone(tzid);
		const { timezone: _, ...fields } = t.toJSON();
		if (z) return new ICAL.Time(fields, z).toJSDate();
	}
	return t.toJSDate();
}
/** As the planner stores it: 'YYYY-MM-DD' or a UTC ISO string. */
function iso(p: ICAL.Property | null, t?: ICAL.Time) {
	if (!p) return undefined;
	return jsDate(p, t)?.toISOString() ?? (t ?? (p.getFirstValue() as ICAL.Time)).toString();
}
const json = (s?: string) => {
	try {
		return s ? JSON.parse(s) : undefined;
	} catch {
		return undefined;
	}
};

const text = (c: Comp, name: string) => {
	const v = c.getFirstPropertyValue(name);
	return v === null || v === undefined || v === '' ? undefined : String(v);
};

// Our own properties are X-COMMONPLACE-<name>. Until 2026-11-24 they were X-PLANNER-<name>:
// still read, and dropped when the item is written (`renameProps()` in dav.ts converts them once).
function setOwn(c: Comp, name: string, v: unknown) {
	c.removeAllProperties(`x-planner-${name}`);
	set(c, `x-commonplace-${name}`, v);
}
const textOwn = (c: Comp, name: string) =>
	text(c, `x-commonplace-${name}`) ?? text(c, `x-planner-${name}`);

function calendar(prev?: string) {
	if (prev) return new ICAL.Component(ICAL.parse(prev));
	const cal = new ICAL.Component('vcalendar');
	cal.addPropertyWithValue('version', '2.0');
	cal.addPropertyWithValue('prodid', '-//Commonplace//EN');
	return cal;
}

const overrideOf = (v: Comp) => v.getFirstProperty('recurrence-id');
const master = (cal: Comp, name: string) =>
	cal.getAllSubcomponents(name).find((v) => !overrideOf(v));

function component(cal: Comp, name: string, uid: string) {
	let v = master(cal, name);
	if (!v) {
		v = new ICAL.Component(name);
		v.addPropertyWithValue('uid', uid);
		cal.addSubcomponent(v);
	}
	return v;
}

function writeRule(v: Comp, rrule: string | null | undefined, kind: Kind) {
	v.removeAllProperties('rrule');
	if (!rrule) return;
	const rule = ICAL.Recur.fromString(rrule);
	// UNTIL has the type of DTSTART, and is in UTC unless that is a DATE
	if (rule.until && rule.until.isDate !== (kind === 'date'))
		rule.until = toTime(
			rule.until.isDate ? `${rule.until}T23:59:59` : localIso(rule.until.toJSDate(), true),
			kind === 'date' ? 'date' : 'utc'
		);
	else if (rule.until && !rule.until.isDate)
		rule.until = ICAL.Time.fromJSDate(rule.until.toJSDate(), true);
	v.addPropertyWithValue('rrule', rule);
}

type Shared = Pick<
	CalEvent & Task,
	'title' | 'description' | 'tags' | 'projectId' | 'categoryId' | 'createdAt' | 'mail'
> & { invite?: CalEvent['invite'] };

function writeShared(v: Comp, d: Partial<Shared>) {
	set(v, 'summary', d.title);
	set(v, 'description', d.description);
	v.removeAllProperties('categories');
	if (d.tags?.length) {
		const p = new ICAL.Property('categories');
		p.setValues(d.tags);
		v.addProperty(p);
	}
	setOwn(v, 'project', d.projectId);
	setOwn(v, 'category', d.categoryId);
	// the mail it was made from (JSON: thread, subject, from)
	setOwn(v, 'mail', d.mail ? JSON.stringify(d.mail) : null);
	// from an invitation: organizer and our answer (the ATTENDEE lines are the organizer's)
	setOwn(v, 'invite', d.invite ? JSON.stringify(d.invite) : null);
	const now = ICAL.Time.fromJSDate(new Date(), true);
	if (!v.hasProperty('created'))
		v.addPropertyWithValue(
			'created',
			d.createdAt ? ICAL.Time.fromJSDate(new Date(d.createdAt), true) : now
		);
	if (v.hasProperty('dtstamp'))
		set(v, 'sequence', Number(v.getFirstPropertyValue('sequence') ?? 0) + 1);
	set(v, 'dtstamp', now);
	set(v, 'last-modified', now);
}

function readShared(v: Comp) {
	const tags = v.getAllProperties('categories').flatMap((p) => p.getValues().map(String));
	return {
		title: text(v, 'summary') ?? '',
		description: text(v, 'description'),
		...(tags.length && { tags }),
		projectId: textOwn(v, 'project'),
		categoryId: textOwn(v, 'category'),
		mail: json(textOwn(v, 'mail')),
		invite: json(textOwn(v, 'invite')),
		createdAt: iso(v.getFirstProperty('created'))
	};
}

/** Without the keys that have no value (docs don't carry them). */
const compact = <T extends object>(o: T) =>
	Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null)) as T;

// ---------------------------------------------------------------- events

/** UID of the resource that holds the `n`th further time of an event. */
export const timeUid = (id: string, n: number) => `${id}_t${n}`;
/** Id of the doc for an occurrence that another app changed (a RECURRENCE-ID component). */
const overrideId = (uid: string, v: Comp) =>
	`${uid}_r${overrideOf(v)!.getFirstValue()!.toString().replace(/[-:]/g, '')}`;
/** `[event id, index]` if `uid` names a further time, `[event id]` for an override doc. */
export const partOf = (uid: string) => {
	const m = /^(.+)_(?:t(\d+)|r\d{8}(?:T\d{6}Z?)?)$/.exec(uid);
	return m && ([m[1], m[2] === undefined ? undefined : Number(m[2])] as const);
};

function writeEvent(v: Comp, e: CalEvent, t: EventTime, skip = new Set<string>()) {
	const kind: Kind = e.allDay ? 'date' : t.rrule && local() ? 'local' : 'utc';
	writeShared(v, e);
	setTime(v, 'dtstart', t.start, kind);
	v.removeAllProperties('duration');
	setTime(v, 'dtend', t.end, kind);
	writeRule(v, t.rrule, kind);
	v.removeAllProperties('exdate');
	for (const x of t.rrule ? (e.exdates ?? []) : []) if (!skip.has(x)) addTime(v, 'exdate', x, kind);
	set(v, 'location', e.location);
	if (e.tentative) set(v, 'status', 'TENTATIVE');
	else if (text(v, 'status') === 'TENTATIVE') v.removeAllProperties('status');
}

/**
 * The resources of an event by UID: its own, and one per further time (`CalEvent.times`), tied to
 * it with RELATED-TO. `prev` = their previous texts, `overrides` = the docs of the occurrences
 * changed elsewhere (they live in the event's own resource).
 */
export function eventToIcs(
	e: CalEvent,
	prev: Record<string, string> = {},
	overrides: CalEvent[] = []
): Record<string, string> {
	const out: Record<string, string> = {};
	[e, ...(e.times ?? [])].forEach((t, i) => {
		const uid = i ? timeUid(e.id, i - 1) : e.id;
		const cal = calendar(prev[uid]);
		const skip = new Set<string>();
		for (const o of cal.getAllSubcomponents('vevent').filter(overrideOf)) {
			const doc = overrides.find((d) => d.id === overrideId(uid, o));
			if (!doc) cal.removeSubcomponent(o);
			else {
				// an occurrence can't have both an override and an EXDATE
				const at = jsDate(overrideOf(o)!);
				skip.add(at ? localIso(at) : overrideOf(o)!.getFirstValue()!.toString());
				writeEvent(o, { ...doc, allDay: e.allDay }, { start: doc.start, end: doc.end });
			}
		}
		const v = component(cal, 'vevent', uid);
		writeEvent(v, e, t, skip);
		if (i) set(v, 'related-to', e.id);
		out[uid] = cal.toString();
	});
	return out;
}

function readEvent(v: Comp, id: string): CalEvent {
	const ev = new ICAL.Event(v);
	const start = v.getFirstProperty('dtstart');
	const allDay = !!ev.startDate?.isDate;
	const hasEnd = v.hasProperty('dtend') || v.hasProperty('duration');
	const exdates = v.getAllProperties('exdate').flatMap((p) =>
		(p.getValues() as ICAL.Time[]).map((t) => {
			const d = jsDate(p, t);
			return d ? localIso(d) : t.toString();
		})
	);
	return compact({
		id,
		...readShared(v),
		start: iso(start) ?? '',
		end: hasEnd
			? iso(v.getFirstProperty('dtend') ?? start, v.hasProperty('dtend') ? undefined : ev.endDate)
			: undefined,
		allDay: allDay || undefined,
		rrule: text(v, 'rrule'),
		exdates: exdates.length ? exdates : undefined,
		tentative: text(v, 'status') === 'TENTATIVE' || undefined,
		location: text(v, 'location')
	});
}

// ---------------------------------------------------------------- tasks

const STATUS = { done: 'COMPLETED', cancelled: 'CANCELLED', doing: 'IN-PROCESS' } as const;
const PRIORITY = [0, 1, 3, 5, 9];
const SEC = 1000;

/** When an alarm goes off: its absolute trigger, or the relative one resolved against the task. */
function alarmTime(a: Comp, v: Comp) {
	const p = a.getFirstProperty('trigger');
	const t = p?.getFirstValue();
	if (!p || !t) return null;
	if (t instanceof ICAL.Time) return jsDate(p);
	const start = v.getFirstProperty('dtstart');
	const due = v.getFirstProperty('due');
	const base = p.getParameter('related') === 'END' ? (due ?? start) : (start ?? due);
	if (!base) return null;
	const at = jsDate(base) ?? parseDate(base.getFirstValue()!.toString());
	return new Date(at.getTime() + (t as ICAL.Duration).toSeconds() * SEC);
}

export function taskToIcs(t: Task, prev?: string): string {
	const cal = calendar(prev);
	const v = component(cal, 'vtodo', t.id);
	const timed = !!t.start && t.start.length > 10;
	const kind: Kind = !timed ? 'date' : t.rrule && local() ? 'local' : 'utc';
	writeShared(v, t);
	set(v, 'status', (t.status && STATUS[t.status as keyof typeof STATUS]) ?? 'NEEDS-ACTION');
	setOwn(v, 'status', t.status === 'todo' || t.status === 'waiting' ? t.status : null);
	set(v, 'completed', t.completedAt && ICAL.Time.fromJSDate(new Date(t.completedAt), true));
	if (t.status === 'done') set(v, 'percent-complete', 100);
	else if (Number(v.getFirstPropertyValue('percent-complete')) === 100)
		v.removeAllProperties('percent-complete');
	set(v, 'priority', t.priority ? PRIORITY[t.priority] : null);
	// a rule needs a DTSTART
	setTime(v, 'dtstart', t.start ?? (t.rrule ? t.deadline : null), kind);
	// DUE has the type of DTSTART: beside a timed start, the deadline is the end of its day
	setTime(v, 'due', t.deadline && timed ? `${t.deadline}T23:59:59` : t.deadline, kind);
	// DURATION can't stand beside DUE
	const span = t.start && t.end ? parseDate(t.end).getTime() - parseDate(t.start).getTime() : 0;
	const duration = !t.deadline && span > 0;
	set(v, 'duration', duration ? ICAL.Duration.fromSeconds(span / SEC) : null);
	setOwn(v, 'end', duration ? null : t.end);
	setOwn(v, 'estimate', t.estimate ? String(t.estimate) : null);
	writeRule(v, t.rrule, kind);
	set(v, 'related-to', t.parentId);
	// alarms that are still among the reminders stay as they are
	const want = new Set((t.reminders ?? []).map((r) => new Date(r).getTime()));
	for (const a of v.getAllSubcomponents('valarm')) {
		const at = alarmTime(a, v)?.getTime();
		if (at !== undefined && want.has(at)) want.delete(at);
		else v.removeSubcomponent(a);
	}
	for (const at of want) {
		const a = new ICAL.Component('valarm');
		a.addPropertyWithValue('action', 'DISPLAY');
		a.addPropertyWithValue('description', t.title);
		a.addPropertyWithValue('trigger', ICAL.Time.fromJSDate(new Date(at), true));
		v.addSubcomponent(a);
	}
	return cal.toString();
}

function readTask(v: Comp, id: string): Task {
	const status = text(v, 'status');
	const own = textOwn(v, 'status');
	const priority = Number(v.getFirstPropertyValue('priority') ?? 0);
	const start = v.getFirstProperty('dtstart');
	const due = v.getFirstProperty('due');
	const dueAt = due && jsDate(due);
	const deadline = due
		? dueAt
			? localIso(dueAt, true)
			: due.getFirstValue()!.toString()
		: undefined;
	const rrule = text(v, 'rrule');
	const startIso = iso(start);
	// a DTSTART that only anchors the rule of a task with a deadline
	const anchor = !!rrule && !!deadline && startIso === deadline;
	const duration = v.getFirstPropertyValue('duration') as ICAL.Duration | null;
	const reminders = v
		.getAllSubcomponents('valarm')
		.map((a) => alarmTime(a, v)?.toISOString())
		.filter((r) => r !== undefined);
	return compact({
		id,
		...readShared(v),
		status:
			status === 'COMPLETED'
				? 'done'
				: status === 'CANCELLED'
					? 'cancelled'
					: status === 'IN-PROCESS'
						? 'doing'
						: own === 'todo' || own === 'waiting'
							? own
							: undefined,
		priority: (priority
			? priority === 1
				? 1
				: priority < 5
					? 2
					: priority === 5
						? 3
						: 4
			: undefined) as Priority | undefined,
		start: anchor ? undefined : startIso,
		end:
			textOwn(v, 'end') ??
			(duration && startIso && !anchor
				? startIso.length === 10
					? localIso(parseDate(startIso).getTime() + duration.toSeconds() * SEC, true)
					: new Date(new Date(startIso).getTime() + duration.toSeconds() * SEC).toISOString()
				: undefined),
		deadline,
		estimate: Number(textOwn(v, 'estimate')) || undefined,
		rrule,
		parentId: text(v, 'related-to'),
		reminders: reminders.length ? reminders : undefined,
		completedAt: iso(v.getFirstProperty('completed'))
	});
}

// ---------------------------------------------------------------- reading a resource

export interface Parsed {
	coll: 'events' | 'tasks';
	uid: string;
	/** The doc of the resource itself, then (events) those of its changed occurrences. */
	docs: (CalEvent | Task)[];
	/** Events: the event this resource is a further time of. */
	parent?: string;
}

/** The docs in a calendar object resource; null if it holds neither an event nor a task. */
export function parse(ics: string): Parsed | null {
	const cal = new ICAL.Component(ICAL.parse(ics));
	const todo = master(cal, 'vtodo');
	if (todo) {
		const uid = text(todo, 'uid');
		return uid ? { coll: 'tasks', uid, docs: [readTask(todo, uid)] } : null;
	}
	const v = master(cal, 'vevent');
	const uid = v && text(v, 'uid');
	if (!v || !uid) return null;
	const doc = readEvent(v, uid);
	const overrides = cal
		.getAllSubcomponents('vevent')
		.filter(overrideOf)
		.map((o) => {
			const at = jsDate(overrideOf(o)!);
			const skipped = at ? localIso(at) : overrideOf(o)!.getFirstValue()!.toString();
			if (!doc.exdates?.includes(skipped)) doc.exdates = [...(doc.exdates ?? []), skipped];
			return readEvent(o, overrideId(uid, o));
		});
	const part = partOf(uid);
	const parent = text(v, 'related-to');
	return {
		coll: 'events',
		uid,
		docs: [doc, ...overrides],
		...(part?.[1] !== undefined && parent === part[0] && { parent })
	};
}
