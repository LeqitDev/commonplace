<script lang="ts">
	import * as Dialog from '#lib/components/ui/dialog/index.ts';
	import { SHORTCUTS } from '#lib/shortcuts.ts';
	import { slot } from '#lib/slots.svelte.ts';

	let { open = $bindable(false) } = $props();
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-w-md">
		<Dialog.Header><Dialog.Title>Keyboard shortcuts</Dialog.Title></Dialog.Header>
		<dl class="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
			{#each [...SHORTCUTS, ...slot('shortcuts')] as [keys, what] (keys)}
				<dt class="font-mono text-xs">{keys}</dt>
				<dd class="text-muted-foreground">{what}</dd>
			{/each}
		</dl>
	</Dialog.Content>
</Dialog.Root>
