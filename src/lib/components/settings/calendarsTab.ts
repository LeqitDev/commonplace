// Settings › Calendars: external calendars (calendar module) and the CalDAV account of events and
// tasks (both modules list it; the panel shows a tab once).
import type { SettingsTab } from '#lib/modules.ts';
import { dav, db } from '#lib/data.svelte.ts';
import CalendarIcon from '@lucide/svelte/icons/calendar';
import Calendars from './Calendars.svelte';

export const calendarsTab: SettingsTab = {
	id: 'calendars',
	label: 'Calendars',
	icon: CalendarIcon,
	component: Calendars,
	order: 20,
	warn: () =>
		(!!dav.error || db.feeds.all.some((f) => f.enabled !== false && f.error)) &&
		'A calendar has a sync error'
};
