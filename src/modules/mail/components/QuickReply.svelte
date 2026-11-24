<script lang="ts">
	// Quick reply under a conversation: a plain textarea on the reply draft (the original is quoted
	// below it when sending). "Open in editor" moves the same draft into the compose panel.
	import { untrack } from 'svelte';
	import { Switch } from '#lib/components/ui/switch/index.ts';
	import { Button } from '#lib/components/ui/button/index.ts';
	import { db } from '#lib/data.svelte.ts';
	import {
		accounts,
		replyOf,
		saveDraft,
		sendDraft,
		startReply
	} from '#modules/mail/mail.svelte.ts';
	import { ui } from '#lib/ui.svelte.ts';
	import type { MailDraft, MailMessage } from '#lib/types.ts';
	import AccountMark from './AccountMark.svelte';
	import AppSelect from '#lib/components/app/AppSelect.svelte';
	import Maximize from '@lucide/svelte/icons/maximize-2';

	let { thread, messages }: { thread: string; messages: MailMessage[] } = $props();
	const d = $derived(replyOf(thread));
	let area = $state<HTMLTextAreaElement>();
	let text = $state('');
	let sending = $state(false);
	let timer: ReturnType<typeof setTimeout> | undefined;

	// the draft's text when the conversation opens (and when it comes back from the panel)
	$effect(() => {
		void thread; // only when the conversation opens: a draft created while typing must not reset it
		untrack(() => (text = d?.body ?? ''));
	});

	export const focus = () => area?.focus();

	async function draft(): Promise<MailDraft> {
		return d ?? (await startReply('reply', messages, thread, true));
	}
	function oninput() {
		clearTimeout(timer);
		timer = setTimeout(async () => saveDraft((await draft()).id, { body: text }), 500);
	}
	async function set(p: Partial<MailDraft>) {
		await saveDraft((await draft()).id, p);
	}
	async function send() {
		if (!text.trim() || sending) return;
		sending = true;
		try {
			clearTimeout(timer);
			const x = await draft();
			await saveDraft(x.id, { body: text });
			if (await sendDraft(x.id)) text = '';
		} finally {
			sending = false;
		}
	}
	async function expand() {
		clearTimeout(timer);
		const x = await draft();
		await saveDraft(x.id, { body: text, quick: false });
		ui.compose = x.id;
		text = '';
	}
	const last = $derived(
		messages.findLast((m) => !db.mail_accounts.all.some((a) => a.address === m.fromAddr))
	);
	const name = $derived((last?.fromName || last?.fromAddr || '').split(/\s/)[0]);
</script>

{#if !d || d.quick}
	<div
		class="flex flex-col rounded-xl border border-line2"
		onkeydowncapture={(e) => {
			// capture: a focused switch or button would take the Enter as a click first
			if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
				e.preventDefault();
				e.stopPropagation();
				void send();
			}
		}}
	>
		<textarea
			bind:this={area}
			bind:value={text}
			{oninput}
			aria-label="Reply"
			placeholder={name ? `Reply to ${name}…` : 'Reply…'}
			class="min-h-16 resize-none bg-transparent px-3.5 py-3 text-[14px] outline-none"
			rows={Math.min(12, Math.max(2, text.split('\n').length))}></textarea>
		<div class="flex flex-wrap items-center gap-2 py-2 pr-2 pl-3.5">
			<Switch
				checked={!!d?.track}
				onCheckedChange={(v) => set({ track: v })}
				aria-label="Track the reply"
			/>
			<span class="flex-1 text-muted-foreground">Track the reply</span>
			{#if accounts().length > 1}
				<span class="flex items-center gap-1.5 text-muted-foreground">
					From <AccountMark
						account={db.mail_accounts.items[d?.account ?? messages.at(-1)!.account]}
					/>
					<AppSelect
						class="h-8 w-28 border-0 px-1 shadow-none"
						value={d?.account ?? messages.at(-1)!.account}
						options={accounts().map((a) => ({ value: a.id, label: a.name }))}
						onchange={(v) => v && set({ account: v })}
					/>
				</span>
			{/if}
			<Button size="icon-sm" variant="ghost" title="Open in the editor" onclick={expand}
				><Maximize /></Button
			>
			<Button size="sm" disabled={sending || !text.trim()} onclick={send}
				>Send <kbd class="rounded border border-current px-1 text-[10px] opacity-75">Ctrl Enter</kbd
				></Button
			>
		</div>
	</div>
{:else}
	<button
		class="rounded-xl border border-dashed px-3.5 py-3 text-left text-muted-foreground hover:text-foreground"
		onclick={() => (ui.compose = d.id)}
		>Your reply is open in the editor{d.queued ? ' (waiting to be sent)' : ''}.</button
	>
{/if}
