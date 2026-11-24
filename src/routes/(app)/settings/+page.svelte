<script lang="ts">
	// Settings live in a floating panel; old links (/settings, /settings#mail) open it over the home page.
	import { goto } from '$app/navigation';
	import { openSettings } from '#lib/ui.svelte.ts';
	import { onMount } from 'svelte';
	import { settings } from '#lib/data.svelte.ts';
	import { homePage } from '#modules/registry.ts';

	onMount(() => {
		const tab = location.hash.slice(1);
		openSettings(tab || 'general'); // an unknown tab shows the first one
		goto(homePage(settings()), { replaceState: true });
	});
</script>
