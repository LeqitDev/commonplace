<script lang="ts">
	// Mail: list of conversations (one view of all inboxes or of one account) and the reading pane.
	import { untrack } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { bindKeys } from '#lib/shortcuts.ts';
	import { api, db, featureOn } from '#lib/data.svelte.ts';
	import { VIEWS, type MailView } from '#modules/mail/mail.ts';
	import {
		accounts,
		act,
		archive,
		mail,
		syncMail,
		unread,
		writeNew
	} from '#modules/mail/mail.svelte.ts';
	import PenLine from '@lucide/svelte/icons/pen-line';
	import { openSettings, ui } from '#lib/ui.svelte.ts';
	import MailList from '#modules/mail/components/MailList.svelte';
	import MailReader from '#modules/mail/components/MailReader.svelte';
	import { Button } from '#lib/components/ui/button/index.ts';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import type { MailThreadRow } from '#lib/types.ts';
	import { device, triage } from '#modules/mail/triage/triage.svelte.ts';
	import { TABS, isTab, type Tab } from '#modules/mail/triage/triage.ts';
	import * as DropdownMenu from '#lib/components/ui/dropdown-menu/index.ts';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import Check from '@lucide/svelte/icons/check';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';

	const PAGE = 50;
	const account = $derived(page.params.account ?? null);
	const view = $derived((page.url.searchParams.get('view') ?? 'inbox') as MailView);
	const open = $derived(page.url.searchParams.get('m'));
	const acc = $derived(account ? db.mail_accounts.items[account] : null);
	const syncing = $derived(
		account ? !!mail.syncing[account] : accounts().some((a) => mail.syncing[a.id])
	);

	// the inbox tabs of the triage: All, Personal, Orders, News, Ads (remembered per browser)
	const TAB_KEY = 'mail:tab';
	let tab = $state<Tab | ''>(
		(() => {
			try {
				const v = localStorage.getItem(TAB_KEY);
				return isTab(v) ? v : '';
			} catch {
				return '';
			}
		})()
	);
	function setTab(v: Tab | '') {
		tab = v;
		try {
			localStorage.setItem(TAB_KEY, v);
		} catch {
			/* storage unavailable */
		}
	}
	const tabOf = () => (view === 'inbox' && featureOn('triage') ? tab : '');

	let threads = $state<MailThreadRow[]>([]);
	let more = $state(false);
	let loading = $state(false);
	let loadedFor = $state('');

	const query = (o: Record<string, string | number | null>) =>
		new URLSearchParams(
			Object.entries({ view, account, project: ui.project, tab: tabOf() || null, ...o }).filter(
				([, v]) => v != null
			) as [string, string][]
		);

	/** First page (or as many as are shown, to keep the place after a change on the server). */
	async function load(keep = false) {
		const key = `${account}|${view}|${ui.project}|${tabOf()}`;
		const limit = keep ? Math.min(Math.max(threads.length, PAGE), 200) : PAGE;
		const rows = await api<MailThreadRow[]>(`/api/mail?${query({ limit })}`);
		if (key !== `${account}|${view}|${ui.project}|${tabOf()}`) return;
		threads = rows;
		more = rows.length === limit;
		loadedFor = key;
	}
	async function loadMore() {
		if (loading || !more || !threads.length) return;
		loading = true;
		try {
			const rows = await api<MailThreadRow[]>(
				`/api/mail?${query({ limit: PAGE, before: threads.at(-1)!.sort })}`
			);
			threads = [...threads, ...rows.filter((r) => !threads.some((t) => t.thread === r.thread))];
			more = rows.length === PAGE;
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		const key = `${account}|${view}|${ui.project}|${tabOf()}`;
		if (key !== loadedFor) {
			threads = [];
			untrack(() => void load());
		}
	});
	// the server changed messages (sync, other device): reload in place
	$effect(() => {
		if (mail.version) untrack(() => void load(true));
	});
	// later, project or sender rules changed (also by undo)
	let stateKey = '';
	$effect(() => {
		const k = JSON.stringify([
			db.mail_threads.all.map((t) => [t.id, t.later, t.projectId]),
			db.projects.all.map((p) => p.senders)
		]);
		if (stateKey && k !== stateKey) untrack(() => void load(true));
		stateKey = k;
	});

	const row = $derived(open ? threads.find((t) => t.thread === open) : undefined);
	// opening an unread conversation marks it read
	$effect(() => {
		const r = row;
		if (r?.unread)
			untrack(() => {
				r.unread = 0;
				void act(r.thread, { seen: true });
			});
	});

	/** The conversation to show after this one leaves the list (archive, later). */
	function moveOn(thread: string) {
		const i = threads.findIndex((t) => t.thread === thread);
		const next = i < 0 ? null : (threads[i + 1] ?? threads[i - 1] ?? null);
		if (i >= 0) threads = threads.toSpliced(i, 1);
		if (open === thread) goto(href({ m: next?.thread ?? null }), { replaceState: true });
	}
	const doArchive = (t: MailThreadRow) => {
		if (view !== 'archive') moveOn(t.thread);
		void archive(t.thread);
	};
	const doLater = (t: MailThreadRow) => view !== 'later' && moveOn(t.thread);

	let laterOpen = $state(false);
	let reader = $state<{ focusReply(): void }>();
	function step(d: number) {
		const i = threads.findIndex((t) => t.thread === open);
		const t = threads[i < 0 ? 0 : i + d];
		if (!t) return;
		goto(href({ m: t.thread }));
		document.querySelector(`[data-thread="${t.thread}"]`)?.scrollIntoView({ block: 'nearest' });
	}
	$effect(() =>
		bindKeys({
			j: () => step(1),
			k: () => step(-1),
			ArrowDown: () => step(1),
			ArrowUp: () => step(-1),
			e: () => row && doArchive(row),
			l: () => open && (laterOpen = true),
			u: () => row && act(row.thread, { seen: !!row.unread }),
			r: () => reader?.focusReply(),
			c: () => writeNew(account),
			// not while a popover or menu takes the Escape (its focus may have gone back to the page)
			Escape: () =>
				open &&
				!document.querySelector('[data-slot=popover-content], [role=menu], [role=listbox]') &&
				goto(href({ m: null }))
		})
	);

	const href = (o: { view?: MailView; m?: string | null }) => {
		const q = new URLSearchParams();
		const v = o.view ?? view;
		if (v !== 'inbox') q.set('view', v);
		const m = 'm' in o ? o.m : open;
		if (m) q.set('m', m);
		const s = q.toString();
		return `/mail${account ? `/${account}` : ''}${s ? `?${s}` : ''}`;
	};
	const title = $derived(acc ? acc.name : 'All inboxes');
	const toTriage = $derived(unread(account));
	const noAccounts = $derived(!db.mail_accounts.all.length);
	const viewLabel = $derived(VIEWS.find((v) => v.id === view)?.label ?? 'Inbox');
	// the tabs only where the triage has something to say
	const showTabs = $derived(
		view === 'inbox' && featureOn('triage') && (device.on || !!tab || threads.some((t) => t.triage))
	);
	const triaging = $derived(showTabs && device.on && triage.running);
