<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { Button } from '#lib/components/ui/button/index.ts';
	import ColorPicker from '#lib/components/app/ColorPicker.svelte';
	import IconPicker from '#lib/components/app/IconPicker.svelte';
	import { batch, db, featureOn, remove, settings, update } from '#lib/data.svelte.ts';
	import { slot } from '#lib/slots.svelte.ts';
	import { homePage } from '#modules/registry.ts';
	import AppSelect from '#lib/components/app/AppSelect.svelte';
	import * as DropdownMenu from '#lib/components/ui/dropdown-menu/index.ts';
	import { ask, confirmAction } from '#lib/choice.svelte.ts';
	import { hrefFor, pick, setProject, ui } from '#lib/ui.svelte.ts';
	import Plus from '@lucide/svelte/icons/plus';
	import X from '@lucide/svelte/icons/x';

	const p = $derived(db.projects.items[page.params.id!]);
	const sections = $derived(slot('projectSections').toSorted((a, b) => a.order - b.order));
	const minutes = $derived(
		db.pomodoros.all.filter((x) => x.projectId === p?.id).reduce((s, x) => s + x.minutes, 0)
	);

	// sidebar groups are just names: the ones in use can be chosen, "New group…" asks for one
	const NEW = '+';
	const groupOptions = $derived([
		{ value: '', label: 'No group' },
		...[...new Set(db.projects.all.map((x) => x.group).filter((g) => !!g))]
			.sort()
			.map((g) => ({ value: g!, label: g! })),
		{ value: NEW, label: 'New group…' }
	]);
	async function setGroup(v: string) {
		const group = v === NEW ? await ask('New group', { placeholder: 'Group name' }) : v;
		if (p && (v !== NEW || group)) update('projects', p.id, { group: group || null });
	}

	const external = (url: string) => !url.startsWith('/');
	const setLinks = (links: NonNullable<typeof p.links>) =>
		update('projects', p.id, { links: links.length ? links : null } as never);
	async function addUrl() {
		let url = await ask('Add link', { placeholder: 'https://…', label: 'Next' });
		if (!url) return;
		if (!/^([a-z][\w+.-]*:|\/)/i.test(url)) url = `https://${url}`;
		const title = await ask('Title of the link', { value: url.replace(/^https?:\/\//, '') });
		if (title && p) setLinks([...(p.links ?? []), { title, url }]);
	}
	async function pinItem() {
		const hit = await pick();
		if (p) setLinks([...(p.links ?? []), { title: hit.title, url: hrefFor(hit.coll, hit.id) }]);
	}

	async function del() {
		if (
			!p ||
			!(await confirmAction(
				`Delete project “${p.name}”?`,
				'Its notes, tasks, events and folders are kept but unassigned.'
			))
		)
			return;
		const id = p.id;
		await goto(homePage(settings()));
		if (ui.project === id) setProject(null);
		await batch(async () => {
			for (const c of ['tasks', 'events', 'notes', 'folders', 'files'] as const)
				for (const d of db[c].all.filter((d) => d.projectId === id))
					await update(c, d.id, { projectId: null });
			for (const f of db.feeds.all.filter((f) => f.projectIds?.includes(id)))
				await update('feeds', f.id, { projectIds: f.projectIds!.filter((x) => x !== id) });
			await remove('projects', id);
		});
	}
</script>

{#if p}
	<div class="mx-auto flex h-full w-full max-w-4xl flex-col gap-6 overflow-y-auto p-6">
		<div class="flex items-center gap-3">
			<IconPicker
				value={p.icon}
				color={p.color}
				onchange={(icon) => update('projects', p.id, { icon })}
			/>
			<ColorPicker
				class="size-6"
				value={p.color ?? '#888888'}
				onchange={(color) => update('projects', p.id, { color })}
			/>
			<input
				class="min-w-0 flex-1 bg-transparent text-2xl font-semibold outline-none"
				value={p.name}
				onchange={(e) => update('projects', p.id, { name: e.currentTarget.value })}
			/>
			<Button
				size="sm"
				variant={ui.project === p.id ? 'default' : 'outline'}
				onclick={() => setProject(ui.project === p.id ? null : p.id)}
			>
				{ui.project === p.id ? 'Focused' : 'Focus'}
			</Button>
			<Button
				size="sm"
				variant="ghost"
				title="An archived project leaves the sidebar, and “All projects” leaves out what is in it"
				onclick={() => {
					if (!p.archived && ui.project === p.id) setProject(null);
					update('projects', p.id, { archived: !p.archived });
				}}>{p.archived ? 'Unarchive' : 'Archive'}</Button
			>
			<Button size="sm" variant="destructive" onclick={del}>Delete</Button>
		</div>
		<div class="-mt-4 flex items-center gap-3 text-xs text-muted-foreground">
			{#if featureOn('pomodoro')}<span>{Math.round(minutes / 6) / 10} h tracked with pomodoro</span
				>{/if}
			<AppSelect
				class="h-7 w-40 text-xs"
				value={p.group ?? ''}
				placeholder="No group"
				options={groupOptions}
				onchange={setGroup}
				title="Group in the sidebar"
			/>
		</div>

		<section>
			<h2 class="mb-2 flex items-center text-xs font-medium text-muted-foreground uppercase">
				<span class="flex-1">Links</span>
				<DropdownMenu.Root>
					<DropdownMenu.Trigger
						class="rounded-sm p-0.5 hover:bg-muted hover:text-foreground"
						title="Pin a link"><Plus class="size-3.5" /></DropdownMenu.Trigger
					>
					<DropdownMenu.Content align="end" class="w-48">
						<DropdownMenu.Item onSelect={addUrl}>Web address…</DropdownMenu.Item>
						<DropdownMenu.Item onSelect={pinItem}>Note, task, event…</DropdownMenu.Item>
					</DropdownMenu.Content>
				</DropdownMenu.Root>
			</h2>
			<div class="flex flex-wrap gap-2">
				{#each p.links ?? [] as link, i (i)}
					<span class="group flex items-center rounded-md border text-sm hover:bg-muted/60">
						<a
							class="max-w-64 truncate py-1 pl-2.5"
							href={link.url}
							title={link.url}
							target={external(link.url) ? '_blank' : undefined}
							rel="noopener">{link.title}</a
						>
						<button
							class="px-1.5 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground focus-visible:opacity-100"
							title="Remove link"
							onclick={() => setLinks(p.links!.filter((_, j) => j !== i))}
							><X class="size-3" /></button
						>
					</span>
				{:else}
					<p class="text-sm text-muted-foreground">Nothing pinned.</p>
				{/each}
			</div>
		</section>

		{#each sections.filter((x) => x.column === 'wide') as x (x)}<x.component project={p} />{/each}

		<div class="grid grid-cols-2 gap-8">
			{#each [1, 2] as col (col)}
				<div class="flex flex-col gap-6">
					{#each sections.filter((x) => x.column === col) as x (x)}<x.component
							project={p}
						/>{/each}
				</div>
			{/each}
		</div>
	</div>
{:else}
	<div class="grid h-full place-items-center text-sm text-muted-foreground">Project not found.</div>
{/if}
