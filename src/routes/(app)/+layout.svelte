<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import * as Sidebar from '#lib/components/ui/sidebar/index.ts';
	import AppSidebar from '#lib/components/app/AppSidebar.svelte';
	import CommandPalette from '#lib/components/app/CommandPalette.svelte';
	import ShortcutHelp from '#lib/components/app/ShortcutHelp.svelte';
	import ChoiceDialog from '#lib/components/app/ChoiceDialog.svelte';
	import DragGhost from '#lib/components/app/DragGhost.svelte';
	import Start from '#lib/components/app/Start.svelte';
	import { dav, featureOn, loadAll, redo, settings, syncDav, undo } from '#lib/data.svelte.ts';
	import { active, merged, slot } from '#lib/slots.svelte.ts';
	import { homePage, moduleOfPath } from '#modules/registry.ts';
	import { startReminders } from '#lib/reminders.svelte.ts';
	import { bindKeys } from '#lib/shortcuts.ts';
	import { openSettings, toggleFocus, ui } from '#lib/ui.svelte.ts';
	import SettingsPanel from '#lib/components/settings/SettingsPanel.svelte';
	import { Button } from '#lib/components/ui/button/index.ts';
	import X from '@lucide/svelte/icons/x';
	import { untrack } from 'svelte';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();
	let help = $state(false);
	const loading = loadAll();
	let ready = $state(false);
	void loading.then(() => (ready = true));

	// a page that was switched off: go to the first one that is on
	$effect(() => {
		const m = moduleOfPath(page.url.pathname);
		if (ready && m && !featureOn(m)) void goto(homePage(settings()), { replaceState: true });
	});

	// the modules' shortcuts (rebound when one is switched on or off)
	$effect(() => {
		const keys = merged('keys');
		return untrack(() => bindKeys(keys));
	});

	$effect(() => {
		let stopReminders = () => {};
		loading.then(() => {
			stopReminders = startReminders();
		});
		const unbind = bindKeys(
			{
				'$mod+k': () => (ui.palette = !ui.palette),
				'$mod+z': undo,
				'$mod+Shift+z': redo,
				'$mod+y': redo,
				'g s': () => goto('/stats'),
				'g ,': () => (ui.settings ? (ui.settings = null) : openSettings()),
				n: () => (ui.palette = true),
				f: () => toggleFocus(),
				'Shift+?': () => (help = true)
			},
			{ always: ['$mod+k'] }
		);
		// what other apps changed on the CalDAV server: on coming back to the tab, and every 5 minutes
		const pull = () =>
			(featureOn('calendar') || featureOn('tasks')) && void syncDav().catch(() => {});
		const onFocus = () => Date.now() - Date.parse(dav.lastSync ?? '') > 60_000 && pull();
		loading.then(pull);
		const poll = setInterval(pull, 300_000);
		window.addEventListener('focus', onFocus);
		const onFs = () => !document.fullscreenElement && ui.focus && toggleFocus(false);
		document.addEventListener('fullscreenchange', onFs);
		return () => {
			unbind();
			stopReminders();
			clearInterval(poll);
			window.removeEventListener('focus', onFocus);
			document.removeEventListener('fullscreenchange', onFs);
		};
	});
</script>

{#await loading}
	<div class="grid h-svh place-items-center text-sm text-muted-foreground">Loading…</div>
{:then}
	<Sidebar.Provider>
		{#if !ui.focus}
			<AppSidebar />
		{:else}
			<!-- the way out without a keyboard (iPad): the sidebar with its button is hidden -->
			<Button
				size="icon-sm"
				variant="ghost"
				class="fixed top-1 right-1 z-40 text-muted-foreground/40 hover:text-foreground"
				title="Leave focus mode (f)"
				onclick={() => toggleFocus(false)}><X /></Button
			>
		{/if}
		<main class="flex h-svh min-w-0 flex-1 flex-col">
			{@render children()}
		</main>
	</Sidebar.Provider>
	<CommandPalette />
	<ShortcutHelp bind:open={help} />
	<ChoiceDialog />
	<DragGhost />
	<SettingsPanel />
	{#each slot('panels') as Panel (Panel)}<Panel />{/each}
	{#each active().filter((m) => m.start) as m (m.id)}<Start run={m.start!} />{/each}
{:catch e}
	<div class="grid h-svh place-items-center text-sm">Could not load data: {e.message}</div>
{/await}
