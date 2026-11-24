<script lang="ts">
	// CalDAV status, then the read-only feeds as rows that open one at a time.
	import AppSelect from '#lib/components/app/AppSelect.svelte';
	import ColorPicker from '#lib/components/app/ColorPicker.svelte';
	import * as Select from '#lib/components/ui/select/index.ts';
	import { Switch } from '#lib/components/ui/switch/index.ts';
	import { api, create, dav, db, featureOn, remove, syncDav, update } from '#lib/data.svelte.ts';
	import { confirmAction } from '#lib/choice.svelte.ts';
	import type { Feed } from '#lib/types.ts';
	import Info from '@lucide/svelte/icons/info';
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';
	import Plus from '@lucide/svelte/icons/plus';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import Trash from '@lucide/svelte/icons/trash-2';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import X from '@lucide/svelte/icons/x';
	import Field from './Field.svelte';
	import Row from './Row.svelte';
	import { addRow, card, h2, h3, input, quiet, soft, tabPanel, when } from './styles.ts';

	const SHOW = { all: 'Only in “All projects”', always: 'Always', projects: 'Chosen projects' };
	const feeds = $derived(db.feeds.all);
	let open = $state<string | null>(db.feeds.all[0]?.id ?? null);
	let syncing = $state<string | null>(null);

	const set = (id: string, p: Partial<Feed>) => update('feeds', id, p, false);
	async function sync(id: string) {
		syncing = id;
		try {
			await api(`/api/feeds/sync?id=${id}`, { method: 'POST' });
		} finally {
			await db.feeds.load(); // pick up lastSync / error
			syncing = null;
		}
	}
	async function add() {
		const f = await create(
			'feeds',
			{ name: 'Calendar', type: 'ics', url: '', enabled: true, color: '#888888' } as Partial<Feed>,
			false
		);
		open = f.id;
		requestAnimationFrame(() => document.getElementById(`feed-url-${f.id}`)?.focus());
	}
	async function drop(f: Feed) {
		if (await confirmAction(`Remove “${f.name}”?`)) await remove('feeds', f.id, false);
	}
	const setProjects = (f: Feed, ids: string[]) =>
		set(f.id, { projectIds: ids.length ? ids : null } as never);
</script>

