<script lang="ts">
	// Sidebar footer: while a session is on, its time stays in sight with the panel closed.
	import { Button } from '#lib/components/ui/button/index.ts';
	import { ui } from '#lib/ui.svelte.ts';
	import { PHASES, active, clock, pomo, remaining, running, toggle } from './pomodoro.svelte.ts';
	import Play from '@lucide/svelte/icons/play';
	import Pause from '@lucide/svelte/icons/pause';
</script>

{#if active()}
	<div
		class="flex items-center gap-1 rounded-lg border bg-background py-0.5 pr-0.5 pl-2.5 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-0"
	>
		<button
			class="flex min-w-0 flex-1 items-baseline gap-2 text-left group-data-[collapsible=icon]:flex-none"
			title="Open pomodoro"
			onclick={() => (ui.pomodoro = true)}
		>
			<span
				class="truncate text-[11.5px] text-muted-foreground group-data-[collapsible=icon]:hidden"
				>{PHASES[pomo.phase]}</span
			>
			<span
				class="text-sm font-semibold tabular-nums group-data-[collapsible=icon]:text-[11px] {running()
					? ''
					: 'text-muted-foreground'}">{clock(remaining())}</span
			>
		</button>
		<Button
			size="icon-sm"
			variant="ghost"
			class="group-data-[collapsible=icon]:hidden"
			title={running() ? 'Pause (p)' : 'Start (p)'}
			onclick={toggle}
			>{#if running()}<Pause class="fill-current" />{:else}<Play
					class="fill-current"
				/>{/if}</Button
		>
	</div>
{/if}
