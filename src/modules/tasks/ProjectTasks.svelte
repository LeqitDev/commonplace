<script lang="ts">
	import TaskItem from './TaskItem.svelte';
	import { db } from '#lib/data.svelte.ts';
	import { isOpen } from '#lib/tasks.ts';
	import type { Project } from '#lib/types.ts';

	let { project }: { project: Project } = $props();
	const tasks = $derived(
		db.tasks.all.filter((t) => t.projectId === project.id && !t.parentId && isOpen(t))
	);
</script>

<section>
	<h2 class="mb-2 text-xs font-medium text-muted-foreground uppercase">Tasks</h2>
	{#each tasks as t (t.id)}<TaskItem task={t} />{:else}<p class="text-sm text-muted-foreground">
			No open tasks.
		</p>{/each}
</section>
