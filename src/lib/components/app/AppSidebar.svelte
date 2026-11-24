<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import * as Sidebar from '#lib/components/ui/sidebar/index.ts';
	import { Button } from '#lib/components/ui/button/index.ts';
	import { create, db, history, redo, undo } from '#lib/data.svelte.ts';
	import { openSettings, setProject, toggleFocus, ui } from '#lib/ui.svelte.ts';
	import { slot } from '#lib/slots.svelte.ts';
	import { toggleMode } from 'mode-watcher';
	import AppSelect from './AppSelect.svelte';
	import { ask } from '#lib/choice.svelte.ts';
	import ChartBar from '@lucide/svelte/icons/chart-column';
	import Settings from '@lucide/svelte/icons/settings';
	import Search from '@lucide/svelte/icons/search';
	import Undo2 from '@lucide/svelte/icons/undo-2';
	import Redo2 from '@lucide/svelte/icons/redo-2';
	import Focus from '@lucide/svelte/icons/scan';
	import SunMoon from '@lucide/svelte/icons/sun-moon';
	import Plus from '@lucide/svelte/icons/plus';
	import ProjectIcon from './ProjectIcon.svelte';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import Ellipsis from '@lucide/svelte/icons/ellipsis';
	import { toggle, tree } from '#lib/tree-state.svelte.ts';
	import type { NavItem } from '#lib/modules.ts';

	const sorted = $derived(db.projects.all.toSorted((a, b) => a.name.localeCompare(b.name)));
	const projects = $derived(sorted.filter((p) => !p.archived));
	const archived = $derived(sorted.filter((p) => p.archived));
	/** Projects by group: the ones without a group first (name ''), then the groups by name, then
	 *  the archived ones (closed until opened: their flag in `tree.collapsed` means "open"). */
	const groups = $derived([
		...[...Map.groupBy(projects, (p) => p.group ?? '')]
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([name, list]) => {
				const key = `group:${name}`;
				return { key, name, list, open: !tree.collapsed[key] };
			}),
		...(archived.length
			? [{ key: 'archived', name: 'Archived', list: archived, open: !!tree.collapsed.archived }]
			: [])
	]);
	const SETTINGS: NavItem = {
		href: '/settings',
		label: 'Settings',
		icon: Settings,
		key: 'g ,',
		order: 90
	};
	const nav = $derived([...slot('nav'), SETTINGS].sort((a, b) => a.order - b.order));
	// "More": what is used now and then. Closed by default (its flag in `tree.collapsed` means open).
	const sidebar = Sidebar.useSidebar();
	const moreOpen = $derived(!!tree.collapsed.more);
	function more() {
		// the collapsed sidebar has no room for the items: open it with "More" unfolded
		if (sidebar.state === 'collapsed') {
			sidebar.setOpen(true);
			if (!moreOpen) toggle('more', false);
		} else toggle('more', moreOpen);
	}

	async function addProject() {
		const name = await ask('New project', { placeholder: 'Project name', label: 'Create' });
		if (!name) return;
		const p = await create('projects', { name });
		goto(`/projects/${p.id}`);
	}
</script>

