<script lang="ts">
	// A row of a settings card that opens (one calendar / mail account at a time) with an on/off
	// switch beside its header. `head` fills the header button, `children` the opened part.
	import type { Snippet } from 'svelte';
	import { Switch } from '#lib/components/ui/switch/index.ts';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';

	let {
		label,
		open,
		ontoggle,
		enabled,
		onenabled,
		head,
		children,
		...rest
	}: {
		label: string;
		open: boolean;
		ontoggle: () => void;
		enabled: boolean;
		onenabled: (v: boolean) => void;
		head: Snippet;
		children: Snippet;
		[k: `data-${string}`]: string;
	} = $props();
</script>

<div class="border-t first:border-t-0" {...rest}>
	<div class="flex items-center gap-2.5 pr-3.5 pl-1.5">
		<button
			aria-expanded={open}
			onclick={ontoggle}
			class="flex h-13 min-w-0 flex-1 items-center gap-2.5 rounded-lg pr-1 pl-2 text-left"
		>
			<ChevronRight
				class="size-4 shrink-0 text-muted-foreground transition-transform {open ? 'rotate-90' : ''}"
			/>
			{@render head()}
		</button>
		<Switch checked={enabled} onCheckedChange={onenabled} aria-label="{label} enabled" />
	</div>
	{#if open}
		<div class="flex flex-col gap-3 px-4 pt-0.5 pb-3.5">
			{@render children()}
		</div>
	{/if}
</div>
