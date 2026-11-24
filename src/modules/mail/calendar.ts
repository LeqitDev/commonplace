// Mail in the calendar: threads put off until later are dotted half-hour blocks (click opens the
// mail, drag moves its later time), and "Pick a slot in the calendar…" takes the next drag-select.
import { goto } from '$app/navigation';
import { format } from 'date-fns';
import { toast } from 'svelte-sonner';
import type { CalendarSource } from '#lib/modules.ts';
import { db, update } from '#lib/data.svelte.ts';
import { ui } from '#lib/ui.svelte.ts';
import { mailVisible } from './mail.ts';
import { ctx, setLater } from './mail.svelte.ts';
import SlotBanner from './SlotBanner.svelte';

export const mailSource: CalendarSource = {
	kind: 'mail',
	mark: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
	entries: () => {
		const c = ctx();
		return db.mail_threads.all
			.filter(
				(t) =>
					t.later &&
					mailVisible(
						{ thread: t.id, account: t.account ?? '', senders: [t.fromAddr ?? ''] },
						c,
						ui.project
					)
			)
			.map((t) => ({
				id: `mail:${t.id}`,
				title: t.subject || '(no subject)',
				start: t.later!,
				end: new Date(Date.parse(t.later!) + 30 * 60_000).toISOString(),
				durationEditable: false,
				extendedProps: { kind: 'mail', id: t.id }
			}));
	},
	move: (id, start) => update('mail_threads', id, { later: start.toISOString() }),
	open: (id) => goto(`/mail?view=later&m=${id}`),
	select: (start) => {
		const row = ui.slotFor;
		if (!row) return false;
		ui.slotFor = null;
		void setLater(row, start);
		toast(`Back in the inbox ${format(start, 'EEE d MMM, HH:mm')}`, { description: row.subject });
		return true;
	},
	banner: SlotBanner
};
