<script lang="ts">
	// Calendar: "Pick a slot in the calendar…" from a mail is waiting for a drag-select.
	import { Button } from '#lib/components/ui/button/index.ts';
	import { ui } from '#lib/ui.svelte.ts';
</script>

{#if ui.slotFor}
	<div class="flex items-center gap-3 border-b bg-muted/50 px-4 py-2 text-[13px]">
		<span class="min-w-0 flex-1 truncate"
			>Drag over the time when <span class="font-medium"
				>{ui.slotFor.subject || '(no subject)'}</span
			> should come back.</span
		>
		<Button size="sm" variant="ghost" onclick={() => (ui.slotFor = null)}>Cancel</Button>
	</div>
{/if}