<div role="tabpanel" aria-labelledby="h-cal" class="{tabPanel} gap-6">
	<h2 id="h-cal" class="{h2} pr-9">Calendars</h2>

	<section class="flex flex-col gap-2">
		<div class="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
			<h3 class={h3}>CalDAV</h3>
			<span class="text-muted-foreground">events and tasks</span>
		</div>
		{#if dav.configured}
			<div
				class="flex min-h-13.5 flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border px-4 py-2"
			>
				{#if dav.error}
					<TriangleAlert class="size-4 shrink-0" />
				{:else}
					<RefreshCw
						class="size-4 shrink-0 text-muted-foreground {dav.busy ? 'animate-spin' : ''}"
					/>
				{/if}
				<span class="min-w-0 flex-[1_1_200px]">
					{#if dav.error}<span class="font-medium">{dav.error}</span>{:else if dav.busy}<span
							class="font-medium">Syncing…</span
						>{:else if dav.lastSync}<span class="font-medium tabular-nums"
							>Synced {when(dav.lastSync)}</span
						>{:else}<span class="font-medium">Not synced yet</span>{/if}
					{#if dav.pending}<span class="text-muted-foreground">
							· {dav.pending} waiting to be sent</span
						>{/if}
				</span>
				<button class="{soft} h-8.5 px-3" disabled={dav.busy} onclick={syncDav}>Sync now</button>
			</div>
		{:else}
			<div
				class="flex min-h-13.5 items-center gap-3 rounded-xl border border-dashed border-line2 px-4 py-2 text-muted-foreground"
			>
				<Info class="size-4 shrink-0" />
				<span
					>CalDAV is not set up on the server, so events and tasks stay in Commonplace only. It is
					switched on with <code>CALDAV_URL</code> in the server's configuration.</span
				>
			</div>
		{/if}
	</section>

	{#if featureOn('calendar')}<section class="flex flex-col gap-2">
			<div class="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
				<h3 class={h3}>External calendars</h3>
				<span class="text-muted-foreground">read-only, refreshed hourly</span>
			</div>
			<div class={card}>
				{#each feeds as f (f.id)}
					{@const busy = syncing === f.id}
					<Row
						label={f.name}
						open={open === f.id}
						ontoggle={() => (open = open === f.id ? null : f.id)}
						enabled={f.enabled !== false}
						onenabled={(v) => set(f.id, { enabled: v })}
					>
						{#snippet head()}
							<span
								class="size-3 shrink-0 rounded-full"
								style="border: 2.5px solid {f.color ?? 'var(--line2)'}"
							></span>
							<span class="font-medium whitespace-nowrap">{f.name}</span>
							<span class="min-w-0 flex-1 truncate text-muted-foreground"
								>{f.type === 'ics' ? 'ICS' : 'CalDAV'} · {SHOW[f.show ?? 'all'].replace(
									/^\w/,
									(c) => c.toLowerCase()
								)}</span
							>
							{#if busy}
								<span
									role="status"
									class="flex items-center gap-1.5 text-[11.5px] text-muted-foreground"
									><LoaderCircle class="size-3.5 animate-spin" />Syncing…</span
								>
							{:else if f.error}
								<span
									class="flex min-w-0 shrink items-center gap-1.5 text-[11.5px] font-medium"
									title={f.error}
									><TriangleAlert class="size-3.5 shrink-0" /><span class="truncate"
										>Sync failed</span
									></span
								>
							{:else if f.lastSync}
								<span class="text-[11.5px] whitespace-nowrap text-muted-foreground tabular-nums"
									>Synced {when(f.lastSync)}</span
								>
							{/if}
						{/snippet}

						{#if f.error && !busy}
							<div class="flex items-center gap-2 rounded-lg bg-muted px-3 py-2">
								<TriangleAlert class="size-4 shrink-0" />
								<span class="min-w-0 font-medium"
									>{f.error}{f.lastSync ? ' Events from the last sync are still shown.' : ''}</span
								>
							</div>
						{/if}
						<div
							class="grid grid-cols-[repeat(auto-fit,minmax(min(250px,100%),1fr))] gap-x-5 gap-y-2"
						>
							<Field label="Name" for="feed-name-{f.id}">
								<div class="flex gap-1.5">
									<ColorPicker
										mark="ring"
										class="border border-line2"
										title="Colour of {f.name}"
										value={f.color}
										onchange={(color) => set(f.id, { color })}
									/>
									<input
										id="feed-name-{f.id}"
										class="{input} flex-1"
										value={f.name}
										onchange={(e) => set(f.id, { name: e.currentTarget.value.trim() || f.name })}
									/>
								</div>
							</Field>
							<Field label="Type">
								<AppSelect
									value={f.type}
									options={[
										{ value: 'ics', label: 'ICS / webcal URL' },
										{ value: 'caldav', label: 'CalDAV' }
									]}
									onchange={(v) => set(f.id, { type: v as Feed['type'] })}
								/>
							</Field>
							<Field label="URL" for="feed-url-{f.id}" wide>
								<input
									id="feed-url-{f.id}"
									class={input}
									value={f.url}
									placeholder={f.type === 'ics'
										? 'https://…/calendar.ics'
										: 'https://dav.example.com/calendars/me/personal/'}
									onchange={(e) => set(f.id, { url: e.currentTarget.value.trim() })}
								/>
							</Field>
							<Field label="Username" for="feed-user-{f.id}">
								<input
									id="feed-user-{f.id}"
									class={input}
									value={f.username ?? ''}
									placeholder="none"
									autocomplete="off"
									onchange={(e) => set(f.id, { username: e.currentTarget.value })}
								/>
							</Field>
							<Field label="Password" for="feed-pass-{f.id}">
								<input
									id="feed-pass-{f.id}"
									class={input}
									type="password"
									autocomplete="new-password"
									placeholder={f.username ? 'unchanged' : 'none'}
									onchange={(e) => set(f.id, { password: e.currentTarget.value })}
								/>
							</Field>
							<Field label="Show">
								<AppSelect
									value={f.show ?? 'all'}
									options={Object.entries(SHOW).map(([value, label]) => ({ value, label }))}
									onchange={(v) => set(f.id, { show: v as Feed['show'] })}
								/>
							</Field>
							{#if f.show === 'projects'}
								<Field label="Projects">
									<div
										role="group"
										aria-label="Projects"
										class="flex min-h-8.5 flex-wrap items-center gap-1 rounded-lg border border-line2 p-1"
									>
										{#each f.projectIds ?? [] as id (id)}
											{@const p = db.projects.items[id]}
											{#if p}
												<span class="flex h-6 items-center gap-1.5 rounded-md bg-muted pr-0.5 pl-2">
													{#if p.color}<span
															class="size-1.75 shrink-0 rounded-full"
															style="background: {p.color}"
														></span>{/if}
													{p.name}
													<button
														aria-label="Remove {p.name}"
														class="flex size-5 items-center justify-center rounded text-muted-foreground hover:text-foreground"
														onclick={() =>
															setProjects(
																f,
																(f.projectIds ?? []).filter((x) => x !== id)
															)}><X class="size-3" /></button
													>
												</span>
											{/if}
										{/each}
										<span class="flex-1"></span>
										<Select.Root
											type="multiple"
											value={f.projectIds ?? []}
											onValueChange={(v) => setProjects(f, v)}
										>
											<Select.Trigger
												aria-label="Choose projects"
												class="h-6! justify-center border-0 p-0 px-1 shadow-none dark:bg-transparent"
											>
												{#if !f.projectIds?.length}<span class="text-muted-foreground"
														>Choose projects</span
													>{/if}
											</Select.Trigger>
											<Select.Content>
												{#each db.projects.all.filter((p) => !p.archived || f.projectIds?.includes(p.id)) as p (p.id)}
													<Select.Item value={p.id} label={p.name} />
												{/each}
											</Select.Content>
										</Select.Root>
									</div>
								</Field>
							{/if}
							<Field label="Keep past" wide>
								<div class="flex min-h-8.5 items-center gap-2.5 text-muted-foreground">
									<Switch
										aria-label="Keep past events of {f.name}"
										checked={!!f.keepPast}
										onCheckedChange={(v) => set(f.id, { keepPast: v || null } as never)}
									/>
									Events stay in the calendar after they drop out of the sync window (90 days back).
								</div>
							</Field>
						</div>
						<div class="flex items-center gap-2 border-t pt-2.5">
							<button class={soft} disabled={!f.url || busy} onclick={() => sync(f.id)}
								>Sync now</button
							>
							<span class="flex-1"></span>
							<button class={quiet} onclick={() => drop(f)}><Trash />Remove</button>
						</div>
					</Row>
				{/each}
				<button class={addRow} onclick={add}><Plus />Add calendar</button>
			</div>
		</section>{/if}
</div>
