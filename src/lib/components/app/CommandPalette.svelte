<script lang="ts">
	import { goto } from '$app/navigation';
	import * as Command from '#lib/components/ui/command/index.ts';
	import { api, db, featureOn } from '#lib/data.svelte.ts';
	import { hrefFor, openSettings, toggleFocus, ui } from '#lib/ui.svelte.ts';
	import { merged, slot } from '#lib/slots.svelte.ts';
	import { feedVisible } from '#lib/tasks.ts';
	import { toggleMode } from 'mode-watcher';
	import type { SearchHit } from '#lib/types.ts';

	let query = $state('');
	let hits: SearchHit[] = $state([]);
	let timer: ReturnType<typeof setTimeout>;

	$effect(() => {
		const q = query;
		clearTimeout(timer);
		if (!q.trim()) return void (hits = []);
		timer = setTimeout(async () => {
			const all = await api<SearchHit[]>(`/api/search?q=${encodeURIComponent(q)}`);
			const labels = merged('search');
			hits = all.filter((h) => {
				// hits of modules that are off (core: projects, categories)
				if (!(h.coll in labels) && !(h.coll in CORE)) return false;
				if (h.coll === 'feed_event' && featureOn('calendar')) {
					const feed = db.feeds.items[h.id.split('|')[0]];
					return !!feed && feedVisible(feed, ui.project);
				}
				return !ui.project || !h.project || h.project === ui.project;
			});
		}, 120);
	});

	$effect(() => {
		if (!ui.palette) {
			query = '';
			ui.pick = null;
		}
	});

	const CORE: Record<string, string> = { projects: 'Projects', categories: 'Categories' };
	const LABELS = $derived({ ...CORE, ...merged('search') });
	const groups = $derived(
		Object.entries(Object.groupBy(hits, (h) => h.coll)) as [string, SearchHit[]][]
	);

	const CORE_COMMANDS = [
		{ label: 'Go to Stats', run: () => goto('/stats') },
		{ label: 'Open Settings', run: () => openSettings() },
		{ label: 'Toggle focus mode', run: () => toggleFocus() },
		{ label: 'Toggle dark mode', run: toggleMode }
	];
	const commands = $derived([...slot('commands'), ...CORE_COMMANDS]);
	const shownCommands = $derived(
		commands.filter((c) => c.label.toLowerCase().includes(query.toLowerCase()))
	);

	function close() {
		ui.palette = false;
	}

	function choose(hit: SearchHit) {
		const pick = ui.pick;
		close();
		if (pick) pick(hit);
		else goto(hrefFor(hit.coll, hit.id));
	}

	async function make(run: (title: string) => unknown) {
		const title = query.trim();
		close();
		await run(title);
	}

	// Linkable items that aren't full-text indexed are matched by name locally.
	const localHits = $derived.by(() => {
		if (!ui.pick || !query.trim()) return [];
		const q = query.toLowerCase();
		return db.projects.all
			.filter((p) => p.name.toLowerCase().includes(q) && !hits.some((h) => h.id === p.id))
			.map((p) => ({ coll: 'projects', id: p.id, project: p.id, title: p.name, snippet: '' }));
	});
</script>

<Command.Dialog
	bind:open={ui.palette}
	shouldFilter={false}
	title="Search"
	description="Search everything or run a command"
>
	<Command.Input
		placeholder={ui.pick ? 'Link to…' : 'Search, create or run a command…'}
		bind:value={query}
	/>
	<Command.List class="max-h-[60vh]">
		<Command.Empty>Nothing found.</Command.Empty>
		{#each groups as [coll, items] (coll)}
			<Command.Group heading={LABELS[coll] ?? coll}>
				{#each items as hit (hit.coll + hit.id)}
					<Command.Item value={hit.coll + hit.id} onSelect={() => choose(hit)}>
						<div class="flex min-w-0 flex-col">
							<span class="truncate">{hit.title}</span>
							{#if hit.snippet}
								<span
									class="truncate text-xs text-muted-foreground [&_mark]:bg-transparent [&_mark]:font-semibold [&_mark]:text-foreground"
								>
									<!-- eslint-disable-next-line svelte/no-at-html-tags -- escaped server-side, only <mark> added -->
									{@html hit.snippet}
								</span>
							{/if}
						</div>
					</Command.Item>
				{/each}
			</Command.Group>
		{/each}
		{#if localHits.length}
			<Command.Group heading="Projects">
				{#each localHits as hit (hit.id)}
					<Command.Item value={'p' + hit.id} onSelect={() => choose(hit)}>{hit.title}</Command.Item>
				{/each}
			</Command.Group>
		{/if}
		{#if query.trim() && !ui.pick && slot('create').length}
			<Command.Group heading="Create">
				{#each slot('create') as c (c.label)}
					<Command.Item onSelect={() => make(c.run)}>{c.label} “{query.trim()}”</Command.Item>
				{/each}
			</Command.Group>
		{/if}
		{#if !ui.pick && shownCommands.length}
			<Command.Group heading="Commands">
				{#each shownCommands as c (c.label)}
					<Command.Item onSelect={() => (close(), c.run())}>{c.label}</Command.Item>
				{/each}
			</Command.Group>
		{/if}
	</Command.List>
</Command.Dialog>
