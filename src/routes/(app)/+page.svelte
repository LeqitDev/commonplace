<script lang="ts">
	// "/": the first page that is switched on (Settings › General), the calendar by default.
	import { goto } from '$app/navigation';
	import { settings } from '#lib/data.svelte.ts';
	import { homePage } from '#modules/registry.ts';

	$effect(() => void goto(homePage(settings()), { replaceState: true }));
</script>
