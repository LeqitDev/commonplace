<script lang="ts">
	// Pomodoro timer in a floating panel: opened from "More" in the sidebar, the footer chip (while a
	// session runs) or the palette. `p` starts/pauses it from anywhere.
	import { PHASES, clock, pomo, remaining, running, toggle, reset } from './pomodoro.svelte.ts';
	import { db } from '#lib/data.svelte.ts';
	import { isOpen } from '#lib/tasks.ts';
	import { openSettings, ui } from '#lib/ui.svelte.ts';
	import FloatingPanel from '#lib/components/app/FloatingPanel.svelte';
	import AppSelect from '#lib/components/app/AppSelect.svelte';
	import { Button } from '#lib/components/ui/button/index.ts';
	import Play from '@lucide/svelte/icons/play';
	import Pause from '@lucide/svelte/icons/pause';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
	import Settings from '@lucide/svelte/icons/settings';
	import X from '@lucide/svelte/icons/x';

	const openTasks = $derived(db.tasks.all.filter(isOpen));
	const close = () => (ui.pomodoro = false);
</script>

{#if ui.pomodoro}
	<FloatingPanel key="pomodoro" label="Pomodoro" width={300} onclose={close}>
		<div class="flex flex-col gap-3 px-5 pb-4">
			<div class="flex items-center gap-1">
				<span class="flex-1 text-[11.5px] font-medium text-muted-foreground"
					>{PHASES[pomo.phase]}</span
				>
				<Button
					size="icon-sm"
					variant="ghost"
					title="Pomodoro settings"
					onclick={() => openSettings('pomodoro')}><Settings /></Button
				>
				<Button size="icon-sm" variant="ghost" title="Close (Esc)" onclick={close}><X /></Button>
			</div>
			<div class="flex items-center gap-2">
				<div class="grow text-4xl font-semibold tracking-tight tabular-nums">
					{clock(remaining())}
				</div>
				<button
					class="grid size-9 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
					aria-label="Reset timer"
					title="Reset"
					onclick={() => reset('work')}><RotateCcw class="size-4" /></button
				>
				<button
					class="grid size-10 place-items-center rounded-full bg-primary text-primary-foreground hover:bg-primary/85"
					aria-label={running() ? 'Pause timer' : 'Start timer'}
					title="Start/pause (p)"
					onclick={toggle}
				>
					{#if running()}<Pause class="size-4 fill-current" />{:else}<Play
							class="size-4 fill-current"
						/>{/if}
				</button>
			</div>
			<AppSelect
				class="h-8 rounded-md border-0 bg-muted px-2 text-xs text-muted-foreground shadow-none dark:bg-muted"
				value={pomo.taskId}
				placeholder="No task"
				options={[
					{ value: '', label: 'No task' },
					...openTasks.map((t) => ({ value: t.id, label: t.title }))
				]}
				onchange={(v) => (pomo.taskId = v || null)}
				title="Track time for task"
			/>
		</div>
	</FloatingPanel>
{/if}
