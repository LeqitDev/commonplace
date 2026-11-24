// Dates written in a text ("Thursday, 19 November", "Donnerstag, 19. November um 14 Uhr", "tomorrow
// at 3pm"), found with chrono-node in English and German.
import * as chrono from 'chrono-node';

export interface FoundDate {
	index: number;
	text: string;
	date: Date;
	/** A time of day was written, not just the day. */
	time: boolean;
	end?: Date;
}

/** All dates in a text, in order, without overlaps. Bare numbers and words like "now" don't count. */
export function findDates(text: string, ref = new Date()): FoundDate[] {
	const opts = { forwardDate: true };
	const all = [...chrono.en.parse(text, ref, opts), ...chrono.de.parse(text, ref, opts)]
		.map((r) => {
			// "Blatt 5 bis Freitag, 20. November" reads as a range from 5 o'clock: only its end is a day
			if (r.start.isCertain('day') || !r.end?.isCertain('day')) return r;
			const cut = /^.*?\s(?:bis|to|until|-|–)\s+/i.exec(r.text)?.[0].length;
			if (!cut) return r;
			return Object.assign(Object.create(Object.getPrototypeOf(r)), r, {
				index: r.index + cut,
				text: r.text.slice(cut),
				start: r.end,
				end: undefined
			}) as typeof r;
		})
		.filter(
			(r) =>
				r.text.length >= 4 &&
				!/^\d+$/.test(r.text.trim()) &&
				// a week is no day: "the week", "next week", "nächste Woche" ("in 2 weeks" is one)
				!/^(\p{L}+\s+)?(week|woche)$/iu.test(r.text.trim()) &&
				// "next Monday" is a certain weekday whose day is only implied
				(r.start.isCertain('day') || r.start.isCertain('weekday'))
		)
		.sort((a, b) => a.index - b.index || b.text.length - a.text.length);
	const out: FoundDate[] = [];
	for (const r of all) {
		const last = out.at(-1);
		if (last && r.index < last.index + last.text.length) continue;
		// only the date is marked: "am Donnerstag" → "Donnerstag"
		const lead = r.text.match(/^(am|an|on|by|bis|zum|ab|until|from)\s+/i)?.[0].length ?? 0;
		out.push({
			index: r.index + lead,
			text: r.text.slice(lead),
			date: r.start.date(),
			time: r.start.isCertain('hour'),
			...(r.end && { end: r.end.date() })
		});
	}
	return out;
}

/** When a mail put off to this date comes back: its time, else 08:00 that day. */
export const laterAt = (d: FoundDate) => {
	const at = new Date(d.date);
	if (!d.time) at.setHours(8, 0, 0, 0);
	return at;
};

/** The first date from today on (for "deadline found in the mail"). */
export const firstDate = (text: string, ref = new Date()) => {
	const today = new Date(ref);
	today.setHours(0, 0, 0, 0);
	return findDates(text, ref).find((d) => d.date >= today) ?? null;
};
