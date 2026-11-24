// Open/closed state of collapsible lists (sidebar groups, "More", mail accounts, notes tree nodes)
// and the item being renamed inline. Kept per browser.
const load = () => {
	try {
		return JSON.parse(localStorage.getItem('collapsed') ?? '{}') as Record<string, boolean>;
	} catch {
		return {};
	}
};

export const tree = $state({
	collapsed: load(),
	/** Id of the folder/note whose name is being edited inline. */
	renaming: null as string | null
});

export function toggle(key: string, open = !!tree.collapsed[key]) {
	tree.collapsed[key] = !open;
	try {
		localStorage.setItem('collapsed', JSON.stringify(tree.collapsed));
	} catch {
		/* storage unavailable */
	}
}
