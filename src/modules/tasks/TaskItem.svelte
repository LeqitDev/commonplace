<script lang="ts">
	import Self from './TaskItem.svelte';
	import { Checkbox } from '#lib/components/ui/checkbox/index.ts';
	import { db } from '#lib/data.svelte.ts';
	import { children, setDone } from './taskActions.ts';
	import { localIso, parseDate } from '#lib/tasks.ts';
	import { ui } from '#lib/ui.svelte.ts';
	import { PRIORITIES, type Task } from '#lib/types.ts';
	import { format } from 'date-fns';
	import Repeat from '@lucide/svelte/icons/repeat';
	import Bell from '@lucide/svelte/icons/bell';
	import Flag from '@lucide/svelte/icons/flag';

	let {
		task,
		nested = true,
		depth = 0,
		brief = false
	}: {
		task: Task;
		nested?: boolean;
		depth?: number;
		/** Narrow lists (calendar pane): today's time, else the day it is due, else the estimate. */
		brief?: boolean;
	} = $props();
	const subs = $derived(
		nested
			? children(task.id).sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''))
			: []
	);
	const done = $derived(task.status === 'done' || task.status === 'cancelled');
	const color = $derived(
		(task.categoryId && db.categories.items[task.categoryId]?.color) ||
			(task.projectId && db.projects.items[task.projectId]?.color)
	);
	const project = $derived(task.projectId ? db.projects.items[task.projectId]?.name : '');
	const fmt = (s: string) =>
		new Date(s.length === 10 ? `${s}T00:00` : s).toLocaleString(
			[],
			s.length === 10 ? { dateStyle: 'medium' } : { dateStyle: 'medium', timeStyle: 'short' }
		);
	/** brief: what the pane shows on the right */
	const when = $derived.by(() => {
		const s = task.deadline ?? task.start;
		if (!s) return { text: task.estimate ? `${task.estimate}m` : '' };
		const today = localIso(new Date(), true);
		const day = s.slice(0, 10) === today || localIso(parseDate(s), true) === today;
		const overdue = localIso(parseDate(s), true) < today;
		if (day && task.deadline) return { flag: true, text: '' };
		if (day) return { text: s.length > 10 ? format(parseDate(s), 'HH:mm') : '' };
		return { text: format(parseDate(s), 'd MMM'), overdue, flag: !!task.deadline };
	});
</script>

<div
	data-task={task.id}
	class="group flex cursor-pointer items-center gap-2 rounded-md pr-1.5 hover:bg-muted {brief
		? 'h-8 text-[13px]'
		: 'py-1.5 text-sm'}"
	style="padding-left: {(brief ? 0.375 : 0.5) + depth * 1.25}rem"
	role="button"
	tabindex="0"
	onclick={() => {
		ui.event = null;
		ui.task = task.id;
	}}
	onkeydown={(e) => e.key === 'Enter' && (ui.task = task.id)}
>
	<span onclick={(e) => e.stopPropagation()} role="none" class="flex">
		<Checkbox
			checked={done}
			onCheckedChange={(v) => setDone(task, !!v)}
			aria-label="Done: {task.title}"
		/>
	</span>
	{#if color}<span class="size-[7px] shrink-0 rounded-full" style="background:{color}"></span>{/if}
	<span class="min-w-0 flex-1 truncate" class:line-through={done} class:text-muted-foreground={done}
		>{task.title}</span
	>
	<span class="flex shrink-0 items-center gap-2 text-xs text-muted-foreground tabular-nums">
		{#if brief}
			{#if when.flag}<Flag class="size-3" aria-label="Deadline" />{/if}
			{#if when.text}<span
					class="text-[11.5px]"
					class:font-medium={when.overdue}
					class:text-foreground={when.overdue}>{when.text}</span
				>{/if}
		{:else}
			{#if task.priority && task.priority <= 2}<span class="font-medium text-foreground"
					>{PRIORITIES[task.priority]}</span
				>{/if}
			{#if task.status && !done}<span>{task.status}</span>{/if}
			{#if task.start}<span>{fmt(task.start)}</span>{/if}
			{#if task.deadline}<span class="flex items-center gap-1"
					><Flag class="size-3" />{fmt(task.deadline)}</span
				>{/if}
			{#if task.estimate}<span>{task.estimate}m</span>{/if}
			{#if task.rrule}<Repeat class="size-3" />{/if}
			{#if task.reminders?.length}<Bell class="size-3" />{/if}
			{#if project}<span class="max-w-24 truncate">{project}</span>{/if}
		{/if}
	</span>
</div>
{#each subs as s (s.id)}
	<Self task={s} depth={depth + 1} />
{/each}
