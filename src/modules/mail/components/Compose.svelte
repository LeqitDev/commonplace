<script lang="ts">
	// Compose panel (floating, like the task and event editors): From, To/Cc/Bcc, Subject, the body
	// in the notes' markdown editor, attachments from the notes tree or the computer, Track the
	// reply, Send (Ctrl Enter). Saved as you type; closing keeps the draft.
	import { untrack } from 'svelte';
	import FloatingPanel from '#lib/components/app/FloatingPanel.svelte';
	import AppSelect from '#lib/components/app/AppSelect.svelte';
	import MarkdownEditor from '#lib/components/editor/MarkdownEditor.svelte';
	import RecipientField from './RecipientField.svelte';
	import AccountMark from './AccountMark.svelte';
	import { Button } from '#lib/components/ui/button/index.ts';
	import { Switch } from '#lib/components/ui/switch/index.ts';
	import * as DropdownMenu from '#lib/components/ui/dropdown-menu/index.ts';
	import { db, upload } from '#lib/data.svelte.ts';
	import { ask } from '#lib/choice.svelte.ts';
	import { accounts, discardDraft, saveDraft, sendDraft } from '#modules/mail/mail.svelte.ts';
	import { pick, ui } from '#lib/ui.svelte.ts';
	import type { MailDraft } from '#lib/types.ts';
	import { toast } from 'svelte-sonner';
	import Paperclip from '@lucide/svelte/icons/paperclip';
	import Link from '@lucide/svelte/icons/link';
	import Trash from '@lucide/svelte/icons/trash-2';
	import X from '@lucide/svelte/icons/x';
	import Maximize from '@lucide/svelte/icons/maximize-2';
	import Minimize from '@lucide/svelte/icons/minimize-2';

	const d = $derived(ui.compose ? db.mail_drafts.items[ui.compose] : null);
	// the subject as it was when the draft opened (later saves must not reset what is being typed)
	const subject0 = $derived.by(() => {
		void ui.compose;
		return untrack(() => d?.subject ?? '');
	});
	let editor = $state<{ insertLink(text: string, href: string): void }>();
	let showCc = $state(false);
	let sending = $state(false);
	const stored = () => {
		try {
			return localStorage.composeFull === '1';
		} catch {
			return false;
		}
	};
	/** The panel fills the window (remembered). */
	let full = $state(stored());
	function toggleFull() {
		full = !full;
		try {
			localStorage.composeFull = full ? '1' : '';
		} catch {
			/* storage unavailable */
		}
	}
	let status = $state<'' | 'saving' | 'saved'>('');
	let pending: Partial<MailDraft> = {};
	let timer: ReturnType<typeof setTimeout> | undefined;

	$effect(() => {
		void ui.compose;
		showCc = !!(d?.cc?.length || d?.bcc?.length);
		status = '';
	});

	/** Typing is saved after a short pause; the rest at once. */
	function later(p: Partial<MailDraft>) {
		Object.assign(pending, p);
		status = 'saving';
		clearTimeout(timer);
		timer = setTimeout(flush, 600);
	}
	async function flush() {
		clearTimeout(timer);
		const id = ui.compose;
		const p = pending;
		pending = {};
		if (id && Object.keys(p).length) await saveDraft(id, p);
		status = 'saved';
	}
	async function now(p: Partial<MailDraft>) {
		if (!d) return;
		await saveDraft(d.id, p);
		status = 'saved';
	}

	async function close() {
		await flush();
		ui.compose = null;
	}
	async function send() {
		if (!d || sending) return;
		if (!d.to.length && !d.cc?.length && !d.bcc?.length) return void toast('Add a recipient first');
		sending = true;
		try {
			await flush();
			await sendDraft(d.id);
		} finally {
			sending = false;
		}
	}
	async function discard() {
		if (!d) return;
		clearTimeout(timer);
		pending = {};
		await discardDraft(d.id);
	}

	async function fromNotes() {
		const hit = await pick();
		if (hit.coll !== 'files') return void toast('Pick a file of the notes tree');
		if (d && !d.files?.includes(hit.id)) await now({ files: [...(d.files ?? []), hit.id] });
	}
	let input = $state<HTMLInputElement>();
	async function fromComputer(e: Event & { currentTarget: HTMLInputElement }) {
		const files = [...(e.currentTarget.files ?? [])];
		e.currentTarget.value = '';
		const ids = [];
		for (const f of files) ids.push((await upload(f, f.name)).split('/').pop()!);
		if (d) await now({ files: [...(d.files ?? []), ...ids] });
	}
	async function link() {
		const url = await ask('Insert link', { placeholder: 'https://…', label: 'Insert' });
		if (url) editor?.insertLink(url.replace(/^https?:\/\//, ''), url);
	}
	function onkeydown(e: KeyboardEvent) {
		const mod = e.ctrlKey || e.metaKey;
		if (mod && e.key === 'Enter') {
			e.preventDefault();
			e.stopPropagation();
			void send();
		} else if (mod && e.shiftKey && e.key.toLowerCase() === 'f') {
			e.preventDefault();
			e.stopPropagation();
			toggleFull();
		} else if (mod && e.key.toLowerCase() === 'l') {
			e.preventDefault();
			e.stopPropagation();
			void link();
		}
	}
	const title = $derived(d?.forward ? 'Forward' : d?.inReplyTo ? 'Reply' : 'New message');
	const fwdFiles = $derived.by(() => (d?.forward ? 'the attachments of the original' : ''));
</script>

{#if d}
	<FloatingPanel key="mail" label={title} width={560} {full} onclose={close}>
		<div class="flex min-h-0 flex-col {full ? 'flex-1' : ''}" onkeydowncapture={onkeydown}>
			<div class="flex items-center gap-2 pr-2 pb-1 pl-4">
				<span class="flex-1 text-[13px] font-semibold">{title}</span>
				<span class="text-[11.5px] text-muted-foreground">
					{#if d.queued}<span class="text-foreground">Waiting to be sent: {d.error}</span
						>{:else if status === 'saving'}Saving…{:else if status === 'saved'}Draft saved{/if}
				</span>
				<Button
					size="icon-sm"
					variant="ghost"
					title="{full ? 'Smaller' : 'Fill the window'} (Ctrl Shift F)"
					onclick={toggleFull}
					>{#if full}<Minimize />{:else}<Maximize />{/if}</Button
				>
				<Button size="icon-sm" variant="ghost" title="Discard draft" onclick={discard}
					><Trash /></Button
				>
				<Button
					size="icon-sm"
					variant="ghost"
					title="Close (Esc), the draft is kept"
					onclick={close}><X /></Button
				>
			</div>
			<div class="border-t"></div>
			<div
				class="flex h-9 shrink-0 items-center gap-2 border-b px-4 {full
					? 'mx-auto w-full max-w-[80ch]'
					: ''}"
			>
				<span class="w-12 shrink-0 text-muted-foreground">From</span>
				<AccountMark account={db.mail_accounts.items[d.account]} />
				<AppSelect
					class="h-7 flex-1 border-0 px-1 shadow-none"
					value={d.account}
					options={accounts().map((a) => ({ value: a.id, label: `${a.name} · ${a.address}` }))}
					onchange={(v) => v && now({ account: v })}
				/>
				{#if !showCc}<button
						class="text-xs text-muted-foreground hover:text-foreground"
						onclick={() => (showCc = true)}>Cc Bcc</button
					>{/if}
			</div>
			<div class="flex shrink-0 flex-col {full ? 'mx-auto w-full max-w-[80ch]' : ''}">
				<RecipientField
					label="To"
					value={d.to}
					onchange={(to) => now({ to })}
					autofocus={!d.to.length}
				/>
				{#if showCc}
					<RecipientField label="Cc" value={d.cc ?? []} onchange={(cc) => now({ cc })} />
					<RecipientField label="Bcc" value={d.bcc ?? []} onchange={(bcc) => now({ bcc })} />
				{/if}
				<input
					class="h-10 shrink-0 border-b bg-transparent px-4 text-[14px] font-medium outline-none"
					placeholder="Subject"
					aria-label="Subject"
					value={subject0}
					oninput={(e) => later({ subject: e.currentTarget.value })}
				/>
			</div>
			<div
				class="min-h-40 overflow-y-auto px-1 py-2 {full
					? 'mx-auto w-full max-w-[80ch] flex-1'
					: 'max-h-[45svh]'}"
			>
				{#key d.id}
					<MarkdownEditor
						bind:this={editor}
						compact
						value={d.body ?? ''}
						onchange={(body) => later({ body })}
					/>
				{/key}
				{#if d.quote}
					<details class="mx-3 mt-2 text-xs text-muted-foreground">
						<summary class="cursor-pointer select-none">Quoted text</summary>
						<pre
							class="mt-1 overflow-y-auto font-sans whitespace-pre-wrap {full
								? ''
								: 'max-h-40'}">{d.quote}</pre>
					</details>
				{/if}
			</div>
			{#if d.files?.length || fwdFiles}
				<div class="flex flex-wrap gap-1.5 px-4 pb-2 {full ? 'mx-auto w-full max-w-[80ch]' : ''}">
					{#each d.files ?? [] as id (id)}
						<span class="flex h-6 items-center gap-1 rounded-md border pr-1 pl-2 text-xs">
							<Paperclip class="size-3 text-muted-foreground" />{db.files.items[id]?.name ?? 'file'}
							<button
								class="grid size-4 place-items-center text-muted-foreground hover:text-foreground"
								aria-label="Remove attachment"
								onclick={() => now({ files: d.files!.filter((f) => f !== id) })}
								><X class="size-3" /></button
							>
						</span>
					{/each}
					{#if fwdFiles}<span class="flex h-6 items-center text-xs text-muted-foreground"
							>+ {fwdFiles}</span
						>{/if}
				</div>
			{/if}
			<div class="flex items-center gap-1 border-t py-2 pr-2 pl-3">
				<DropdownMenu.Root>
					<DropdownMenu.Trigger
						class="flex h-8 items-center gap-1.5 rounded-md px-2 text-muted-foreground hover:bg-muted hover:text-foreground"
						title="Attach"><Paperclip class="size-4" />Attach</DropdownMenu.Trigger
					>
					<DropdownMenu.Content align="start">
						<DropdownMenu.Item onSelect={fromNotes}>From the notes…</DropdownMenu.Item>
						<DropdownMenu.Item onSelect={() => input?.click()}
							>From this computer…</DropdownMenu.Item
						>
					</DropdownMenu.Content>
				</DropdownMenu.Root>
				<input bind:this={input} type="file" multiple hidden onchange={fromComputer} />
				<button
					class="flex h-8 items-center gap-1.5 rounded-md px-2 text-muted-foreground hover:bg-muted hover:text-foreground"
					title="Insert link (Ctrl L)"
					onclick={link}><Link class="size-4" />Link</button
				>
				<label class="ml-2 flex items-center gap-2 text-muted-foreground">
					<Switch checked={!!d.track} onCheckedChange={(v) => now({ track: v })} />
					Track the reply
				</label>
				<div class="flex-1"></div>
				<Button size="sm" disabled={sending} onclick={send}
					>Send <kbd class="rounded border border-current px-1 text-[10px] opacity-75"
						>Ctrl Enter</kbd
					></Button
				>
			</div>
		</div>
	</FloatingPanel>
{/if}
