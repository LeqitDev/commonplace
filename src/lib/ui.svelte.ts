// Global UI state (focused project, focus mode, palette, open editors).
import { db } from './data.svelte.ts';
import type { CalEvent, SearchHit } from './types.ts';

const stored = (k: string) => {
	try {
		return localStorage.getItem(k);
	} catch {
		return null;
	}
};

export const ui = $state({
	project: stored('project') as string | null, // global project filter
	focus: false, // distraction-free mode
	palette: false,
	/** When set, the palette picks an item instead of navigating. */
	pick: null as null | ((hit: SearchHit) => void),
	task: null as string | null, // id of task open in the editor sheet
	/** Event editor: the event, the occurrence that was clicked (ISO start) and, if that belongs
	 *  to one of its further times, the index in `CalEvent.times`. */
	event: null as { id: string; occurrence?: string; time?: number } | null,
	/** New event being edited; only stored once the user presses "Create". */
	draft: null as Partial<CalEvent> | null,
	/** A mail waiting for "Pick a slot in the calendar…": the next drag-select there sets its later time. */
	slotFor: null as import('./types.ts').MailThreadRow | null,
	/** Draft open in the compose panel. */
	compose: null as string | null,
	/** Tab open in the floating settings panel. */
	settings: null as SettingsTab | null,
	/** The floating pomodoro panel is open. */
	pomodoro: false,
	/** The keyboard shortcut help is open. */
	help: false,
	/** The pane beside the calendar (the tasks module's `calendarAside`) is shown. */
	calPane: stored('calPane') !== 'hide',
	calendarDate: null as string | null // jump target for the calendar
});

/** Id of a settings tab: 'general', 'categories' or one a module adds (`ClientModule.settingsTabs`). */
export type SettingsTab = string;

/** Opens the floating settings panel over the current page (one panel at a time). */
export function openSettings(tab: SettingsTab = 'general') {
	ui.task = null;
	ui.event = null;
	ui.settings = tab;
}

export function setCalPane(on: boolean) {
	ui.calPane = on;
	try {
		localStorage.setItem('calPane', on ? 'show' : 'hide');
	} catch {
		/* storage unavailable */
	}
}

export function setProject(id: string | null) {
	ui.project = id;
	try {
		if (id) localStorage.setItem('project', id);
		else localStorage.removeItem('project');
	} catch {
		/* storage unavailable */
	}
}

/** True if a doc belongs to the focused project. With no project focused everything does, except
 *  what belongs to an archived project (that shows only while the project is focused). */
export const inFocus = (d: { projectId?: string | null }) =>
	ui.project
		? d.projectId === ui.project
		: !(d.projectId && db.projects.items[d.projectId]?.archived);

export async function toggleFocus(on = !ui.focus) {
	ui.focus = on;
	if (!document.documentElement.requestFullscreen) return; // iPhone, old iPads: no fullscreen
	try {
		if (on && !document.fullscreenElement) await document.documentElement.requestFullscreen();
		if (!on && document.fullscreenElement) await document.exitFullscreen();
	} catch {
		/* fullscreen not allowed */
	}
}

export function pick(): Promise<SearchHit> {
	return new Promise((resolve) => {
		ui.pick = (hit) => resolve(hit);
		ui.palette = true;
	});
}

/** Internal URL for any searchable/linkable doc. */
export function hrefFor(coll: string, id: string) {
	switch (coll) {
		case 'notes':
			return `/notes/${id}`;
		case 'tasks':
			return `/tasks?open=${id}`;
		case 'events':
			return `/calendar?event=${id}`;
		case 'feed_event':
			return `/calendar?feed_event=${encodeURIComponent(id)}`;
		case 'projects':
			return `/projects/${id}`;
		case 'files':
			return `/notes/file/${id}`;
		case 'mail':
			return `/mail?m=${id}`;
		default:
			return `/settings`;
	}
}
