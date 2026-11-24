import { goto } from '$app/navigation';
import type { ClientModule } from '#lib/modules.ts';
import { api } from '#lib/data.svelte.ts';
import EventEditor from './EventEditor.svelte';
import { calendarsTab } from '#lib/components/settings/calendarsTab.ts';
import CalendarIcon from '@lucide/svelte/icons/calendar';
import ProjectEvents from './ProjectEvents.svelte';

export default {
	id: 'calendar',
	nav: [{ href: '/calendar', label: 'Calendar', icon: CalendarIcon, key: 'g c', order: 10 }],
	commands: [
		{ label: 'Go to Calendar', run: () => goto('/calendar') },
		{ label: 'Sync external calendars', run: () => api('/api/feeds/sync', { method: 'POST' }) }
	],
	search: { events: 'Events', feed_event: 'External events' },
	keys: { 'g c': () => goto('/calendar') },
	shortcuts: [
		['g c', 'Calendar'],
		['t', 'Calendar: today'],
		['d · w · m', 'Calendar: day · week · month'],
		['j · k', 'Calendar: next · previous']
	],
	panels: [EventEditor],
	settingsTabs: [calendarsTab],
	projectSections: [{ order: 20, column: 2, component: ProjectEvents }]
} satisfies ClientModule;
