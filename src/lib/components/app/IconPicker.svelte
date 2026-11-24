<script lang="ts">
	// Icon button + popover with a searchable grid of all lucide icons.
	import * as Popover from '#lib/components/ui/popover/index.ts';
	import { Input } from '#lib/components/ui/input/index.ts';
	import { Icon } from '@lucide/svelte';
	import ProjectIcon from './ProjectIcon.svelte';
	import { icons, searchIcons } from '#lib/icons.svelte.ts';
	import { cn } from '#lib/utils.ts';

	let {
		value,
		color,
		onchange,
		class: className
	}: {
		value?: string | null;
		color?: string | null;
		onchange: (icon: string | null) => void;
		class?: string;
	} = $props();

	let open = $state(false);
	let q = $state('');
	const set = $derived(icons());
	const hits = $derived(set ? searchIcons(q) : []);

	function pick(n: string | null) {
		onchange(n);
		open = false;
	}
</script>

<Popover.Root bind:open>
	<Popover.Trigger
		class={cn('grid size-8 shrink-0 place-items-center rounded-md hover:bg-accent', className)}
		title="Icon"
		aria-label="Icon"
	>
		<ProjectIcon icon={value} {color} class="size-5" />
	</Popover.Trigger>
	<Popover.Content class="w-80 p-2" align="start">
		<Input class="mb-2 h-7 text-xs" placeholder="Search icons…" bind:value={q} autofocus />
		<div class="grid max-h-64 grid-cols-8 gap-1 overflow-y-auto">
			<button
				class="grid size-8 place-items-center rounded-md text-[10px] text-muted-foreground hover:bg-accent"
				title="Default"
				onclick={() => pick(null)}>none</button
			>
			{#each hits as n (n)}
				<button
					class={cn(
						'grid size-8 place-items-center rounded-md hover:bg-accent',
						n === value && 'bg-accent ring-1 ring-ring'
					)}
					title={n}
					aria-label={n}
					onclick={() => pick(n)}
				>
					<Icon iconNode={set![n]} class="size-4" />
				</button>
			{/each}
		</div>
		{#if !set}<p class="p-2 text-xs text-muted-foreground">Loading…</p>{/if}
	</Popover.Content>
</Popover.Root>
