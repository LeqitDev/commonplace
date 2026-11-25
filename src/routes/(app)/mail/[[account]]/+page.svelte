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

	// the inbox split by the triage: all, "needs you", "other" (remembered per browser)
	type Split = '' | 'needs' | 'other';
	const SPLIT_KEY = 'mail:split';
	let split = $state<Split>(
		(() => {
			try {
				return (localStorage.getItem(SPLIT_KEY) ?? '') as Split;
			} catch {
				return '';
			}
		})()
	);
	function setSplit(v: Split) {
		split = v;
		try {
			localStorage.setItem(SPLIT_KEY, v);
		} catch {
			/* storage unavailable */
		}
	}
	const splitOf = () => (view === 'inbox' && featureOn('triage') ? split : '');

	let threads = $state<MailThreadRow[]>([]);
	let more = $state(false);
	let loading = $state(false);
	let loadedFor = $state('');

	const query = (o: Record<string, string | number | null>) =>
		new URLSearchParams(
			Object.entries({ view, account, project: ui.project, split: splitOf() || null, ...o }).filter(
				([, v]) => v != null
			) as [string, string][]
		);

	/** First page (or as many as are shown, to keep the place after a change on the server). */
	async function load(keep = false) {
		const key = `${account}|${view}|${ui.project}|${splitOf()}`;
		const limit = keep ? Math.min(Math.max(threads.length, PAGE), 200) : PAGE;
		const rows = await api<MailThreadRow[]>(`/api/mail?${query({ limit })}`);
		if (key !== `${account}|${view}|${ui.project}|${splitOf()}`) return;
		threads = rows;
		more = splitOf() !== 'needs' && rows.length === limit; // "needs you" comes in one piece
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
		const key = `${account}|${view}|${ui.project}|${splitOf()}`;
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
	const SPLITS = [
		['', 'All'],
		['needs', 'Needs you'],
		['other', 'Other']
	] as const;
	// the split only where the triage has something to say
	const showSplit = $derived(
		view === 'inbox' &&
			featureOn('triage') &&
			(device.on || !!split || threads.some((t) => t.triage))
	);
	const triaging = $derived(showSplit && device.on && triage.running);
</script>

<div class="flex h-full min-h-0">
	<section
		class="flex w-[360px] shrink-0 flex-col border-r {ui.focus && open ? 'hidden' : ''}"
		aria-label="Messages"
	>
		<header class="flex h-[60px] shrink-0 items-center gap-1.5 border-b pr-3 pl-2.5">
			<!-- the folder (and the triage split of the inbox) in one menu -->
			<DropdownMenu.Root>
				<DropdownMenu.Trigger
					class="flex min-w-0 shrink-0 items-baseline gap-1.5 rounded-md px-1.5 py-1 outline-hidden hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50"
					title="Folder"
				>
					<h1 class="m-0 text-[17px] font-semibold tracking-tight">{viewLabel}</h1>
					{#if showSplit && split}<span class="text-[13px] whitespace-nowrap text-muted-foreground"
							>{SPLITS.find(([v]) => v === split)?.[1]}</span
						>{/if}
					<ChevronDown class="size-3.5 shrink-0 self-center text-muted-foreground" />
				</DropdownMenu.Trigger>
				<DropdownMenu.Content align="start" class="w-52">
					{#each VIEWS as v (v.id)}
						<DropdownMenu.Item onSelect={() => goto(href({ view: v.id, m: null }))}>
							<span class="flex-1">{v.label}</span>
							{#if view === v.id}<Check class="size-3.5" />{/if}
						</DropdownMenu.Item>
					{/each}
					{#if showSplit}
						<DropdownMenu.Separator />
						<DropdownMenu.Label class="text-xs font-normal text-muted-foreground"
							>Inbox by triage</DropdownMenu.Label
						>
						<DropdownMenu.RadioGroup
							value={split || 'all'}
							onValueChange={(v) => setSplit((v === 'all' ? '' : v) as Split)}
						>
							{#each SPLITS as [v, label] (v)}
								<DropdownMenu.RadioItem value={v || 'all'}>{label}</DropdownMenu.RadioItem>
							{/each}
						</DropdownMenu.RadioGroup>
					{/if}
				</DropdownMenu.Content>
			</DropdownMenu.Root>
			<span class="min-w-0 flex-1 truncate text-[13px] text-muted-foreground" {title}
				>{title}{#if toTriage}&nbsp;· {toTriage} to triage{/if}</span
			>
			{#if showSplit && device.on && triage.error && !triage.running}
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
