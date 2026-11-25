<script lang="ts">
	// Sidebar footer: while a session is on, its time stays in sight (quietly) with the panel closed.
	import { ui } from '#lib/ui.svelte.ts';
	import { PHASES, active, clock, pomo, remaining, running } from './pomodoro.svelte.ts';
	import Timer from '@lucide/svelte/icons/timer';
</script>

{#if active()}
	<button
		class="flex h-7 min-w-0 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground tabular-nums group-data-[collapsible=icon]:px-1 group-data-[collapsible=icon]:text-[10px] hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
		title="{PHASES[pomo.phase]}{running() ? '' : ' (paused)'}: open pomodoro (p starts/pauses)"
		onclick={() => (ui.pomodoro = true)}
	>
		<Timer class="size-3.5 shrink-0 group-data-[collapsible=icon]:hidden" />
		<span class={running() ? 'text-foreground' : ''}>{clock(remaining())}</span>
	</button>
{/if}
