// Read-only external calendars: ICS URLs or CalDAV collections, expanded into `feed_event` docs.
import ICAL from 'ical.js';
import { createDAVClient } from 'tsdav';
import { featureOn, get, list, patch, replaceAll, type Doc } from '#lib/server/db.ts';
import type { Feed, FeedEvent } from '#lib/types.ts';

const DAY = 86_400_000;
const MAX_OCCURRENCES = 5000;

const iso = (t: ICAL.Time) => (t.isDate ? t.toString() : t.toJSDate().toISOString());

/** Parse one or more VCALENDAR texts into concrete occurrences inside [from, to]. */
export function expandIcs(texts: string[], feedId: string, from: Date, to: Date): FeedEvent[] {
	const out: FeedEvent[] = [];
	const lo = ICAL.Time.fromJSDate(from, true);
	const hi = ICAL.Time.fromJSDate(to, true);
	for (const text of texts) {
		const cal = new ICAL.Component(ICAL.parse(text));
		for (const tz of cal.getAllSubcomponents('vtimezone')) ICAL.TimezoneService.register(tz);
		const vevents = cal.getAllSubcomponents('vevent');
		const exceptions = vevents.filter((v) => v.hasProperty('recurrence-id'));
		for (const v of vevents.filter((v) => !v.hasProperty('recurrence-id'))) {
			const ev = new ICAL.Event(v);
			for (const ex of exceptions)
				if (ex.getFirstPropertyValue('uid') === ev.uid) ev.relateException(ex);
			const push = (item: ICAL.Event, s: ICAL.Time, e: ICAL.Time) => {
				if (s.compare(hi) > 0 || (e ?? s).compare(lo) < 0) return;
				out.push({
					id: `${feedId}|${ev.uid}|${iso(s)}`,
					feedId,
					title: item.summary || '(no title)',
					start: iso(s),
					end: e ? iso(e) : undefined,
					allDay: s.isDate,
					description: item.description || undefined,
					location: item.location || undefined,
					...(item.component.getFirstPropertyValue('status') === 'TENTATIVE' && { tentative: true })
				});
			};
			if (!ev.isRecurring()) {
				push(ev, ev.startDate, ev.endDate);
				continue;
			}
			const it = ev.iterator();
			for (
				let n = 0, next;
				(next = it.next()) && next.compare(hi) <= 0 && n < MAX_OCCURRENCES;
				n++
			) {
				const d = ev.getOccurrenceDetails(next);
				push(d.item, d.startDate, d.endDate);
			}
		}
	}
	return out;
}

async function fetchTexts(f: Feed, from: Date, to: Date): Promise<string[]> {
	if (f.type === 'ics') {
		const headers: Record<string, string> = {};
		if (f.username) headers.authorization = `Basic ${btoa(`${f.username}:${f.password ?? ''}`)}`;
		const res = await fetch(f.url.replace(/^webcal:/, 'https:'), { headers });
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		return [await res.text()];
	}
	const client = await createDAVClient({
		serverUrl: f.url,
		credentials: { username: f.username, password: f.password },
		authMethod: 'Basic',
		defaultAccountType: 'caldav'
	});
	const norm = (u: string) => u.replace(/\/+$/, '');
	const cals = await client.fetchCalendars();
	const exact = cals.filter((c) => norm(c.url) === norm(f.url));
	const texts: string[] = [];
	for (const calendar of exact.length ? exact : cals) {
		const objs = await client.fetchCalendarObjects({
			calendar,
			timeRange: { start: from.toISOString(), end: to.toISOString() }
		});
		texts.push(...objs.map((o) => o.data).filter(Boolean));
	}
	return texts;
}

export async function syncFeed(id: string) {
	const f = get('feeds', id) as Feed | null;
	if (!f || f.enabled === false) return;
	const from = new Date(Date.now() - 90 * DAY);
	const to = new Date(Date.now() + 365 * DAY);
	try {
		const events = expandIcs(await fetchTexts(f, from, to), f.id, from, to);
		// with "keep past events", what ended before the window was synced earlier and stays
		const since = from.toISOString();
		replaceAll(
			'feed_event',
			{ feedId: f.id },
			events as unknown as Doc[],
			f.keepPast ? (d) => ((d.end ?? d.start) as string) >= since : undefined
		);
		patch('feeds', f.id, { lastSync: new Date().toISOString(), error: null });
	} catch (e) {
		patch('feeds', f.id, { error: String(e) });
	}
}

export async function syncAll() {
	if (!featureOn('calendar')) return; // switched off in Settings › General
	for (const f of list('feeds')) if (f.enabled !== false) await syncFeed(f.id);
}
