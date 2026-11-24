<script lang="ts">
	// Beside a task, event or note: the mail it was made from.
	import MailChip from './components/MailChip.svelte';
	import type { Linked } from '#lib/modules.ts';

	let { item, onremove }: { item: Linked; onremove?: () => void } = $props();
</script>

{#if item.mail}<MailChip link={item.mail} {onremove} />{/if}
