// Browser-only reminders: checked every 30 s while a tab is open. Reminders missed in the
// last 24 h fire once on open; while focus mode is on they wait until it ends.
import { db, featureOn } from './data.svelte.ts';
import { notify } from './notify.ts';
import { isOpen } from './tasks.ts';
import { ui } from './ui.svelte.ts';

const KEY = 'firedReminders';
const DAY = 86_400_000;

export function startReminders() {
	let fired: Record<string, number> = {};
	try {
		fired = JSON.parse(localStorage.getItem(KEY) ?? '{}');
	} catch {
		/* ignore */
	}
	const check = () => {
		if (ui.focus || !featureOn('tasks')) return;
		const now = Date.now();
		for (const t of db.tasks.all) {
			if (!isOpen(t)) continue;
			for (const r of t.reminders ?? []) {
				const at = new Date(r).getTime();
				const key = `${t.id}@${r}`;
				if (at <= now && at > now - DAY && !fired[key]) {
					fired[key] = at;
					notify(`⏰ ${t.title}`, new Date(r).toLocaleString());
				}
			}
		}
		for (const [k, at] of Object.entries(fired)) if (at < now - 2 * DAY) delete fired[k];
		try {
			localStorage.setItem(KEY, JSON.stringify(fired));
		} catch {
			/* ignore */
		}
	};
	check();
	const timer = setInterval(check, 30_000);
	return () => clearInterval(timer);
}
