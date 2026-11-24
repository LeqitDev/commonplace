<script lang="ts">
	// Task panel: start a work session on this task.
	import { Button } from '#lib/components/ui/button/index.ts';
	import { pomo, reset, start } from './pomodoro.svelte.ts';
	import type { Task } from '#lib/types.ts';
	import Play from '@lucide/svelte/icons/play';

	let { task }: { task: Task } = $props();

	function focus() {
		reset('work');
		pomo.taskId = task.id;
		start();
	}
</script>

<Button variant="outline" onclick={focus}><Play class="size-3 fill-current" />Start focus</Button>
