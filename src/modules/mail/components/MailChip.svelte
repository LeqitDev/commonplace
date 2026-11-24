<script lang="ts">
	// The mail a task, event or note was made from: opens it in the mail page.
	import Mail from '@lucide/svelte/icons/mail';
	import X from '@lucide/svelte/icons/x';
	import type { MailLink } from '#lib/types.ts';

	let { link, onremove }: { link: MailLink; onremove?: () => void } = $props();
</script>

<span
	class="flex h-[26px] max-w-full items-center gap-1.5 self-start rounded-full border border-line2 pr-1 pl-2.5 text-xs"
>
	<Mail class="size-3.5 shrink-0 text-muted-foreground" />
	<a
		class="min-w-0 truncate hover:underline"
		href={`/mail?m=${encodeURIComponent(link.thread)}`}
		title="Open the mail{link.from ? ` from ${link.from}` : ''}"
		>{link.subject}{#if link.from}<span class="text-muted-foreground">{` · ${link.from}`}</span
			>{/if}</a
	>
	{#if onremove}
		<button
			class="grid size-5 place-items-center rounded-full text-muted-foreground hover:text-foreground"
			title="Remove the link to the mail"
			onclick={onremove}><X class="size-3" /></button
		>
	{:else}<span class="w-1"></span>{/if}
</span>
