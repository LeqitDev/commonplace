<script lang="ts">
	import { page } from '$app/state';
	import FolderTree from '#modules/notes/FolderTree.svelte';
	import NewNoteMenu from '#modules/notes/NewNoteMenu.svelte';
	import ProjectIcon from '#lib/components/app/ProjectIcon.svelte';
	import { db } from '#lib/data.svelte.ts';
	import { dnd, droppable } from '#lib/dnd.svelte.ts';
	import { openDailyNote } from '#modules/notes/notes.ts';
	import { fileDrop, moveItem, toggle, tree } from '#modules/notes/tree.svelte.ts';
	import { ui } from '#lib/ui.svelte.ts';
	import { cn } from '#lib/utils.ts';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import CalendarDays from '@lucide/svelte/icons/calendar-days';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();
	const projects = $derived(
		db.projects.all
			.filter((p) => !p.archived && (!ui.project || p.id === ui.project))
			.sort((a, b) => a.name.localeCompare(b.name))
	);
	const daily = $derived(
		db.notes.all
			.filter((n) => n.daily)
			.sort((a, b) => b.daily!.localeCompare(a.daily!))
			.slice(0, 60)
	);
	const root =
		'group flex h-7 items-center gap-1 rounded-md pr-1 text-xs font-medium text-muted-foreground hover:bg-muted/60';
</script>

<!-- one collapsible root per project (or Unfiled); notes/folders can be dropped on it -->
{#snippet section(key: string, label: string, projectId: string | null)}
	{@const open = !tree.collapsed[key]}
	<div
		class={cn(root, 'mt-1 data-file-over:bg-accent', dnd.over === key && 'bg-accent')}
		{@attach droppable(
			key,
			() => true,
			(i) => moveItem(i, projectId, null)
		)}
		{@attach fileDrop(() => projectId)}
	>
		<button class="flex min-w-0 flex-1 items-center gap-1 pl-1" onclick={() => toggle(key)}>
			<ChevronRight class="size-3.5 shrink-0 transition-transform {open ? 'rotate-90' : ''}" />
			{#if projectId}
				{@const p = db.projects.items[projectId]}
				<ProjectIcon icon={p?.icon} color={p?.color} class="size-3.5 shrink-0" />
			{/if}
			<span class="truncate">{label}</span>
		</button>
		<NewNoteMenu {projectId} class="opacity-0 group-hover:opacity-100" />
	</div>
	{#if open}
		<div class="relative">
			<!-- indent guide under the chevron, as in the tree -->
			<span class="pointer-events-none absolute inset-y-0 left-[calc(0.25rem+7px)] border-l"></span>
			<FolderTree {projectId} />
		</div>
	{/if}
{/snippet}

<div class="flex h-full min-h-0">
	{#if !ui.focus}
		<aside class="w-64 shrink-0 overflow-y-auto border-r p-2">
			<div class="flex items-center gap-1 px-1 pb-1">
				<span class="flex-1 text-sm font-semibold">Notes</span>
				<button
					class="grid size-5 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
					title="Today's note"
					onclick={() => openDailyNote()}><CalendarDays class="size-3.5" /></button
				>
				<NewNoteMenu projectId={ui.project} />
			</div>
			{#if !ui.project}{@render section('section:unfiled', 'Unfiled', null)}{/if}
			{#each projects as p (p.id)}
				{@render section(`section:${p.id}`, p.name, p.id)}
			{/each}
			{#if daily.length && !ui.project}
				{@const open = !tree.collapsed['section:daily']}
				<div class={cn(root, 'mt-1')}>
					<button
						class="flex min-w-0 flex-1 items-center gap-1 pl-1"
						onclick={() => toggle('section:daily')}
					>
						<ChevronRight
							class="size-3.5 shrink-0 transition-transform {open ? 'rotate-90' : ''}"
						/>
						Daily
					</button>
				</div>
				{#if open}
					<div class="relative">
						<span class="pointer-events-none absolute inset-y-0 left-[calc(0.25rem+7px)] border-l"
						></span>
						{#each daily as n (n.id)}
							<a
								href={`/notes/${n.id}`}
								class="flex h-7 items-center gap-1.5 rounded-md pl-[2.4rem] text-sm hover:bg-muted/60 {page
									.params.id === n.id
									? 'bg-muted font-medium'
									: ''}"><CalendarDays class="size-3.5 text-muted-foreground" />{n.daily}</a
							>
						{/each}
					</div>
				{/if}
			{/if}
		</aside>
	{/if}
	<div class="min-w-0 flex-1">{@render children()}</div>
</div>
