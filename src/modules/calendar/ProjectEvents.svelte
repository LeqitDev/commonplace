<script lang="ts">
	import { db } from '#lib/data.svelte.ts';
	import { ui } from '#lib/ui.svelte.ts';
	import type { Project } from '#lib/types.ts';

	let { project }: { project: Project } = $props();
	const now = new Date().toISOString();
	const events = $derived(
		db.events.all
			.filter(
				(e) =>
					e.projectId === project.id && (e.rrule || e.times?.length || (e.end ?? e.start) >= now)
			)
			.sort((a, b) => a.start.localeCompare(b.start))
			.slice(0, 15)
	);
</script>

<section>
	<h2 class="mb-2 text-xs font-medium text-muted-foreground uppercase">Upcoming events</h2>
	{#each events as e (e.id)}
		<button
			class="flex w-full justify-between rounded-md px-2 py-1 text-left text-sm hover:bg-muted/60"
			onclick={() => (ui.event = { id: e.id })}
		>
			<span class="truncate">{e.title}</span>
			<span class="text-xs text-muted-foreground"
				>{e.rrule || e.times?.some((t) => t.rrule)
					? 'recurring'
					: new Date(e.start).toLocaleDateString()}</span
			>
		</button>
	{:else}<p class="text-sm text-muted-foreground">None.</p>{/each}
</section>
