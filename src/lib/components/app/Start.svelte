<script lang="ts">
	// Runs a module's `start` while the module is on (mounted per module by the app layout). It runs
	// during initialisation, so `start` may set up effects of its own.
	import { onDestroy, untrack } from 'svelte';

	let { run }: { run: () => (() => void) | void } = $props();
	const stop = untrack(() => run());
	onDestroy(() => stop?.());
</script>
