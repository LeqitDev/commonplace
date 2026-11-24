// What a module plugs into on the client: src/modules/<id>/module.ts does
// `export default { … } satisfies ClientModule`. Types only (the manifests import this file, and
// `slots.svelte.ts` imports the manifests).
//
// Rule of thumb: data and data formats are core (collections, types.ts, tasks.ts recurrence,
// canvas.ts text, CalDAV); a module owns its UI, routes, background work and heavy dependencies.
// A module never imports another one: it reaches it through `service()` or a slot.
import type { Component } from 'svelte';
import type { EventInput } from 'fullcalendar';
import type { ModuleId } from '#modules/registry.ts';
import type { CalEvent, MailLink, Note, Project, Task } from './types.ts';

export interface NavItem {
	href: string;
	label: string;
	icon: Component;
	/** Shortcut shown in the tooltip (bound through `keys`). */
	key?: string;
	/** Position in the sidebar (core: settings = 90). */
	order: number;
	/** A count beside the entry. */
	badge?: () => number;
	/** Drawn inside the entry's `Sidebar.MenuItem` (menu action, sub-list). */
	extra?: Component;
}

export interface MoreItem {
	label: string;
	icon: Component;
	title?: string;
	active?: () => boolean;
	run: () => void;
}

export interface Command {
	label: string;
	run: () => unknown;
}

export interface SettingsTab {
	id: string;
	label: string;
	icon: Component;
	component: Component;
	/** Position among the tabs (core: general 0, categories 10). */
	order: number;
	/** A sync error to flag on the tab. */
	warn?: () => string | false;
}

export interface ProjectSection {
	order: number;
	/** 'wide' = above the two columns. */
	column: 1 | 2 | 'wide';
	component: Component<{ project: Project }>;
}

export interface NoteType {
	type: Exclude<Note['type'], 'md' | undefined>;
	/** In "new" menus ("Canvas", "Flashcard deck"). */
	label: string;
	icon: Component;
	editor: Component<{ note: Note }>;
	/** Offered as a conversion of a markdown note: the patch that turns it into this type. */
	fromMarkdown?: (note: Note) => Promise<Partial<Note>>;
}

/** Entries a module adds to the calendar (besides events, feeds and tasks, which it draws itself). */
export interface CalendarSource {
	/** `extendedProps.kind` of its entries. */
	kind: string;
	/** Reactive: read inside the calendar's refetch effect. */
	entries: () => EventInput[];
	/** Inline SVG markup for the entry's mark (class `ev-flag`). */
	mark?: string;
	move?: (id: string, start: Date, end: Date | null) => unknown;
	open?: (id: string) => unknown;
	/** Gets a drag-select before it becomes a new event; true = taken. */
	select?: (start: Date, end: Date) => boolean;
	/** Shown under the calendar header. */
	banner?: Component;
}

/** Item with an optional mail link (tasks, events, notes). */
export type Linked = (Task | CalEvent | Note) & { mail?: MailLink | null };

/** Functions one module offers the others (missing while the offering module is off). */
export interface Services {
	openDailyNote(date?: Date): unknown;
}

export interface ClientModule {
	id: ModuleId;
	nav?: NavItem[];
	/** Entries under the sidebar's "More". */
	more?: MoreItem[];
	/** Drawn in the sidebar footer above the buttons. */
	footer?: Component[];
	commands?: Command[];
	/** "Create" entries of the palette, made from what was typed. */
	create?: { label: string; run: (title: string) => unknown }[];
	/** Palette groups for search hits of these collections (coll → label). */
	search?: Record<string, string>;
	/** Global shortcuts (`bindKeys`). */
	keys?: Record<string, () => unknown>;
	/** Rows of the shortcut help. */
	shortcuts?: [string, string][];
	/** Mounted once in the app layout (floating panels). */
	panels?: Component[];
	/** Runs once the data is loaded, while the module is on; returns its cleanup. */
	start?: () => (() => void) | void;
	settingsTabs?: SettingsTab[];
	projectSections?: ProjectSection[];
	/** Beside the title of a task, event or note (the mail it came from). */
	itemBadges?: Component<{ item: Linked; onremove?: () => void }>[];
	/** In the task panel (start a pomodoro on it). */
	taskActions?: Component<{ task: Task }>[];
	noteTypes?: NoteType[];
	calendarSources?: CalendarSource[];
	/** Right of the calendar grid (the tasks pane); `onpanel` hands over the element that tasks are
	 *  dragged from and dropped back on. */
	calendarAside?: Component<{
		unscheduling: boolean;
		onpanel: (el: HTMLElement | undefined) => void;
	}>[];
	services?: Partial<Services>;
}