<Sidebar.Root collapsible="icon">
	<Sidebar.Header>
		<Button
			variant="outline"
			class="w-full justify-start text-muted-foreground group-data-[collapsible=icon]:size-8 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-0"
			onclick={() => (ui.palette = true)}
		>
			<Search />
			<span class="flex-1 text-left group-data-[collapsible=icon]:hidden">Search</span>
			<kbd class="rounded bg-muted px-1.5 text-[11px] group-data-[collapsible=icon]:hidden"
				>Ctrl K</kbd
			>
		</Button>
		<AppSelect
			class="group-data-[collapsible=icon]:hidden"
			value={ui.project}
			placeholder="All projects"
			options={[
				{ value: '', label: 'All projects' },
				...sorted
					.filter((p) => !p.archived || p.id === ui.project)
					.map((p) => ({ value: p.id, label: p.name }))
			]}
			onchange={(v) => setProject(v || null)}
			title="Focus on a project"
		/>
	</Sidebar.Header>

	<Sidebar.Content>
		<Sidebar.Group>
			<Sidebar.Menu>
				{#each nav as item (item.href)}
					<Sidebar.MenuItem>
						<Sidebar.MenuButton
							isActive={item.href === '/settings'
								? !!ui.settings
								: page.url.pathname.startsWith(item.href)}
							tooltipContent={`${item.label} (${item.key})`}
						>
							{#snippet child({ props })}
								{#if item.href === '/settings'}
									<button
										{...props}
										onclick={() => (ui.settings ? (ui.settings = null) : openSettings())}
										><item.icon /><span>{item.label}</span></button
									>
								{:else}
									<a href={item.href} {...props}><item.icon /><span>{item.label}</span></a>
								{/if}
							{/snippet}
						</Sidebar.MenuButton>
						{@const n = item.badge?.()}
						{#if n}<Sidebar.MenuBadge
								class="text-[11px] font-normal text-muted-foreground tabular-nums"
								>{n}</Sidebar.MenuBadge
							>{/if}
						{#if item.extra}<item.extra />{/if}
					</Sidebar.MenuItem>
				{/each}
				<Sidebar.MenuItem>
					<Sidebar.MenuButton
						tooltipContent="More"
						isActive={!moreOpen && page.url.pathname.startsWith('/stats')}
						onclick={more}
						aria-expanded={moreOpen}
					>
						<Ellipsis /><span class="flex-1">More</span><ChevronRight
							class="size-3.5! text-muted-foreground transition-transform {moreOpen
								? 'rotate-90'
								: ''}"
						/>
					</Sidebar.MenuButton>
					{#if moreOpen}
						<Sidebar.MenuSub>
							<Sidebar.MenuSubItem>
								<Sidebar.MenuSubButton
									href="/stats"
									isActive={page.url.pathname.startsWith('/stats')}
									title="Stats (g s)"
								>
									<ChartBar /><span>Stats</span>
								</Sidebar.MenuSubButton>
							</Sidebar.MenuSubItem>
							{#each slot('more') as m (m.label)}
								<Sidebar.MenuSubItem>
									<Sidebar.MenuSubButton isActive={m.active?.()} onclick={m.run} title={m.title}>
										{#snippet child({ props })}
											<button {...props}><m.icon /><span>{m.label}</span></button>
										{/snippet}
									</Sidebar.MenuSubButton>
								</Sidebar.MenuSubItem>
							{/each}
						</Sidebar.MenuSub>
					{/if}
				</Sidebar.MenuItem>
			</Sidebar.Menu>
		</Sidebar.Group>

		<Sidebar.Group>
			<Sidebar.GroupLabel>Projects</Sidebar.GroupLabel>
			<Sidebar.GroupAction title="New project" onclick={addProject}><Plus /></Sidebar.GroupAction>
			<Sidebar.Menu>
				{#each groups as { key, name, list, open } (key)}
					{#if name}
						<Sidebar.MenuItem class="group-data-[collapsible=icon]:hidden">
							<Sidebar.MenuButton
								class="h-7 text-xs text-muted-foreground"
								onclick={() => toggle(key)}
							>
								<ChevronRight class="transition-transform {open ? 'rotate-90' : ''}" />
								<span>{name}</span>
							</Sidebar.MenuButton>
						</Sidebar.MenuItem>
					{/if}
					{#each open ? list : [] as p (p.id)}
						<Sidebar.MenuItem>
							<Sidebar.MenuButton
								isActive={page.url.pathname === `/projects/${p.id}`}
								tooltipContent={p.name}
								class={name ? 'pl-4 group-data-[collapsible=icon]:pl-2' : ''}
							>
								{#snippet child({ props })}
									<a href={`/projects/${p.id}`} {...props}>
										<ProjectIcon icon={p.icon} color={p.color} /><span>{p.name}</span>
									</a>
								{/snippet}
							</Sidebar.MenuButton>
						</Sidebar.MenuItem>
					{/each}
				{/each}
			</Sidebar.Menu>
		</Sidebar.Group>
	</Sidebar.Content>

	<Sidebar.Footer>
		{#each slot('footer') as Footer, i (i)}<Footer />{/each}
		<div class="flex items-center justify-between group-data-[collapsible=icon]:flex-col">
			<Button
				size="icon-sm"
				variant="ghost"
				disabled={!history.canUndo}
				onclick={undo}
				title="Undo (Ctrl Z)"><Undo2 /></Button
			>
			<Button
				size="icon-sm"
				variant="ghost"
				disabled={!history.canRedo}
				onclick={redo}
				title="Redo (Ctrl Shift Z)"><Redo2 /></Button
			>
			<Button size="icon-sm" variant="ghost" onclick={() => toggleFocus()} title="Focus mode (f)"
				><Focus /></Button
			>
			<Button size="icon-sm" variant="ghost" onclick={toggleMode} title="Toggle theme"
				><SunMoon /></Button
			>
			<Sidebar.Trigger title="Collapse sidebar" />
		</div>
	</Sidebar.Footer>
</Sidebar.Root>
