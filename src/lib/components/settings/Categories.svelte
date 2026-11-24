<script lang="ts">
	import ColorPicker from '#lib/components/app/ColorPicker.svelte';
	import { create, db, remove, update } from '#lib/data.svelte.ts';
	import Plus from '@lucide/svelte/icons/plus';
	import Trash from '@lucide/svelte/icons/trash-2';
	import { addRow, card, h2, tabPanel } from './styles.ts';

	async function add() {
		const c = await create('categories', { name: 'New category', color: '#888888' });
		requestAnimationFrame(() => {
			const el = document.querySelector<HTMLInputElement>(`[data-category="${c.id}"]`);
			el?.focus();
			el?.select();
		});
	}
</script>

<div role="tabpanel" aria-labelledby="h-cat" class={tabPanel}>
	<div class="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 pr-9">
		<h2 id="h-cat" class={h2}>Categories</h2>
		<span class="text-muted-foreground">A category's colour wins over the project's.</span>
	</div>
	<div class={card}>
		{#each db.categories.all as c (c.id)}
			<div class="flex h-12 items-center gap-1.5 border-t pr-2 pl-2.5 first:border-t-0">
				<ColorPicker
					mark="dot"
					title="Colour of {c.name}"
					value={c.color}
					onchange={(color) => update('categories', c.id, { color })}
				/>
				<input
					data-category={c.id}
					aria-label="Category name"
					class="h-8.5 min-w-0 flex-1 bg-transparent font-medium outline-none"
					value={c.name}
					onchange={(e) =>
						update('categories', c.id, { name: e.currentTarget.value.trim() || c.name })}
				/>
				<button
					aria-label="Delete category {c.name}"
					class="flex size-8.5 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
					onclick={() => remove('categories', c.id)}><Trash class="size-4" /></button
				>
			</div>
		{/each}
		<button class={addRow} onclick={add}><Plus />Add category</button>
	</div>
</div>
