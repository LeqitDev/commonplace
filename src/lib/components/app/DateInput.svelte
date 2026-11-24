<script lang="ts">
	// Date (calendar popover) + optional 24h time field, bound to an ISO value
	// ('YYYY-MM-DD' when dateOnly, UTC ISO otherwise).
	import * as Popover from '#lib/components/ui/popover/index.ts';
	import { Calendar } from '#lib/components/ui/calendar/index.ts';
	import { Button } from '#lib/components/ui/button/index.ts';
	import { TimeField } from 'bits-ui';
	import { CalendarDate, Time, type DateValue } from '@internationalized/date';
	import { format } from 'date-fns';
	import { settings } from '#lib/data.svelte.ts';
	import { parseDate } from '#lib/tasks.ts';
	import CalendarIcon from '@lucide/svelte/icons/calendar';

	let {
		value,
		dateOnly = false,
		onchange
	}: { value?: string | null; dateOnly?: boolean; onchange: (v: string | null) => void } = $props();

	let open = $state(false);
	let typed: Time | undefined;
	const d = $derived(value ? parseDate(dateOnly ? value.slice(0, 10) : value) : null);
	const day = $derived(
		d ? new CalendarDate(d.getFullYear(), d.getMonth() + 1, d.getDate()) : undefined
	);
	const time = $derived(d ? new Time(d.getHours(), d.getMinutes()) : undefined);

	function emit(nd: Pick<DateValue, 'year' | 'month' | 'day'> | undefined, nt = time) {
		if (!nd) return onchange(null);
		const date = new CalendarDate(nd.year, nd.month, nd.day);
		if (dateOnly) return onchange(date.toString());
		const t = nt ?? new Time(9, 0);
		onchange(new Date(nd.year, nd.month - 1, nd.day, t.hour, t.minute).toISOString());
	}
</script>

<div class="flex min-w-0 items-center gap-1.5">
	<Popover.Root bind:open>
		<Popover.Trigger>
			{#snippet child({ props })}
				<Button
					{...props}
					variant="outline"
					size="sm"
					class="min-w-0 flex-1 justify-start font-normal {d ? '' : 'text-muted-foreground'}"
				>
					<CalendarIcon />
					<span class="truncate">{d ? format(d, 'EEE d MMM yyyy') : 'No date'}</span>
				</Button>
			{/snippet}
		</Popover.Trigger>
		<Popover.Content class="w-auto p-0" align="start">
			<Calendar
				type="single"
				value={day}
				weekStartsOn={settings().firstDay as 0 | 1 | 6}
				onValueChange={(v) => {
					if (v) emit(v);
					open = false;
				}}
			/>
			{#if value}
				<div class="border-t p-1">
					<Button
						size="xs"
						variant="ghost"
						class="w-full"
						onclick={() => {
							onchange(null);
							open = false;
						}}>Clear</Button
					>
				</div>
			{/if}
		</Popover.Content>
	</Popover.Root>
	{#if !dateOnly && day}
		<!-- saved when focus leaves the field: saving per keystroke would reset the typing -->
		<TimeField.Root
			value={time}
			hourCycle={24}
			granularity="minute"
			onValueChange={(t) => (typed = t as Time | undefined)}
		>
			<TimeField.Input
				class="flex h-8 shrink-0 items-center rounded-md border border-input px-2 text-sm tabular-nums shadow-xs dark:bg-input/30"
				onfocusout={(e) => {
					if (e.currentTarget.contains(e.relatedTarget as Node)) return;
					if (typed && time && typed.compare(time) !== 0) emit(day, typed);
					typed = undefined;
				}}
				onkeydown={(e) => e.key === 'Enter' && (e.target as HTMLElement).blur()}
			>
				{#snippet children({ segments })}
					{#each segments as { part, value: v }, i (i)}
						<TimeField.Segment
							{part}
							class="rounded-sm px-0.5 outline-none focus:bg-accent data-placeholder:text-muted-foreground"
							>{v}</TimeField.Segment
						>
					{/each}
				{/snippet}
			</TimeField.Input>
		</TimeField.Root>
	{/if}
</div>
