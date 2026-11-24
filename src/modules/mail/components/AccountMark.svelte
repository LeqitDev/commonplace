<script lang="ts">
	// Square letter marking a mail account: outlined, solid or grey (round dots are for projects).
	import { markerLetter } from '#modules/mail/mail.ts';
	import { cn } from '#lib/utils.ts';
	import type { MailAccount } from '#lib/types.ts';

	let {
		account,
		class: className
	}: {
		account: Pick<MailAccount, 'letter' | 'name' | 'address' | 'marker'> | undefined;
		class?: string;
	} = $props();
	const style = $derived(
		{
			outline: 'border border-muted-foreground text-foreground',
			solid: 'bg-foreground text-background',
			grey: 'bg-(--line2) text-foreground'
		}[account?.marker ?? 'outline']
	);
</script>

<span
	role="img"
	aria-label={account?.name}
	title={account?.name}
	class={cn(
		'inline-flex size-4 shrink-0 items-center justify-center rounded-[4px] text-[10px] leading-none font-semibold',
		style,
		className
	)}>{account ? markerLetter(account) : '?'}</span
>
