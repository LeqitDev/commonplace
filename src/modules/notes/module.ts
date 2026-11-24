import { goto } from '$app/navigation';
import type { ClientModule } from '#lib/modules.ts';
import { create } from '#lib/data.svelte.ts';
import { ui } from '#lib/ui.svelte.ts';
import { openDailyNote } from './notes.ts';
import Templates from './Templates.svelte';
import FileText from '@lucide/svelte/icons/file-text';
import NotebookPen from '@lucide/svelte/icons/notebook-pen';
import ProjectNotes from './ProjectNotes.svelte';

export default {
	id: 'notes',
	nav: [{ href: '/notes', label: 'Notes', icon: NotebookPen, key: 'g n', order: 40 }],
	commands: [
		{ label: 'Go to Notes', run: () => goto('/notes') },
		{ label: "Open today's note", run: () => openDailyNote() }
	],
	create: [
		{
			label: 'New note',
			run: async (title) => {
				const n = await create('notes', { title, type: 'md', content: '', projectId: ui.project });
				goto(`/notes/${n.id}`);
			}
		}
	],
	search: { notes: 'Notes', files: 'Files' },
	keys: { 'g n': () => goto('/notes') },
	shortcuts: [
		['g n', 'Notes'],
		['Ctrl L', 'Note: insert link'],
		['Ctrl Shift ↑ · ↓', 'Note: move list item up · down'],
		['Tab · Shift Tab', 'Note: indent · outdent list item'],
		['Alt Shift ← · →', 'Note: new table column left · right']
	],
	settingsTabs: [
		{ id: 'templates', label: 'Templates', icon: FileText, component: Templates, order: 70 }
	],
	projectSections: [{ order: 10, column: 2, component: ProjectNotes }],
	services: { openDailyNote }
} satisfies ClientModule;
