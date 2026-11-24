<script lang="ts">
	// Reading pane toolbar: Archive, Later (bring-back menu), Flag, Unread; the project on the right.
	import { goto } from '$app/navigation';
	import * as DropdownMenu from '#lib/components/ui/dropdown-menu/index.ts';
	import { db } from '#lib/data.svelte.ts';
	import { laterPresets, senderMatches } from '#modules/mail/mail.ts';
	import {
		act,
		alwaysForSender,
		projectOf,
		setLater,
		setThreadProject
	} from '#modules/mail/mail.svelte.ts';
	import { ui } from '#lib/ui.svelte.ts';
	import { longDate } from '#modules/mail/mailFormat.ts';
	import type { MailThreadRow } from '#lib/types.ts';
	import ProjectIcon from '#lib/components/app/ProjectIcon.svelte';
	import Archive from '@lucide/svelte/icons/archive';
	import Clock from '@lucide/svelte/icons/clock';
	import Flag from '@lucide/svelte/icons/flag';
	import MailOpen from '@lucide/svelte/icons/mail-open';
	import Mail from '@lucide/svelte/icons/mail';
	import Check from '@lucide/svelte/icons/check';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import Reply from '@lucide/svelte/icons/reply';
	import SquareCheck from '@lucide/svelte/icons/square-check';
	import CalendarIcon from '@lucide/svelte/icons/calendar';
	import FileText from '@lucide/svelte/icons/file-text';

	let {
		row,
		laterOpen = $bindable(false),
		onarchive,
		onlater,
		onreply,
		onturn
	}: {
		row: MailThreadRow;
		laterOpen?: boolean;
		onarchive: () => void;
		/** After "later" was set: the page moves on to the next conversation. */
		onlater: () => void;
		onreply: (kind: 'reply' | 'all' | 'forward' | 'compose') => void;
		onturn: (kind: 'task' | 'event' | 'note') => void;
	} = $props();

	const own = $derived(db.mail_threads.items[row.thread]);
	const project = $derived(projectOf(row));
	const p = $derived(project ? db.projects.items[project] : null);
	const projects = $derived(
		db.projects.all.filter((x) => !x.archived).toSorted((a, b) => a.name.localeCompare(b.name))
	);
	const mine = $derived(new Set(db.mail_accounts.all.map((a) => a.address.toLowerCase())));
	/** The address "Always for this sender" is about: the first one that isn't ours. */
	const sender = $derived(row.senders.find((s) => s && !mine.has(s.toLowerCase())) ?? '');
	const ruled = $derived(!!p?.senders?.some((r) => senderMatches(r, sender)));

	async function later(at: Date | null) {
		await setLater(row, at);
		if (at) onlater();
	}
	function pickSlot() {
		ui.slotFor = $state.snapshot(row);
		goto('/calendar');
	}
	const btn =
		'flex h-[34px] items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium hover:bg-muted';
	const kbd = 'rounded bg-muted px-1.5 text-[11px] font-normal text-muted-foreground';
</script>

