// Promise-based confirm/choice/prompt dialog (rendered once by ChoiceDialog.svelte).
export const choice = $state({
	open: false,
	title: '',
	description: '',
	options: [] as { value: string; label: string; destructive?: boolean }[],
	/** Text field value (prompt mode) or null (buttons only). */
	input: null as string | null,
	placeholder: '',
	resolve: null as null | ((v: string | null) => void)
});

export function choose(
	title: string,
	options: typeof choice.options,
	description = ''
): Promise<string | null> {
	choice.resolve?.(null);
	return new Promise((resolve) =>
		Object.assign(choice, { open: true, title, description, options, input: null, resolve })
	);
}

export const confirmAction = async (title: string, description = '', label = 'Delete') =>
	(await choose(title, [{ value: 'ok', label, destructive: true }], description)) === 'ok';

/** Ask for a line of text; resolves to the trimmed text, or null when cancelled/empty. */
export async function ask(
	title: string,
	{ value = '', placeholder = '', label = 'OK' } = {}
): Promise<string | null> {
	const done = choose(title, [{ value: 'ok', label }]);
	Object.assign(choice, { input: value, placeholder });
	return (await done) === 'ok' ? choice.input?.trim() || null : null;
}
