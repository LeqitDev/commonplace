import { goto } from '$app/navigation';
import { format } from 'date-fns';
import { create, db, settings } from '#lib/data.svelte.ts';

/** Open (creating on first use) the daily note for a date. */
export async function openDailyNote(date: Date = new Date()) {
	const day = format(date, 'yyyy-MM-dd');
	const existing = db.notes.all.find((n) => n.daily === day);
	const note =
		existing ??
		(await create('notes', {
			title: day,
			type: 'md',
			daily: day,
			content: settings().dailyTemplate
		}));
	goto(`/notes/${note.id}`);
}

/**
 * Autosave for a note body: the draft goes to localStorage immediately and to the server after
 * a short pause, so nothing is lost if the tab closes or the session expires mid-edit.
 */
export function autosaver(nid: string, save: (md: string) => Promise<unknown>) {
	const key = `draft:${nid}`;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let pending: string | null = null;
	const flush = async () => {
		clearTimeout(timer);
		if (pending === null) return;
		const md = pending;
		pending = null;
		await save(md);
		if (localStorage.getItem(key) === md) localStorage.removeItem(key);
	};
	const change = (md: string) => {
		localStorage.setItem(key, md);
		pending = md;
		clearTimeout(timer);
		timer = setTimeout(flush, 800);
	};
	return {
		/** Unsaved local text, if any. */
		draft: () => localStorage.getItem(key),
		change,
		flush,
		/** Push a leftover draft (from a crashed/closed tab) to the server. */
		recover(current: string | undefined) {
			const d = localStorage.getItem(key);
			if (d !== null && d !== (current ?? '')) change(d);
		}
	};
}
