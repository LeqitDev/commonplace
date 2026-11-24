<script lang="ts">
	// Single-choice shadcn Select with a native-<select>-like API ('' = "none").
	import * as Select from '#lib/components/ui/select/index.ts';
	import { cn } from '#lib/utils.ts';

	type Option = { value: string; label: string };
	let {
		value,
		options,
		onchange,
		placeholder = 'None',
		title,
		class: className
	}: {
		value: string | number | null | undefined;
		options: Option[];
		onchange: (v: string) => void;
		placeholder?: string;
		title?: string;
		class?: string;
	} = $props();

	// bits-ui treats '' as "nothing selected", so empty option values get a sentinel
	const NONE = '__none';
	const enc = (v: string | number | null | undefined) => (v === '' || v == null ? NONE : String(v));
	const items = $derived(options.map((o) => ({ ...o, value: enc(o.value) })));
	const selected = $derived(items.find((o) => o.value === enc(value)));
</script>

<Select.Root
	type="single"
	value={enc(value)}
	onValueChange={(v) => onchange(v === NONE ? '' : v)}
	{items}
>
	<Select.Trigger size="sm" class={cn('w-full', className)} {title}>
		<span class={cn('truncate', !selected && 'text-muted-foreground')}
			>{selected?.label ?? placeholder}</span
		>
	</Select.Trigger>
	<Select.Content>
		{#each items as o (o.value)}<Select.Item value={o.value} label={o.label} />{/each}
	</Select.Content>
</Select.Root>