<div class="flex min-h-[60px] flex-wrap items-center gap-1.5 border-b px-4 py-2.5">
	<button class={btn} onclick={onarchive} title="Archive (e)"
		><Archive class="size-4" />Archive <kbd class={kbd}>E</kbd></button
	>
	<DropdownMenu.Root bind:open={laterOpen}>
		<DropdownMenu.Trigger class={btn} title="Bring back later (l)">
			<Clock class="size-4" />{own?.later && own.later > new Date().toISOString()
				? longDate(own.later)
				: 'Later'}
			<kbd class={kbd}>L</kbd>
		</DropdownMenu.Trigger>
		<DropdownMenu.Content align="start" class="w-60">
			<DropdownMenu.Label class="text-xs font-normal text-muted-foreground"
				>Bring back</DropdownMenu.Label
			>
			{#each laterPresets() as preset (preset.label)}
				<DropdownMenu.Item onSelect={() => later(preset.at)}>
					<span class="flex-1">{preset.label}</span>
					<span class="text-xs text-muted-foreground tabular-nums"
						>{longDate(preset.at.toISOString()).replace(/^Today, /, '')}</span
					>
				</DropdownMenu.Item>
			{/each}
			<DropdownMenu.Separator />
			<DropdownMenu.Item onSelect={pickSlot}>Pick a slot in the calendar…</DropdownMenu.Item>
			{#if own?.later}
				<DropdownMenu.Item onSelect={() => later(null)}>Don't bring back</DropdownMenu.Item>
			{/if}
		</DropdownMenu.Content>
	</DropdownMenu.Root>
	<button
		class="grid size-[34px] place-items-center rounded-lg hover:bg-muted {row.flagged
			? 'text-foreground'
			: 'text-muted-foreground'}"
		title={row.flagged ? 'Unflag' : 'Flag'}
		aria-pressed={row.flagged}
		onclick={() => act(row.thread, { flagged: !row.flagged })}
		><Flag class="size-4 {row.flagged ? 'fill-current' : ''}" /></button
	>
	<button
		class="grid size-[34px] place-items-center rounded-lg text-muted-foreground hover:bg-muted"
		title={row.unread ? 'Mark as read (u)' : 'Mark as unread (u)'}
		onclick={() => act(row.thread, { seen: !!row.unread })}
		>{#if row.unread}<MailOpen class="size-4" />{:else}<Mail class="size-4" />{/if}</button
	>
	<div class="mx-1.5 h-5 w-px bg-line2"></div>
	<span class="text-[11.5px] text-muted-foreground">Turn into</span>
	<div class="flex rounded-[9px] bg-muted p-[3px]" role="group" aria-label="Turn into">
		{#each [['task', 'Task', SquareCheck], ['event', 'Event', CalendarIcon], ['note', 'Note', FileText]] as const as [kind, label, Icon] (kind)}
			<button
				class="flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[13px] hover:bg-background"
				title="Turn into a {kind}"
				onclick={() => onturn(kind)}><Icon class="size-4" />{label}</button
			>
		{/each}
	</div>
	<div class="flex-1"></div>
	<div class="flex items-center rounded-lg border border-line2">
		<button
			class="flex h-8 items-center gap-1.5 rounded-l-lg px-3 text-[13px] font-medium hover:bg-muted"
			title="Reply (r)"
			onclick={() => onreply('reply')}
			><Reply class="size-4" />Reply <kbd class={kbd}>R</kbd></button
		>
		<DropdownMenu.Root>
			<DropdownMenu.Trigger
				class="grid h-8 w-7 place-items-center rounded-r-lg border-l border-line2 hover:bg-muted"
				title="More replies"><ChevronDown class="size-3.5" /></DropdownMenu.Trigger
			>
			<DropdownMenu.Content align="end">
				<DropdownMenu.Item onSelect={() => onreply('compose')}
					>Reply in the editor</DropdownMenu.Item
				>
				<DropdownMenu.Item onSelect={() => onreply('all')}>Reply all</DropdownMenu.Item>
				<DropdownMenu.Item onSelect={() => onreply('forward')}>Forward</DropdownMenu.Item>
			</DropdownMenu.Content>
		</DropdownMenu.Root>
	</div>
	<DropdownMenu.Root>
		<DropdownMenu.Trigger
			class="flex h-[26px] items-center gap-1.5 rounded-full px-2.5 text-xs {p
				? 'bg-muted'
				: 'border text-muted-foreground'}"
			title="Project"
		>
			{#if p}<ProjectIcon icon={p.icon} color={p.color} class="size-3.5" />{p.name}{:else}No project{/if}
			<ChevronDown class="size-3 text-muted-foreground" />
		</DropdownMenu.Trigger>
		<DropdownMenu.Content align="end" class="max-h-80 w-60 overflow-y-auto">
			{#each projects as x (x.id)}
				<DropdownMenu.Item onSelect={() => setThreadProject(row, x.id)}>
					<ProjectIcon icon={x.icon} color={x.color} class="size-3.5" />
					<span class="flex-1 truncate">{x.name}</span>
					{#if x.id === project}<Check class="size-3.5" />{/if}
				</DropdownMenu.Item>
			{/each}
			{#if own?.projectId}
				<DropdownMenu.Item onSelect={() => setThreadProject(row, null)}
					>Not by hand (rules)</DropdownMenu.Item
				>
			{/if}
			{#if p && sender && !ruled}
				<DropdownMenu.Separator />
				<DropdownMenu.Item onSelect={() => alwaysForSender(p.id, sender)}>
					<span class="truncate">Always {p.name} for {sender}</span>
				</DropdownMenu.Item>
			{/if}
		</DropdownMenu.Content>
	</DropdownMenu.Root>
</div>
