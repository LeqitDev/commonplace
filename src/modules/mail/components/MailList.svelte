<script lang="ts">
	// Message list: conversations grouped Today / Yesterday / Earlier.
	import { db, featureOn } from '#lib/data.svelte.ts';
	import { dayGroup, shortDate } from '#modules/mail/mailFormat.ts';
	import type { MailThreadRow } from '#lib/types.ts';
	import AccountMark from './AccountMark.svelte';
	import Paperclip from '@lucide/svelte/icons/paperclip';
	import CalendarIcon from '@lucide/svelte/icons/calendar';
	import Flag from '@lucide/svelte/icons/flag';
	import Clock from '@lucide/svelte/icons/clock';
	import Hourglass from '@lucide/svelte/icons/hourglass';
	import { hasItems, projectOf } from '#modules/mail/mail.svelte.ts';
	import SquareCheck from '@lucide/svelte/icons/square-check';
	import ShieldAlert from '@lucide/svelte/icons/shield-alert';
	import KeyRound from '@lucide/svelte/icons/key-round';
	import Package from '@lucide/svelte/icons/package';
	import { codeExpired, dueLabel, parcelLabel, summary } from '#modules/mail/triage/triage.ts';
	import { copyCode } from '#modules/mail/triage/triage.svelte.ts';

	let {
		threads,
		selected,
		href,
		showAccount,
		more,
		onmore
	}: {
		threads: MailThreadRow[];
		selected: string | null;
		href: (thread: string) => string;
		showAccount: boolean;
		more: boolean;
		onmore: () => void;
	} = $props();

	const mine = $derived(new Set(db.mail_accounts.all.map((a) => a.address.toLowerCase())));
	/** Sender, or "To …" for our own messages (Sent). */
	const who = (t: MailThreadRow) =>
		mine.has(t.fromAddr.toLowerCase())
			? `To ${t.to.map((x) => x.name || x.address).join(', ') || '…'}`
			: t.fromName || t.fromAddr || '(unknown)';

	/** What the triage says, as a few words: "Reply · today", "too late" (nothing once we answered). */
	function marks(t: MailThreadRow) {
		if (!t.triage || !featureOn('triage')) return null;
		const s = summary(t.triage.answers, t.triage.facts, t.triage.at, { labels: t.triage.labels });
		const when = s.late ? 'too late' : s.due ? dueLabel(s.due) : '';
		return { s, text: t.triage.replied ? '' : [s.action, when].filter(Boolean).join(' · ') };
	}

	function onscroll(e: Event) {
		const el = e.currentTarget as HTMLElement;
		if (more && el.scrollTop + el.clientHeight > el.scrollHeight - 400) onmore();
	}
</script>

<div class="flex min-h-0 flex-1 flex-col overflow-y-auto px-1.5 py-1" {onscroll}>
	{#each threads as t, i (t.thread)}
		{@const group = dayGroup(t.date)}
		{@const later = db.mail_threads.items[t.thread]?.later}
		{@const waiting = db.mail_threads.items[t.thread]?.waiting}
		{@const proj = db.projects.items[projectOf(t) ?? '']}
		{@const tm = marks(t)}
		{#if i === 0 || dayGroup(threads[i - 1].date) !== group}
			<div class="px-2.5 pt-2.5 pb-1 text-[11.5px] font-medium text-muted-foreground">{group}</div>
		{/if}
		<a
			href={href(t.thread)}
			data-thread={t.thread}
			class="grid grid-cols-[10px_minmax(0,1fr)] gap-x-1.5 rounded-lg py-2 pr-2.5 pl-1.5 text-[13px] {selected ===
			t.thread
				? 'bg-muted'
				: 'hover:bg-muted/50'}"
		>
			<span class="mt-1.5 size-[7px] rounded-full {t.unread ? 'bg-foreground' : ''}"></span>
			<span class="flex min-w-0 flex-col gap-px">
				<span class="flex items-baseline gap-2">
					<span class="min-w-0 flex-1 truncate {t.unread ? 'font-semibold' : ''}">
						{who(t)}{#if t.count > 1}<span class="ml-1 font-normal text-muted-foreground"
								>{t.count}</span
							>{/if}
					</span>
					{#if showAccount}<AccountMark
							account={db.mail_accounts.items[t.account]}
							class="self-center"
						/>{/if}
					{#if waiting}<span
							class="flex items-center gap-1 text-[11.5px] text-muted-foreground tabular-nums"
							title="Waiting for an answer since then"
							><Hourglass class="size-3" />{shortDate(waiting)}</span
						>{:else if later && later > new Date().toISOString()}<span
							class="flex items-center gap-1 text-[11.5px] text-muted-foreground tabular-nums"
							title="Comes back then"><Clock class="size-3" />{shortDate(later)}</span
						>{:else}<span class="text-[11.5px] text-muted-foreground tabular-nums"
							>{shortDate(t.date)}</span
						>{/if}
				</span>
				<span class="flex items-center gap-1.5">
					<span class="min-w-0 flex-1 truncate">{t.subject || '(no subject)'}</span>
					{#if tm?.s.warn}<ShieldAlert
							class="size-[13px] shrink-0 text-foreground"
							aria-label="May be phishing"
						/>{/if}
					{#if tm && t.triage?.code}<button
							type="button"
							class="flex shrink-0 items-center gap-1 rounded border border-line2 px-1 font-mono text-[11px] leading-4 text-muted-foreground hover:bg-muted hover:text-foreground {codeExpired(
								t.date
							)
								? 'line-through'
								: ''}"
							title={codeExpired(t.date) ? 'Code (probably expired): copy' : 'Copy the code'}
							onclick={(e) => {
								e.preventDefault();
								e.stopPropagation();
								copyCode(t.triage!.code!);
							}}><KeyRound class="size-3" />{t.triage.code}</button
						>{:else if tm?.s.code}<KeyRound
							class="size-[13px] shrink-0 text-muted-foreground"
							aria-label="Contains a code"
						/>{/if}
					{#if tm && t.parcel}<span
							class="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground"
							title={t.parcel.status ?? 'DHL parcel'}
							><Package class="size-3" />{parcelLabel(t.parcel)}</span
						>{/if}
					{#if tm?.text}<span
							class="shrink-0 rounded border border-line2 px-1 text-[11px] leading-4 text-muted-foreground"
							title="Triage">{tm.text}</span
						>{/if}
					{#if t.flagged}<Flag
							class="size-[13px] text-muted-foreground"
							aria-label="Flagged"
						/>{/if}
					{#if t.invite}<CalendarIcon
							class="size-[13px] text-muted-foreground"
							aria-label="Invitation"
						/>{/if}
					{#if t.attach}<Paperclip
							class="size-[13px] text-muted-foreground"
							aria-label="Attachment"
						/>{/if}
					{#if hasItems(t.thread)}<SquareCheck
							class="size-[13px] text-muted-foreground"
							aria-label="Has a linked task, event or note"
						/>{/if}
					{#if proj}<span
							class="size-[7px] shrink-0 rounded-full"
							style:background={proj.color ?? 'var(--muted-foreground)'}
							title={proj.name}
						></span>{/if}
				</span>
				<span class="truncate text-muted-foreground"
					>{(tm && t.triage?.summary) || t.snippet || ' '}</span
				>
			</span>
		</a>
	{/each}
</div>
