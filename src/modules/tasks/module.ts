import { goto } from '$app/navigation';
import type { ClientModule } from '#lib/modules.ts';
import { create, db } from '#lib/data.svelte.ts';
import { inFocus, ui } from '#lib/ui.svelte.ts';
import { isInbox } from '#lib/tasks.ts';
import TaskEditor from './TaskEditor.svelte';
import { calendarsTab } from '#lib/components/settings/calendarsTab.ts';
import ListTodo from '@lucide/svelte/icons/list-todo';
import CalendarPane from './CalendarPane.svelte';
import ProjectTasks from './ProjectTasks.svelte';

export default {
	id: 'tasks',
	nav: [
		{
			href: '/tasks',
			label: 'Tasks',
			icon: ListTodo,
			key: 'g t',
			order: 20,
			badge: () => db.tasks.all.filter((t) => isInbox(t) && inFocus(t)).length
		}
	],
	commands: [{ label: 'Go to Tasks', run: () => goto('/tasks') }],
	create: [
		{
			label: 'New task',
			run: async (title) => {
				const t = await create('tasks', { title, projectId: ui.project });
				ui.task = t.id;
			}
		}
	],
	search: { tasks: 'Tasks' },
	keys: { 'g t': () => goto('/tasks') },
	shortcuts: [['g t', 'Tasks']],
	panels: [TaskEditor],
	// the tasks' CalDAV account is set up there too
	settingsTabs: [calendarsTab],
	projectSections: [{ order: 10, column: 1, component: ProjectTasks }],
	calendarAside: [CalendarPane]
} satisfies ClientModule;
