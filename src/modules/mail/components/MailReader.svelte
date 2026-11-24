<script lang="ts">
	// Reading pane: toolbar, what the conversation became, the messages (earlier ones folded),
	// attachments, and the quick reply.
	import { api, db, featureOn } from '#lib/data.svelte.ts';
	import { longDate, initials, shortDate, sizeLabel } from '#modules/mail/mailFormat.ts';
	import {
		itemsOf,
		projectOf,
		setLater,
		startReply,
		toEvent,
		toNote,
		toTask
	} from '#modules/mail/mail.svelte.ts';
	import { hrefFor } from '#lib/ui.svelte.ts';
	import { laterAt, type FoundDate } from '#modules/mail/dates.ts';
	import type { FileMeta, MailMessage, MailThreadRow } from '#lib/types.ts';
	import { format } from 'date-fns';
	import { toast } from 'svelte-sonner';
	import AccountMark from './AccountMark.svelte';
	import MailBody from './MailBody.svelte';
	import MailToolbar from './MailToolbar.svelte';
	import QuickReply from './QuickReply.svelte';
	import InviteCard from './InviteCard.svelte';
	import TriageStrip from './TriageStrip.svelte';
	import Paperclip from '@lucide/svelte/icons/paperclip';
	import Download from '@lucide/svelte/icons/download';
	import SquareCheck from '@lucide/svelte/icons/square-check';
	import CalendarIcon from '@lucide/svelte/icons/calendar';
	import FileText from '@lucide/svelte/icons/file-text';

	let {
		thread,
		row,
		laterOpen = $bindable(false),
		onarchive,
		onlater
	}: {
		thread: string;
		/** The list row; missing when the thread was opened from elsewhere (search). */
		row?: MailThreadRow;
		laterOpen?: boolean;
		onarchive: (t: MailThreadRow) => void;
		onlater: (t: MailThreadRow) => void;
	} = $props();
	let messages = $state<MailMessage[] | null>(null);
	let failed = $state(false);
	let unfolded = $state<Record<number, boolean>>({});

	$effect(() => {
		const t = thread;
		messages = null;
		failed = false;
		unfolded = {};
		api<MailMessage[]>(`/api/mail/${encodeURIComponent(t)}`)
			.then((m) => t === thread && (messages = m))
			.catch(() => t === thread && (failed = true));
	});

	const mine = $derived(new Set(db.mail_accounts.all.map((a) => a.address.toLowerCase())));
	const isMe = (addr: string) => mine.has(addr.toLowerCase());
	const subject = $derived(messages?.at(-1)?.subject || messages?.[0]?.subject || '(no subject)');
	// the newest message (and invitations) are open, the earlier ones are folded until clicked
	const isOpen = (m: MailMessage, i: number) =>
		i === messages!.length - 1 || !!unfolded[m.id] || m.invite?.method === 'REQUEST'; // the card stays visible
	const partUrl = (m: MailMessage, n: number) => `/api/mail/part/${m.id}/${n}`;

	// what the toolbar needs, from the messages when the thread isn't in the list
	const current = $derived.by((): MailThreadRow | null => {
		if (row) return row;
		const last = messages?.at(-1);
		if (!messages || !last) return null;
		return {
			thread,
			account: last.account,
			date: last.date,
			sort: last.date,
			senders: [...new Set(messages.map((m) => m.fromAddr))],
			fromName: last.fromName,
			fromAddr: last.fromAddr,
			to: last.to,
			subject: last.subject,
			snippet: last.snippet,
			count: messages.length,
			unread: messages.filter((m) => !m.seen).length,
			flagged: messages.some((m) => m.flagged),
			attach: messages.some((m) => m.attachments.some((a) => !a.inline)),
			invite: false
		};
	});
	const project = $derived(current ? db.projects.items[projectOf(current) ?? ''] : undefined);
	const items = $derived(itemsOf(thread));

	let quick = $state<{ focus(): void }>();
	/** `r`: write in the quick reply. */
	export const focusReply = () => quick?.focus();
	function reply(kind: 'reply' | 'all' | 'forward' | 'compose') {
		if (!messages?.length) return;
		if (kind === 'reply') return quick?.focus();
		void startReply(kind === 'compose' ? 'reply' : kind, messages, thread);
	}
	function turnInto(kind: 'task' | 'event' | 'note', date?: FoundDate) {
		if (!messages?.length || !current) return;
		if (kind === 'task') toTask(current, messages, date);
		else if (kind === 'event') toEvent(current, messages, date);
		else void toNote(current, messages);
	}
	/** A date in a mail was chosen: a task or event then, or bring the mail back then. */
	async function onDate(d: FoundDate, kind: 'task' | 'event' | 'later') {
		if (kind !== 'later') return turnInto(kind, d);
		const t = current;
		if (!t) return;
		await setLater(t, laterAt(d));
		onlater(t);
	}

	/** Attachments saved to the notes in this session: "msg:n" → file id. */
	let saved = $state<Record<string, string>>({});
	async function saveToNotes(m: MailMessage, n: number) {
		const f = await api<FileMeta>(`/api/mail/part/${m.id}/${n}/save`, {
			method: 'POST',
			body: JSON.stringify({ projectId: project?.id ?? null })
		});
		db.files.items[f.id] = f;
		saved[`${m.id}:${n}`] = f.id;
		toast(`Saved to ${project ? `${project.name} notes` : 'the notes'}`, { description: f.name });
	}
	const chip =
		'flex h-[26px] items-center gap-1.5 rounded-full border border-line2 px-2.5 text-xs hover:bg-muted';
	const when = (iso: string, allDay?: boolean) =>
		format(
			new Date(iso.length === 10 ? `${iso}T00:00` : iso),
			allDay || iso.length === 10 ? 'EEE d MMM' : 'EEE d MMM, HH:mm'
		);
