<script lang="ts">
	// Invitation in a mail: what, when, where, who; Accept / Maybe / Decline; and the hours around
	// it in the calendar with what would clash.
	import { api, db } from '#lib/data.svelte.ts';
	import { occurrences, parseDate } from '#lib/tasks.ts';
	import { inFocus } from '#lib/ui.svelte.ts';
	import type { CalEvent, MailMessage } from '#lib/types.ts';
	import { format, isSameDay } from 'date-fns';
	import { toast } from 'svelte-sonner';
	import CalendarIcon from '@lucide/svelte/icons/calendar';
	import MapPin from '@lucide/svelte/icons/map-pin';
	import Users from '@lucide/svelte/icons/users';

	let {
		message,
		ondeclined
	}: {
		message: MailMessage;
		/** The mail was archived with the decline. */ ondeclined: () => void;
	} = $props();
	const inv = $derived(message.invite!);
	const start = $derived(parseDate(inv.start));
	const end = $derived(inv.end ? parseDate(inv.end) : new Date(start.getTime() + 3_600_000));
	const ev = $derived(db.events.items[inv.uid] as CalEvent | undefined);
	const own = $derived(new Set(db.mail_accounts.all.map((a) => a.address.toLowerCase())));
	/** Our answer: from the event, else from our ATTENDEE line in the mail. */
	const answered = $derived(
		ev?.invite?.partstat ??
			inv.attendees.find((a) => own.has(a.address.toLowerCase()))?.partstat ??
			'NEEDS-ACTION'
	);
	const accepted = $derived(inv.attendees.filter((a) => a.partstat === 'ACCEPTED').length);
	const minutes = $derived(Math.round((end.getTime() - start.getTime()) / 60_000));
	const duration = $derived(
		inv.allDay ? '' : minutes < 60 ? `${minutes} min` : `${Math.round((minutes / 60) * 10) / 10} h`
	);
	let busy = $state(false);

	// the hours around it (2 before, 2 after) and what else is on then
	const from = $derived(new Date(start.getTime() - 2 * 3_600_000));
	const to = $derived(new Date(end.getTime() + 2 * 3_600_000));
	const around = $derived.by(() => {
		if (inv.allDay) return [];
		const out: { title: string; start: Date; end: Date }[] = [];
		for (const e of db.events.all) {
			if (e.id === inv.uid || e.allDay || !inFocus(e)) continue;
			const len =
				(e.end ? parseDate(e.end).getTime() : parseDate(e.start).getTime() + 3_600_000) -
				parseDate(e.start).getTime();
			const starts = e.rrule
				? occurrences(e, new Date(from.getTime() - len), to)
				: [parseDate(e.start)];
			for (const s of starts) {
				const en = new Date(s.getTime() + len);
				if (en > from && s < to) out.push({ title: e.title, start: s, end: en });
			}
		}
		return out.sort((a, b) => +a.start - +b.start);
	});
	const clashes = $derived(around.filter((e) => e.start < end && e.end > start));
	const HOUR = 22; // px per hour in the strip
	const top = (d: Date) => ((d.getTime() - from.getTime()) / 3_600_000) * HOUR;
	const hours = $derived.by(() => {
		const out: Date[] = [];
		const h = new Date(from);
		h.setMinutes(0, 0, 0);
		if (h < from) h.setHours(h.getHours() + 1);
		for (; h <= to; h.setHours(h.getHours() + 1)) out.push(new Date(h));
		return out;
	});

	async function answer(a: 'accept' | 'maybe' | 'decline') {
		busy = true;
		try {
			const r = await api<{ ok: boolean; sent?: boolean; error?: string; noOrganizer?: boolean }>(
				`/api/mail/invite/${message.id}`,
				{ method: 'POST', body: JSON.stringify({ answer: a }) }
			);
			await Promise.all([db.events.load(), db.mail_drafts.load()]);
			if (!r.ok) return void toast.error('Could not answer', { description: r.error });
			const word = { accept: 'Accepted', maybe: 'Maybe', decline: 'Declined' }[a];
			if (r.noOrganizer)
				toast(`${word}: ${inv.summary}`, {
					description: 'The invitation names no organizer to tell.'
				});
			else if (r.sent) toast(`${word}: ${inv.summary}`, { description: 'The organizer was told.' });
			else
				toast(`${word}: ${inv.summary}`, {
					description: `The answer waits to be sent: ${r.error}`
				});
			if (a === 'decline') ondeclined();
		} finally {
			busy = false;
		}
	}
	const when = $derived(
		inv.allDay
			? format(start, 'EEEE, d MMMM')
			: `${format(start, 'EEEE, d MMMM · HH:mm')}–${format(end, isSameDay(start, end) ? 'HH:mm' : 'd MMM HH:mm')}`
	);
	const btn = 'h-8 rounded-lg px-3 text-[13px] font-medium disabled:opacity-50';
