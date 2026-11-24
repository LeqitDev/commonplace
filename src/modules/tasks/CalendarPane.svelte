<script lang="ts">
	// Beside the calendar: open tasks by when they are due; drag them onto the grid to schedule,
	// drop a scheduled one back here to unschedule (the calendar's Draggable uses `onpanel`'s element).
	import TaskItem from './TaskItem.svelte';
	import { Button } from '#lib/components/ui/button/index.ts';
	import { db } from '#lib/data.svelte.ts';
	import { due, isOpen, localIso } from '#lib/tasks.ts';
	import { inFocus, ui } from '#lib/ui.svelte.ts';
	import type { Task } from '#lib/types.ts';
	import ChevronsRight from '@lucide/svelte/icons/chevrons-right';
	import ChevronsLeft from '@lucide/svelte/icons/chevrons-left';
	import CalendarX from '@lucide/svelte/icons/calendar-x';

	let {
		unscheduling,
		onpanel
	}: { unscheduling: boolean; onpanel: (el: HTMLElement | undefined) => void } = $props();

	let panel: HTMLElement | undefined = $state();
	$effect(() => onpanel(panel));
	// its own key: `calTasks` is the calendar's "Tasks" toggle
	let showTasks = $state(localStorage.getItem('calPane') !== 'hide');
	$effect(() => localStorage.setItem('calPane', showTasks ? 'show' : 'hide'));

	// open tasks by when they are due (deadline, else start), then the ones without a start
	const open = $derived(db.tasks.all.filter((t) => isOpen(t) && !t.parentId && inFocus(t)));
	const sections = $derived.by(() => {
		const today = localIso(new Date(), true);
		const day = (t: Task) => localIso(due(t)!, true);
		const dated = open.filter(due).sort((a, b) => due(a)!.getTime() - due(b)!.getTime());
		return [
			{ title: 'Overdue', tasks: dated.filter((t) => day(t) < today) },
			{ title: 'Today', tasks: dated.filter((t) => day(t) === today) },
			{ title: 'Upcoming', tasks: dated.filter((t) => day(t) > today) },
			{
				title: 'Unscheduled',
				tasks: open.filter((t) => !due(t)).sort((a, b) => (a.priority ?? 9) - (b.priority ?? 9))
			}
		].filter((s) => s.tasks.length);
	});
</script>

{#if showTasks && !ui.focus}
	<aside
		bind:this={panel}
		aria-label="Tasks"
		class="relative flex w-[248px] shrink-0 flex-col gap-3 border-l px-2.5 py-3"
	>
		<div class="flex items-center px-1.5">
			<h2 class="grow text-[13px] font-semibold">Tasks</h2>
			<Button
				size="icon-xs"
				variant="ghost"
				class="text-muted-foreground"
				aria-label="Hide tasks pane"
				onclick={() => (showTasks = false)}><ChevronsRight /></Button
			>
		</div>
		<div class="-mx-1 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-1">
			{#each sections as s (s.title)}
				<div class="flex flex-col gap-px">
					<h3 class="px-1.5 pb-1 text-[11.5px] font-medium text-muted-foreground">{s.title}</h3>
					{#each s.tasks as t (t.id)}<TaskItem task={t} nested={false} brief />{/each}
				</div>
			{:else}
				<p class="px-1.5 text-[13px] text-muted-foreground">No open tasks.</p>
			{/each}
		</div>
		<p class="px-1.5 text-[11.5px] text-muted-foreground">
			Drag onto the calendar to schedule. Drop back here to unschedule.
		</p>
		{#if unscheduling}
			<!-- a scheduled task is dragged in the grid: the whole pane is the target -->
			<div
				class="pointer-events-none absolute inset-2 flex flex-col items-center justify-center gap-2 rounded-lg border-[1.5px] border-dashed border-foreground bg-muted p-3 text-center"
			>
				<CalendarX class="size-5" />
				<div class="font-semibold">Drop to unschedule</div>
				<div class="text-[11.5px] text-muted-foreground">
					Start and end are cleared. The deadline stays.
				</div>
			</div>
		{/if}
	</aside>
{:else if !ui.focus}
	<button
		aria-label="Show tasks pane"
		class="flex w-[34px] shrink-0 flex-col items-center gap-2.5 border-l bg-panel pt-3.5 text-muted-foreground hover:text-foreground"
		onclick={() => (showTasks = true)}
	>
		<ChevronsLeft class="size-4" />
		<span class="text-xs font-medium [writing-mode:vertical-rl]">Tasks · {open.length}</span>
	</button>
{/if}