</script>

{#if current}
	<MailToolbar
		row={current}
		bind:laterOpen
		onarchive={() => onarchive(current!)}
		onlater={() => onlater(current!)}
		onreply={reply}
		onturn={(k) => turnInto(k)}
	/>
{/if}
<div class="flex min-h-0 flex-1 flex-col overflow-y-auto">
	<div class="flex w-full flex-col gap-5 px-10 pt-7 pb-10">
		{#if failed}
			<p class="text-sm text-muted-foreground">This conversation couldn't be loaded.</p>
		{:else if !messages}
			<p class="text-sm text-muted-foreground">Loading…</p>
		{:else if !messages.length}
			<p class="text-sm text-muted-foreground">This conversation is no longer there.</p>
		{:else}
			<h2 class="m-0 text-[22px] leading-tight font-semibold tracking-tight">{subject}</h2>
			{#if featureOn('triage')}<TriageStrip {thread} />{/if}
			{#if items.tasks.length || items.events.length || items.notes.length}
				<!-- what this conversation became: links go both ways -->
				<div class="-mt-2 flex flex-wrap gap-1.5">
					{#each items.tasks as t (t.id)}
						<a href={hrefFor('tasks', t.id)} class={chip}
							><SquareCheck class="size-3.5" />{t.title}{#if t.deadline}<span
									class="text-muted-foreground">· {when(t.deadline)}</span
								>{/if}</a
						>
					{/each}
					{#each items.events as e (e.id)}
						<a href={hrefFor('events', e.id)} class={chip}
							><CalendarIcon class="size-3.5" />{e.title}<span class="text-muted-foreground"
								>· {when(e.start, e.allDay)}</span
							></a
						>
					{/each}
					{#each items.notes as n (n.id)}
						<a href={hrefFor('notes', n.id)} class={chip}><FileText class="size-3.5" />{n.title}</a>
					{/each}
				</div>
			{/if}
			<div class="flex flex-col">
				{#each messages as m, i (m.id)}
					{@const acc = db.mail_accounts.items[m.account]}
					{@const me = isMe(m.fromAddr)}
					{#if isOpen(m, i)}
						<article class="flex flex-col gap-3.5 border-t pt-3.5 pb-4">
							<div class="flex items-center gap-3">
								<span
									class="grid size-7 shrink-0 place-items-center rounded-full text-[11px] font-semibold {me
										? 'bg-muted'
										: 'bg-foreground text-background'}"
									>{me ? 'Me' : initials(m.fromName, m.fromAddr)}</span
								>
								<div class="min-w-0 flex-1 text-sm">
									<span class="font-semibold" title={m.fromAddr}
										>{me ? 'Me' : m.fromName || m.fromAddr}</span
									>
									<span class="text-muted-foreground">to</span>
									{#if me}
										<span class="text-muted-foreground"
											>{m.to.map((t) => t.name || t.address).join(', ') || '…'}</span
										>
									{:else}
										<span class="inline-flex items-center gap-1 align-middle text-muted-foreground"
											><AccountMark account={acc} />{acc?.name ?? ''}</span
										>
									{/if}
								</div>
								<span class="text-xs text-muted-foreground tabular-nums">{longDate(m.date)}</span>
							</div>
							{#if m.invite}
								<InviteCard message={m} ondeclined={() => current && onarchive(current)} />
							{/if}
							<div class="pl-10">
								<MailBody message={m} ondate={onDate} />
							</div>
							{#each m.attachments.filter((a) => !a.inline) as a (a.n)}
								<div
									class="ml-10 flex items-center gap-2 rounded-[10px] border py-1.5 pr-1.5 pl-3 text-sm"
								>
									<Paperclip class="size-4 shrink-0 text-muted-foreground" />
									<span class="min-w-0 flex-1 truncate"
										><span class="font-medium">{a.filename}</span>
										<span class="text-muted-foreground">· {sizeLabel(a.size)}</span></span
									>
									<a
										class="h-7 rounded-md px-2.5 text-xs leading-7 font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
										href={partUrl(m, a.n)}
										target="_blank"
										rel="noopener">Open</a
									>
									<a
										class="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
										href={`${partUrl(m, a.n)}?download`}
										title="Download"><Download class="size-4" /></a
									>
									{#if saved[`${m.id}:${a.n}`]}
										<a
											class="h-7 rounded-md bg-muted px-2.5 text-xs leading-7 font-medium"
											href={hrefFor('files', saved[`${m.id}:${a.n}`])}>In the notes</a
										>
									{:else}
										<button
											class="h-7 rounded-md bg-muted px-2.5 text-xs font-medium hover:bg-accent"
											onclick={() => saveToNotes(m, a.n)}
											>Save to {project ? `${project.name} notes` : 'notes'}</button
										>
									{/if}
								</div>
							{/each}
						</article>
					{:else}
						<button
							class="flex h-11 w-full items-center gap-3 border-t text-left text-sm text-muted-foreground hover:text-foreground"
							onclick={() => (unfolded[m.id] = true)}
						>
							<span
								class="grid size-7 shrink-0 place-items-center rounded-full bg-muted text-[11px] font-semibold"
								>{me ? 'Me' : initials(m.fromName, m.fromAddr)}</span
							>
							<span class="w-32 shrink-0 truncate {m.seen ? '' : 'font-semibold text-foreground'}"
								>{me ? 'Me' : m.fromName || m.fromAddr}</span
							>
							<span class="min-w-0 flex-1 truncate">{m.snippet}</span>
							<span class="text-xs tabular-nums">{shortDate(m.date)}</span>
						</button>
					{/if}
				{/each}
			</div>
			<QuickReply bind:this={quick} {thread} {messages} />
		{/if}
	</div>
</div>
