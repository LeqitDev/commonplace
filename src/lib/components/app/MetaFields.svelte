<script lang="ts">
	// Project / category / tags fields shared by the task, event and note editors.
	import AppSelect from './AppSelect.svelte';
	import { db, update, type CollName } from '#lib/data.svelte.ts';

	let {
		coll,
		doc,
		category = true,
		set = (p) => update(coll, doc.id, p as never)
	}: {
		coll: Extract<CollName, 'tasks' | 'events' | 'notes'>;
		doc: { id: string; projectId?: string | null; categoryId?: string | null; tags?: string[] };
		category?: boolean;
		/** Override for unsaved docs (event drafts). */
		set?: (p: Record<string, unknown>) => void;
	} = $props();

	const cls = 'border-input h-8 w-full rounded-md border bg-transparent px-2 text-sm';
	const none = { value: '', label: 'None' };
</script>

<span class="text-muted-foreground">Project</span>
<AppSelect
	value={doc.projectId}
	options={[
		none,
		...db.projects.all
			.filter((p) => !p.archived || p.id === doc.projectId)
			.map((p) => ({ value: p.id, label: p.name }))
	]}
	onchange={(v) => set({ projectId: v || null })}
/>
{#if category}
	<span class="text-muted-foreground">Category</span>
	<AppSelect
		value={doc.categoryId}
		options={[none, ...db.categories.all.map((c) => ({ value: c.id, label: c.name }))]}
		onchange={(v) => set({ categoryId: v || null })}
	/>
{/if}
<span class="text-muted-foreground">Tags</span>
<input
	class={cls}
	placeholder="comma, separated"
	value={(doc.tags ?? []).join(', ')}
	onchange={(e) => {
		const tags = e.currentTarget.value
			.split(',')
			.map((t) => t.trim())
			.filter(Boolean);
		set({ tags: tags.length ? tags : null });
	}}
/>
