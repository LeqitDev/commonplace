// The optional parts of the planner. Metadata only (no imports): read by vite.config.ts (which
// modules are built, which route dirs are stubbed), the server and the client.
//
// Two levels: a module is *built* (the MODULES build arg, `__MODULES__`) and *on* (built, not
// switched off in Settings › General, and everything it requires is on). Data of a module that is
// off stays where it is.
import type { Settings } from '../lib/types.ts';

interface ModuleMeta {
	label: string;
	hint: string;
	/** Its page; the app opens on the first page that is on. */
	href?: string;
	/** Modules it can't work without (canvas and decks are notes). */
	requires?: readonly string[];
	/** Route dirs under src/routes that belong to it: replaced by 404 stubs when it isn't built. */
	routes?: readonly string[];
}

export const MODULES = {
	calendar: {
		label: 'Calendar',
		hint: 'Calendar page, events, external calendars',
		href: '/calendar',
		routes: ['(app)/calendar', 'api/feeds']
	},
	tasks: {
		label: 'Tasks',
		hint: 'Tasks page and tasks in the calendar',
		href: '/tasks',
		routes: ['(app)/tasks']
	},
	mail: {
		label: 'Mail',
		hint: 'Mail page and syncing the accounts',
		href: '/mail',
		routes: ['(app)/mail', 'api/mail']
	},
	triage: {
		label: 'Mail triage',
		hint: 'Sorting mail with a local model on this computer',
		requires: ['mail'],
		routes: ['api/mail/triage']
	},
	notes: {
		label: 'Notes',
		hint: 'Notes tree, markdown notes, files',
		href: '/notes',
		routes: ['(app)/notes', 'embed/note']
	},
	cards: {
		label: 'Flashcards',
		hint: 'Review page and flashcard decks',
		href: '/review',
		requires: ['notes'],
		routes: ['(app)/review']
	},
	canvas: { label: 'Canvas', hint: 'Drawing notes (Excalidraw)', requires: ['notes'] },
	pomodoro: { label: 'Pomodoro', hint: 'Focus timer' }
} as const satisfies Record<string, ModuleMeta>;

export type ModuleId = keyof typeof MODULES;
export const MODULE_IDS = Object.keys(MODULES) as ModuleId[];
const meta = (id: ModuleId): ModuleMeta => MODULES[id];
/** The modules it can't work without. */
export const requires = (id: ModuleId) => (meta(id).requires ?? []) as readonly ModuleId[];
/** Its route dirs under src/routes. */
export const routesOf = (id: ModuleId) => meta(id).routes ?? [];

/** Modules in this build (in registry order). */
export const BUILT: readonly ModuleId[] =
	typeof __MODULES__ === 'undefined' ? MODULE_IDS : (__MODULES__ as ModuleId[]);
export const built = (id: ModuleId) => BUILT.includes(id);

/** Missing = on, so settings from before have everything. Only the switch itself. */
export const isOn = (s: Pick<Settings, 'features'> | null | undefined, id: ModuleId) =>
	s?.features?.[id] !== false;

/** Built, switched on, and everything it requires is on. */
export const on = (s: Pick<Settings, 'features'> | null | undefined, id: ModuleId): boolean =>
	built(id) && isOn(s, id) && requires(id).every((r) => on(s, r));

const pages = MODULE_IDS.filter((id) => meta(id).href).map((id) => ({
	id,
	href: meta(id).href as string
}));

/** The page the app opens on: the first one that is on (stats is always there). */
export const homePage = (s: Pick<Settings, 'features'> | null | undefined) =>
	pages.find((p) => on(s, p.id))?.href ?? '/stats';

/** The module a page belongs to. */
export const moduleOfPath = (path: string) =>
	pages.find((p) => path === p.href || path.startsWith(`${p.href}/`))?.id ?? null;

/**
 * Parse a MODULES value (`all`, or a comma list) for the build. Throws when a module is unknown
 * or one it requires is missing.
 */
export function resolveModules(value: string | undefined): ModuleId[] {
	const v = (value ?? 'all').trim();
	if (!v || v === 'all') return MODULE_IDS;
	const want = v
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean);
	for (const id of want)
		if (!(id in MODULES))
			throw new Error(`MODULES: unknown module "${id}" (known: ${MODULE_IDS.join(', ')})`);
	for (const id of want as ModuleId[])
		for (const r of requires(id))
			if (!want.includes(r)) throw new Error(`MODULES: "${id}" needs "${r}"`);
	return MODULE_IDS.filter((id) => want.includes(id));
}
