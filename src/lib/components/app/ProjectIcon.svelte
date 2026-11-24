<script lang="ts">
	// A project's lucide icon (default: folder), tinted with the project colour.
	import { Icon } from '@lucide/svelte';
	import Folder from '@lucide/svelte/icons/folder';
	import { icons } from '#lib/icons.svelte.ts';

	let {
		icon,
		color,
		class: className
	}: { icon?: string | null; color?: string | null; class?: string } = $props();

	const node = $derived(icon ? icons()?.[icon] : undefined);
	const style = $derived(color ? `color:${color}` : '');
</script>

{#if node}
	<Icon iconNode={node} class={className} {style} />
{:else}
	<Folder class={className} {style} />
{/if}
