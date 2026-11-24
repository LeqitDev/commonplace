<script lang="ts">
	import { page } from '$app/state';
	import Calendar from '#modules/calendar/Calendar.svelte';
	import FloatingPanel from '#lib/components/app/FloatingPanel.svelte';
	import { Button } from '#lib/components/ui/button/index.ts';
	import { db } from '#lib/data.svelte.ts';
	import { slot } from '#lib/slots.svelte.ts';
	import { parseDate } from '#lib/tasks.ts';
	import { ui } from '#lib/ui.svelte.ts';
	import type { FeedEvent } from '#lib/types.ts';
	import { format } from 'date-fns';
	import X from '@lucide/svelte/icons/x';
	import Clock from '@lucide/svelte/icons/clock';
	import MapPin from '@lucide/svelte/icons/map-pin';
	import AlignLeft from '@lucide/svelte/icons/align-left';

	let panel: HTMLElement | undefined = $state();
	let feedEvent = $state<FeedEvent | null>(null);
	let unscheduling = $state(false);
	// one floating panel at a time
	$effect(() => {
		if (ui.event || ui.task || ui.draft) feedEvent = null;
	});

	$effect(() => {
		const id = page.url.searchParams.get('event');
		const e = id && db.events.items[id];
		if (e) {
			ui.calendarDate = e.start;
			ui.event = { id: e.id };
		}
		const fe = page.url.searchParams.get('feed_event');
		if (fe) ui.calendarDate = fe.split('|').at(-1) ?? null;
	});

	function openFeedEvent(e: FeedEvent | null) {
		feedEvent = e;
		if (e) {
			ui.event = null;
			ui.task = null;
		}
	}
	const feed = $derived(feedEvent ? db.feeds.items[feedEvent.feedId] : undefined);
	const when = (f: FeedEvent) => {
		const s = parseDate(f.allDay ? f.start.slice(0, 10) : f.start);
		if (f.allDay) return format(s, 'EEE d MMM yyyy');
		return `${format(s, 'EEE d MMM yyyy, HH:mm')}${f.end ? ` – ${format(new Date(f.end), 'HH:mm')}` : ''}`;
	};
</script>

<Calendar dragSource={panel} onFeedEvent={openFeedEvent} onTaskDrag={(d) => (unscheduling = d)}>
	{#snippet aside()}
		{#each slot('calendarAside') as Aside (Aside)}<Aside
				{unscheduling}
				onpanel={(el) => (panel = el)}
			/>{/each}
	{/snippet}
</Calendar>

{#if feedEvent}
	<FloatingPanel key="event" label="External event" width={372} onclose={() => (feedEvent = null)}>
		<div class="flex flex-col gap-3 px-5 pb-5">
			<div class="flex items-start gap-2">
				<div class="grow">
					<h2 class="text-[17px] font-semibold tracking-tight">{feedEvent.title}</h2>
					<div class="mt-0.5 flex items-center gap-1.5 text-muted-foreground">
						<span
							class="size-[7px] shrink-0 rounded-full border-[1.5px]"
							style="border-color: {feed?.color ?? 'currentColor'}"
						></span>{feed?.name ?? 'External calendar'} · read-only
					</div>
				</div>
				<Button
					size="icon-sm"
					variant="ghost"
					class="-mt-1.5 -mr-1.5 text-muted-foreground"
					aria-label="Close"
					onclick={() => (feedEvent = null)}><X /></Button
				>
			</div>
			<div class="flex flex-col gap-2">
				<div class="flex gap-2.5">
					<Clock class="mt-px size-4 shrink-0 text-muted-foreground" /><span class="tabular-nums"
						>{when(feedEvent)}</span
					>
				</div>
				{#if feedEvent.location}
					<div class="flex gap-2.5">
						<MapPin class="mt-px size-4 shrink-0 text-muted-foreground" /><span
							>{feedEvent.location}</span
						>
					</div>
				{/if}
				{#if feedEvent.description}
					<div class="flex gap-2.5">
						<AlignLeft class="mt-px size-4 shrink-0 text-muted-foreground" /><span
							class="whitespace-pre-wrap text-muted-foreground">{feedEvent.description}</span
						>
					</div>
				{/if}
			</div>
		</div>
	</FloatingPanel>
{/if}
