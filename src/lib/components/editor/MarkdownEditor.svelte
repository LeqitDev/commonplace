<script lang="ts">
	import { untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import type { StateCommand } from '@codemirror/state';
	import type { EditorView } from '@codemirror/view';
	import * as ContextMenu from '#lib/components/ui/context-menu/index.ts';
	import { createEditor, fileAt } from '#lib/editor/index.ts';
	import { imageAt, imageOptions, setImage } from '#lib/editor/images.ts';
	import { ask, confirmAction } from '#lib/choice.svelte.ts';
	import {
		alignColumn,
		cellAt,
		deleteColumn,
		deleteRow,
		deleteTable,
		insertColumn,
		insertRow
	} from '#lib/editor/tables.ts';
	import { db, remove, update, upload } from '#lib/data.svelte.ts';

	let {
		value,
		onchange,
		compact = false
	}: { value: string; onchange: (md: string) => void; compact?: boolean } = $props();
	let el: HTMLDivElement;
	let view: EditorView | undefined;

	// `value` is only the initial text: the editor owns it from then on
	$effect(() => {
		const v = (view = untrack(() =>
			createEditor(el, {
				value,
				compact,
				onchange: (md) => onchange(md),
				onlink: follow,
				onupload: (file) => upload(file, file.name)
			})
		));
		return () => v.destroy();
	});

	/** Insert a link at the cursor; selected text becomes the link text instead of `text`. */
	export function insertLink(text: string, href: string) {
		if (!view) return;
		const { from, to } = view.state.selection.main;
		const md = `[${view.state.sliceDoc(from, to) || text}](${href})`;
		view.dispatch(view.state.replaceSelection(md), { scrollIntoView: true });
		view.focus();
	}

	// Ctrl/Cmd+click follows links; internal ones stay in the app, files get a tab of their own.
	function follow(href: string) {
		if (href.startsWith('/files/')) window.open(href, '_blank');
		else if (href.startsWith('/') && window.top !== window)
			window.top!.location.href = href; // canvas embed
		else if (href.startsWith('/')) goto(href);
		else window.open(href, '_blank', 'noopener');
	}

	/** The uploaded file whose link or picture was right-clicked (the menu is about it then). */
	let file: ReturnType<typeof fileAt> = $state(null);
	/** Where the picture is that was right-clicked. */
	let image: number | null = $state(null);

	// Right-click on a picture, an uploaded file or in a table: the menu below (in a table with the
	// cursor in the cell that was clicked). Anywhere else the event stops here, which leaves the
	// browser's own menu (spelling, paste).
	function menu(e: MouseEvent) {
		if (!view) return;
		const img = (e.target as Element).closest('.md-img');
		const pos = img ? view.posAtDOM(img) : view.posAtCoords({ x: e.clientX, y: e.clientY });
		// not in canvas embeds: the app's data and dialogs are not loaded there
		file = pos == null || compact ? null : fileAt(view.state, pos);
		if (file && !db.files.items[file.id]) file = null;
		image = pos != null && imageAt(view.state, pos) ? pos : null;
		if (file || image != null) return;
		if (pos == null || !cellAt(view.state, pos)) return e.stopPropagation();
		const { from, to } = view.state.selection.main;
		if (pos < from || pos > to) view.dispatch({ selection: { anchor: pos } });
	}
	const run = (command: StateCommand) => () => view && command(view);

	const setPicture = (change: Parameters<typeof setImage>[1]) => () =>
		view && image != null && setImage(image, change)(view);

	async function sizePicture() {
		const at = view && image != null && imageAt(view.state, image);
		if (!view || !at) return;
		const old = view.state.sliceDoc(at.from, at.to);
		const { width, height } = imageOptions(view.state.sliceDoc(at.alt.from, at.alt.to));
		const text = await ask('Picture size', {
			value: width ? `${width}${height ? `x${height}` : ''}` : '',
			placeholder: 'Width, or width x height (pixels)',
			label: 'Set'
		});
		const size = /^(\d+)(?:\s*[x×]\s*(\d+))?$/.exec(text ?? '');
		if (!size || view.state.sliceDoc(at.from, at.to) !== old) return;
		setImage(at.from, { width: +size[1], height: size[2] ? +size[2] : undefined })(view);
	}

	/** The cursor goes into the picture's markdown, which shows it. */
	function editPicture() {
		const at = view && image != null && imageAt(view.state, image);
		if (view && at) view.dispatch({ selection: { anchor: at.alt.from } });
	}

	async function renameFile() {
		const f = file && db.files.items[file.id];
		if (!view || !file || !f) return;
		const { id, name: at } = file;
		const old = view.state.sliceDoc(at.from, at.to);
		const name = await ask('Rename file', { value: f.name, label: 'Rename' });
		if (!name || view.state.sliceDoc(at.from, at.to) !== old) return;
		await update('files', id, { name });
		view.dispatch({ changes: { ...at, insert: name.replace(/[[\]]/g, '') } });
	}

	async function deleteFile() {
		if (!view || !file) return;
		const { id, from, to } = file;
		const old = view.state.sliceDoc(from, to);
		if (!(await confirmAction('Delete file?', 'The file is deleted permanently.'))) return;
		await remove('files', id, false); // its blob goes too: not undoable
		if (view.state.sliceDoc(from, to) === old) view.dispatch({ changes: { from, to } });
	}
</script>

<ContextMenu.Root>
	<ContextMenu.Trigger class="h-full select-auto">
		<div bind:this={el} class="h-full" oncontextmenu={menu} role="presentation"></div>
	</ContextMenu.Trigger>
	<ContextMenu.Content
		class="w-48"
		onCloseAutoFocus={(e) => {
			e.preventDefault();
			view?.focus();
		}}
	>
		{#if image != null}
			<ContextMenu.Item onSelect={setPicture({ align: undefined })}>Align left</ContextMenu.Item>
			<ContextMenu.Item onSelect={setPicture({ align: 'center' })}>Align center</ContextMenu.Item>
			<ContextMenu.Item onSelect={setPicture({ align: 'right' })}>Align right</ContextMenu.Item>
			<ContextMenu.Separator />
			<!-- no dialogs in canvas embeds -->
			{#if !compact}<ContextMenu.Item onSelect={sizePicture}>Size…</ContextMenu.Item>{/if}
			<ContextMenu.Item onSelect={setPicture({ width: undefined, height: undefined })}
				>Original size</ContextMenu.Item
			>
			<ContextMenu.Item onSelect={editPicture}>Edit markdown</ContextMenu.Item>
			{#if file}<ContextMenu.Separator />{/if}
		{/if}
		{#if file}
			<ContextMenu.Item onSelect={renameFile}>Rename file…</ContextMenu.Item>
			<ContextMenu.Item onSelect={() => window.open(`/files/${file!.id}?download`)}
				>Download</ContextMenu.Item
			>
			<ContextMenu.Separator />
			<ContextMenu.Item variant="destructive" onSelect={deleteFile}>Delete file</ContextMenu.Item>
		{:else if image == null}
			<ContextMenu.Item onSelect={run(insertRow(-1))}>Insert row above</ContextMenu.Item>
			<ContextMenu.Item onSelect={run(insertRow(1))}>Insert row below</ContextMenu.Item>
			<ContextMenu.Item onSelect={run(insertColumn(-1))}>Insert column left</ContextMenu.Item>
			<ContextMenu.Item onSelect={run(insertColumn(1))}>Insert column right</ContextMenu.Item>
			<ContextMenu.Separator />
			<ContextMenu.Item onSelect={run(alignColumn('left'))}>Align left</ContextMenu.Item>
			<ContextMenu.Item onSelect={run(alignColumn('center'))}>Align center</ContextMenu.Item>
			<ContextMenu.Item onSelect={run(alignColumn('right'))}>Align right</ContextMenu.Item>
			<ContextMenu.Separator />
			<ContextMenu.Item onSelect={run(deleteRow)}>Delete row</ContextMenu.Item>
			<ContextMenu.Item onSelect={run(deleteColumn)}>Delete column</ContextMenu.Item>
			<ContextMenu.Item variant="destructive" onSelect={run(deleteTable)}
				>Delete table</ContextMenu.Item
			>
		{/if}
	</ContextMenu.Content>
</ContextMenu.Root>
