import { tinykeys } from 'tinykeys';

const typing = (e: KeyboardEvent) => {
	const t = e.target as HTMLElement | null;
	return (
		!!t &&
		(t.isContentEditable ||
			/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) ||
			!!t.closest('.excalidraw'))
	);
};

/** Bind shortcuts that are ignored while typing in a field/editor. Returns an unsubscribe fn. */
export function bindKeys(map: Record<string, () => unknown>, opts: { always?: string[] } = {}) {
	const wrapped = Object.fromEntries(
		Object.entries(map).map(([k, fn]) => [
			k,
			(e: KeyboardEvent) => {
				if (!opts.always?.includes(k) && typing(e)) return;
				// Escape with the focus in a panel closes that panel
				if (k === 'Escape' && (e.target as Element | null)?.closest?.('[role=dialog]')) return;
				e.preventDefault();
				fn();
			}
		])
	);
	// tinykeys itself drops everything typed in a field; `typing` above decides that per shortcut
	return tinykeys(window, wrapped, { ignore: (e) => e.repeat || e.isComposing });
}

/** Core rows of the shortcut help; modules add theirs (`ClientModule.shortcuts`). */
export const SHORTCUTS: [string, string][] = [
	['Ctrl K', 'Search / commands / quick create'],
	['Ctrl Z · Ctrl Shift Z', 'Undo · redo'],
	['g s · g ,', 'Stats · settings'],
	['n', 'Quick create (palette)'],
	['f', 'Focus mode'],
	['?', 'This help']
];
