<script lang="ts">
	// Label + control in the two-column grid of an opened settings row.
	import type { Snippet } from 'svelte';

	let {
		label,
		for: forId,
		wide = false,
		children
	}: { label: string; for?: string; wide?: boolean; children: Snippet } = $props();
</script>

<div
	class="grid min-h-8.5 grid-cols-[76px_minmax(0,1fr)] items-center {wide ? 'col-span-full' : ''}"
>
	{#if forId}
		<label for={forId} class="text-muted-foreground">{label}</label>
	{:else}
		<span class="text-muted-foreground">{label}</span>
	{/if}
	{@render children()}
</div>