</script>

{#if inv.method === 'CANCEL'}
	<div
		class="ml-10 flex items-center gap-2 rounded-xl border border-dashed px-4 py-3 text-sm text-muted-foreground"
	>
		<CalendarIcon class="size-4" /> "{inv.summary}" on {when} was cancelled{ev
			? ''
			: ' and is no longer in the calendar'}.
	</div>
{:else if inv.method === 'REQUEST'}
	<div class="ml-10 flex flex-wrap gap-4 rounded-xl border p-4 text-[13px]">
		<div class="flex min-w-60 flex-1 flex-col gap-2">
			<div class="text-[15px] font-semibold">{inv.summary}</div>
			<div class="flex items-center gap-2">
				<CalendarIcon class="size-4 text-muted-foreground" />{when}{#if duration}<span
						class="text-muted-foreground">· {duration}</span
					>{/if}{#if inv.rrule}<span class="text-muted-foreground">· repeats</span>{/if}
			</div>
			{#if inv.location}<div class="flex items-center gap-2">
					<MapPin class="size-4 text-muted-foreground" />{inv.location}
				</div>{/if}
			<div class="flex items-center gap-2 text-muted-foreground">
				<Users class="size-4" />{inv.attendees.length} invited · {accepted} accepted{#if inv.organizer.address}{` · by ${inv.organizer.name || inv.organizer.address}`}{/if}
			</div>
			<div class="text-muted-foreground">
				{#if inv.allDay}All day{:else if clashes.length}Clashes with {clashes
						.map((c) => c.title)
						.join(', ')}{:else}No conflicts{/if}
			</div>
			<div class="mt-1 flex items-center gap-1.5">
				{#each [['accept', 'Accept', 'ACCEPTED'], ['maybe', 'Maybe', 'TENTATIVE'], ['decline', 'Decline', 'DECLINED']] as const as [a, label, ps] (a)}
					<button
						class="{btn} {answered === ps
							? 'bg-foreground text-background'
							: a === 'accept' && answered === 'NEEDS-ACTION'
								? 'bg-foreground text-background'
								: 'border border-line2 hover:bg-muted'}"
						disabled={busy}
						aria-pressed={answered === ps}
						onclick={() => answer(a)}>{label}</button
					>
				{/each}
				<span class="ml-2 text-xs text-muted-foreground">
					{#if answered === 'ACCEPTED'}You accepted{:else if answered === 'TENTATIVE'}You said maybe{:else if answered === 'DECLINED'}You
						declined{:else if ev}In the calendar as tentative{/if}
				</span>
			</div>
		</div>
		{#if !inv.allDay}
			<!-- that part of the day in the calendar -->
			<div class="relative w-52 shrink-0 border-l pl-10" style:height="{top(to)}px">
				{#each hours as h (+h)}
					<div
						class="absolute right-0 left-0 border-t border-dashed border-line2"
						style:top="{top(h)}px"
					>
						<span class="absolute -top-2 -left-10 text-[10.5px] text-muted-foreground tabular-nums"
							>{format(h, 'HH:mm')}</span
						>
					</div>
				{/each}
				{#each around as e, i (i)}
					<div
						class="absolute right-0 left-[58%] overflow-hidden rounded bg-(--ev) px-1.5 text-[11px] leading-tight"
						style:top="{Math.max(0, top(e.start))}px"
						style:height="{Math.max(14, top(e.end) - Math.max(0, top(e.start)))}px"
						title={e.title}
					>
						{e.title}
					</div>
				{/each}
				<div
					class="absolute right-[44%] left-10 overflow-hidden rounded border-[1.5px] border-dashed border-foreground bg-background px-1.5 text-[11px] leading-tight font-medium"
					style:top="{top(start)}px"
					style:height="{Math.max(14, top(end) - top(start))}px"
				>
					{inv.summary}
				</div>
			</div>
		{/if}
	</div>
{/if}