</script>

<div class="flex h-full min-h-0">
	<section
		class="flex w-[360px] shrink-0 flex-col border-r {ui.focus && open ? 'hidden' : ''}"
		aria-label="Messages"
	>
		<header class="flex h-[60px] shrink-0 items-center gap-1.5 border-b pr-3 pl-2.5">
			<!-- the folder -->
			<DropdownMenu.Root>
				<DropdownMenu.Trigger
					class="flex min-w-0 shrink-0 items-baseline gap-1.5 rounded-md px-1.5 py-1 outline-hidden hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50"
					title="Folder"
				>
					<h1 class="m-0 text-[17px] font-semibold tracking-tight">{viewLabel}</h1>
					<ChevronDown class="size-3.5 shrink-0 self-center text-muted-foreground" />
				</DropdownMenu.Trigger>
				<DropdownMenu.Content align="start" class="w-52">
					{#each VIEWS as v (v.id)}
						<DropdownMenu.Item onSelect={() => goto(href({ view: v.id, m: null }))}>
							<span class="flex-1">{v.label}</span>
							{#if view === v.id}<Check class="size-3.5" />{/if}
						</DropdownMenu.Item>
					{/each}
				</DropdownMenu.Content>
			</DropdownMenu.Root>
			<span class="min-w-0 flex-1 truncate text-[13px] text-muted-foreground" {title}
				>{title}{#if toTriage}&nbsp;· {toTriage} to triage{/if}</span
			>
			{#if showTabs && device.on && triage.error && !triage.running}
				<Button
					size="icon-sm"
					variant="ghost"
					class="text-muted-foreground"
					title="Triage stopped: {triage.error}"
					aria-label="Triage stopped"
					onclick={() => openSettings('mail')}><TriangleAlert /></Button
				>
			{/if}
			<Button
				size="icon-sm"
				variant="ghost"
				title={triaging
					? `Triaging${triage.waiting ? ` · ${triage.waiting} waiting` : ''}`
					: 'Sync now'}
				disabled={noAccounts}
				onclick={() => syncMail(account ?? undefined)}
				><RefreshCw class={syncing || triaging ? 'animate-spin' : ''} /></Button
			>
			<Button size="sm" disabled={noAccounts} onclick={() => writeNew(account)} title="Write (c)"
				><PenLine />Write</Button
			>
		</header>
		{#if showTabs}
			<!-- the triage's tabs of the inbox -->
			<div class="flex shrink-0 gap-0.5 border-b px-2.5 py-1.5 text-[13px]" role="tablist">
				{#each [{ id: '' as const, label: 'All' }, ...TABS] as t (t.id)}
					<button
						role="tab"
						aria-selected={tab === t.id}
						class="h-7 rounded-md px-2 {tab === t.id
							? 'bg-muted font-medium text-foreground'
							: 'text-muted-foreground hover:text-foreground'}"
						onclick={() => setTab(t.id)}>{t.label}</button
					>
				{/each}
			</div>
		{/if}
		{#if noAccounts}
			<p class="p-4 text-sm text-muted-foreground">
				No mail account yet. <button
					class="text-foreground underline"
					onclick={() => openSettings('mail')}>Add one in Settings</button
				>.
			</p>
		{:else if !threads.length}
			<p class="p-4 text-sm text-muted-foreground">
				{syncing ? 'Fetching mail…' : loadedFor ? 'Nothing here.' : 'Loading…'}
			</p>
		{/if}
		<MailList
			{threads}
			selected={open}
			href={(m) => href({ m })}
			showAccount={!account && accounts().length > 1}
			{more}
			onmore={loadMore}
		/>
	</section>
	<main class="flex min-w-0 flex-1 flex-col">
		{#if open}
			{#key open}<MailReader
					bind:this={reader}
					thread={open}
					{row}
					bind:laterOpen
					onarchive={doArchive}
					onlater={doLater}
				/>{/key}
		{:else}
			<div class="grid flex-1 place-items-center text-sm text-muted-foreground">
				{noAccounts ? '' : 'No conversation selected'}
			</div>
		{/if}
	</main>
</div>
