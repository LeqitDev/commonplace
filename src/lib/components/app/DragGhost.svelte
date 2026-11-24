<script lang="ts">
	// Small pill following the pointer during a dnd.svelte.ts drag.
	import { dnd } from '#lib/dnd.svelte.ts';
	import FileText from '@lucide/svelte/icons/file-text';
	import FolderIcon from '@lucide/svelte/icons/folder';
</script>

{#if dnd.item}
	<div
		class="pointer-events-none fixed z-50 flex max-w-56 items-center gap-1.5 rounded-md border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md {dnd.over
			? ''
			: 'opacity-70'}"
		style="left: {dnd.x + 12}px; top: {dnd.y + 10}px"
	>
		{#if dnd.item.kind === 'folder'}<FolderIcon class="size-3.5 shrink-0" />{:else}<FileText
				class="size-3.5 shrink-0"
			/>{/if}
		<span class="truncate">{dnd.item.label}</span>
	</div>
{/if}
