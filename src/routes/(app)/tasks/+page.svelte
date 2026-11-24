<script lang="ts">
	import { page } from '$app/state';
	import * as Tabs from '#lib/components/ui/tabs/index.ts';
	import TaskItem from '#modules/tasks/TaskItem.svelte';
	import { create, db } from '#lib/data.svelte.ts';
	import { isInbox, isOpen, parseDate } from '#lib/tasks.ts';
	import { inFocus, ui } from '#lib/ui.svelte.ts';
	import type { Task } from '#lib/types.ts';

	let tab = $state(localStorage.getItem('tasksTab') ?? 'inbox');
	$effect(() => localStorage.setItem('tasksTab', tab));
	$effect(() => {
		const id = page.url.searchParams.get('open');
		if (id) ui.task = id;
	});

	const endOfToday = new Date(new Date().setHours(23, 59, 59, 999));
	const when = (t: Task) =>
		t.start ? new Date(t.start) : t.deadline ? parseDate(t.deadline) : null;
	const byPriority = (a: Task, b: Task) =>
		(a.priority ?? 9) - (b.priority ?? 9) ||
		(when(a)?.getTime() ?? Infinity) - (when(b)?.getTime() ?? Infinity);

	const all = $derived(db.tasks.all.filter(inFocus));
	const open = $derived(all.filter((t) => isOpen(t) && !t.parentId));
	const lists = $derived({
		inbox: open
			.filter(isInbox)
			.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? '')),
		today: open
			.filter((t) => (when(t)?.getTime() ?? Infinity) <= endOfToday.getTime())
			.sort(byPriority),
		upcoming: open
			.filter((t) => (when(t)?.getTime() ?? 0) > endOfToday.getTime())
			.sort((a, b) => when(a)!.getTime() - when(b)!.getTime()),
		all: open.toSorted(byPriority),
		done: all
			.filter((t) => !isOpen(t))
			.sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''))
			.slice(0, 200)
	});
	const TABS = {
		inbox: 'Inbox',
		today: 'Today',
		upcoming: 'Upcoming',
		all: 'All',
		done: 'Done'
	} as const;

	async function quickAdd(e: KeyboardEvent & { currentTarget: HTMLInputElement }) {
		const input = e.currentTarget;
		const title = input.value.trim();
		if (e.key !== 'Enter' || !title) return;
		input.value = '';
		await create('tasks', { title, projectId: ui.project });
	}
</script>

<div class="mx-auto flex h-full w-full max-w-3xl flex-col gap-4 overflow-y-auto p-6">
	<input
		class="h-10 w-full rounded-md border border-input bg-transparent px-3 text-sm"
		placeholder="Add a task to the inbox…  (Enter)"
		onkeydown={quickAdd}
	/>
	<Tabs.Root bind:value={tab}>
		<Tabs.List>
			{#each Object.entries(TABS) as [k, label] (k)}
				<Tabs.Trigger value={k}
					>{label}
					<span class="ml-1 text-xs text-muted-foreground"
						>{lists[k as keyof typeof TABS].length}</span
					></Tabs.Trigger
				>
			{/each}
		</Tabs.List>
		{#each Object.keys(TABS) as k (k)}
			<Tabs.Content value={k} class="mt-2">
				{#each lists[k as keyof typeof TABS] as t (t.id)}
					<TaskItem task={t} nested={k !== 'done'} />
				{:else}
					<p class="py-10 text-center text-sm text-muted-foreground">Nothing here.</p>
				{/each}
			</Tabs.Content>
		{/each}
	</Tabs.Root>
</div>
