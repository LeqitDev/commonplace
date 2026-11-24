import type { ClientModule } from '#lib/modules.ts';
import { ui } from '#lib/ui.svelte.ts';
import { toggle } from './pomodoro.svelte.ts';
import Pomodoro from './Pomodoro.svelte';
import Settings from './Settings.svelte';
import Timer from '@lucide/svelte/icons/timer';
import PomodoroChip from './PomodoroChip.svelte';
import TaskFocus from './TaskFocus.svelte';

export default {
	id: 'pomodoro',
	more: [
		{
			label: 'Pomodoro',
			icon: Timer,
			title: 'Pomodoro (p starts/pauses)',
			active: () => ui.pomodoro,
			run: () => (ui.pomodoro = !ui.pomodoro)
		}
	],
	footer: [PomodoroChip],
	commands: [
		{ label: 'Open pomodoro', run: () => (ui.pomodoro = true) },
		{ label: 'Start / pause pomodoro', run: toggle }
	],
	keys: { p: toggle },
	shortcuts: [['p', 'Start / pause pomodoro']],
	panels: [Pomodoro],
	settingsTabs: [
		{ id: 'pomodoro', label: 'Pomodoro', icon: Timer, component: Settings, order: 50 }
	],
	taskActions: [TaskFocus]
} satisfies ClientModule;
