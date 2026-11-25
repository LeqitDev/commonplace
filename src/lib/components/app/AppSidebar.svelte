<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import * as Sidebar from '#lib/components/ui/sidebar/index.ts';
	import { Button } from '#lib/components/ui/button/index.ts';
	import { create, db, history, redo, undo } from '#lib/data.svelte.ts';
	import { openSettings, setProject, toggleFocus, ui } from '#lib/ui.svelte.ts';
	import { slot } from '#lib/slots.svelte.ts';
	import { toggleMode } from 'mode-watcher';
	import * as DropdownMenu from '#lib/components/ui/dropdown-menu/index.ts';
	import { ask } from '#lib/choice.svelte.ts';
	import Crosshair from '@lucide/svelte/icons/crosshair';
	import EllipsisVertical from '@lucide/svelte/icons/ellipsis-vertical';
	import Keyboard from '@lucide/svelte/icons/keyboard';
	import X from '@lucide/svelte/icons/x';
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
	const path = $derived(page.url.pathname);
	const moreActive = $derived(
		path.startsWith('/stats') || slot('more').some((m) => m.href && path.startsWith(m.href))
	);
	const focused = $derived(ui.project ? db.projects.items[ui.project] : undefined);
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
	<Sidebar.Header class="flex-row items-center gap-1 group-data-[collapsible=icon]:justify-center">
		<span
			class="flex-1 truncate pl-2 text-[13px] font-semibold tracking-tight group-data-[collapsible=icon]:hidden"
			>Commonplace</span
		>
		<Button
			size="icon-sm"
			variant="ghost"
			class="text-muted-foreground"
			aria-label="Search"
			title="Search (Ctrl K)"
			onclick={() => (ui.palette = true)}><Search /></Button
		>
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
						isActive={!moreOpen && moreActive}
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
								{@const n = m.badge?.()}
								<Sidebar.MenuSubItem>
									<Sidebar.MenuSubButton
										isActive={m.href ? path.startsWith(m.href) : m.active?.()}
										title={m.title}
									>
										{#snippet child({ props })}
											{#if m.href}
												<a href={m.href} {...props}
													><m.icon /><span class="flex-1">{m.label}</span>{#if n}<span
															class="text-[11px] text-muted-foreground tabular-nums">{n}</span
														>{/if}</a
												>
											{:else}
												<button {...props} onclick={m.run}
													><m.icon /><span class="flex-1">{m.label}</span>{#if n}<span
															class="text-[11px] text-muted-foreground tabular-nums">{n}</span
														>{/if}</button
												>
											{/if}
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
						{@const on = ui.project === p.id}
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
							<Sidebar.MenuAction
								showOnHover={!on}
								class={on ? 'text-foreground' : 'text-muted-foreground'}
								aria-pressed={on}
								title={on ? 'Show all projects' : 'Focus on this project (filters every view)'}
								onclick={() => setProject(on ? null : p.id)}><Crosshair /></Sidebar.MenuAction
							>
						</Sidebar.MenuItem>
					{/each}
				{/each}
			</Sidebar.Menu>
		</Sidebar.Group>
	</Sidebar.Content>

	<Sidebar.Footer>
		{#if ui.project}
			<!-- the focus filters every view, so it stays in sight -->
			<div
				class="flex h-7 items-center gap-1.5 pr-0.5 pl-2 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden"
			>
				<Crosshair class="size-3.5 shrink-0" />
				<a class="min-w-0 flex-1 truncate hover:text-foreground" href={`/projects/${ui.project}`}
					>{focused?.name ?? 'Unknown project'}</a
				>
				<Button
					size="icon-xs"
					variant="ghost"
					class="text-muted-foreground"
					title="Show all projects"
					aria-label="Show all projects"
					onclick={() => setProject(null)}><X /></Button
				>
			</div>
			<Button
				size="icon-sm"
				variant="ghost"
				class="hidden group-data-[collapsible=icon]:flex"
				title={`Focused on ${focused?.name ?? 'a project'}: show all projects`}
				onclick={() => setProject(null)}><Crosshair /></Button
			>
		{/if}
		<div class="flex items-center gap-0.5 group-data-[collapsible=icon]:flex-col">
			<div class="flex min-w-0 flex-1 group-data-[collapsible=icon]:flex-none">
				{#each slot('footer') as Footer, i (i)}<Footer />{/each}
			</div>
			<DropdownMenu.Root>
				<DropdownMenu.Trigger
					class="grid size-7 place-items-center rounded-md text-muted-foreground outline-hidden hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring"
					title="Undo, theme, focus mode…"
					aria-label="Actions"><EllipsisVertical class="size-4" /></DropdownMenu.Trigger
				>
				<DropdownMenu.Content side="top" align="end" class="w-56">
					<DropdownMenu.Item disabled={!history.canUndo} onSelect={() => undo()}
						><Undo2 />Undo<DropdownMenu.Shortcut>Ctrl Z</DropdownMenu.Shortcut></DropdownMenu.Item
					>
					<DropdownMenu.Item disabled={!history.canRedo} onSelect={() => redo()}
						><Redo2 />Redo<DropdownMenu.Shortcut>Ctrl Shift Z</DropdownMenu.Shortcut
						></DropdownMenu.Item
					>
					<DropdownMenu.Separator />
					<DropdownMenu.Item onSelect={() => toggleFocus()}
						><Focus />Focus mode<DropdownMenu.Shortcut>F</DropdownMenu.Shortcut></DropdownMenu.Item
					>
					<DropdownMenu.Item onSelect={toggleMode}><SunMoon />Toggle theme</DropdownMenu.Item>
					<DropdownMenu.Item onSelect={() => (ui.help = true)}
						><Keyboard />Keyboard shortcuts<DropdownMenu.Shortcut>?</DropdownMenu.Shortcut
						></DropdownMenu.Item
					>
				</DropdownMenu.Content>
			</DropdownMenu.Root>
			<Sidebar.Trigger class="text-muted-foreground" title="Collapse sidebar (Ctrl B)" />
		</div>
	</Sidebar.Footer>
</Sidebar.Root>
