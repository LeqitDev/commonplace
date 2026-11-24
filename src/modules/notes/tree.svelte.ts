// Notes tree actions used by FolderTree, the notes pages and the project page (the open/closed
// state is core: tree-state.svelte.ts).
import { goto } from '$app/navigation';
import { page } from '$app/state';
import { batch, create, db, remove, update, upload } from '#lib/data.svelte.ts';
import { confirmAction } from '#lib/choice.svelte.ts';
import type { DragItem } from '#lib/dnd.svelte.ts';
import type { Note } from '#lib/types.ts';

import { toggle, tree } from '#lib/tree-state.svelte.ts';

export { toggle, tree };

export async function newNote(
	projectId: string | null,
	folderId: string | null = null,
	type: Note['type'] = 'md'
) {
	if (folderId) toggle(folderId, true);
	const n = await create('notes', {
		title: 'Untitled',
		type,
		...(type === 'md' ? { content: '' } : {}),
		projectId,
		folderId
	});
	await goto(`/notes/${n.id}`);
	tree.renaming = n.id;
}

export async function newFolder(projectId: string | null, parentId: string | null = null) {
	if (parentId) toggle(parentId, true);
	const f = await create('folders', { name: 'New folder', projectId, parentId });
	tree.renaming = f.id;
}

export function rename(kind: DragItem['kind'], id: string, name: string) {
	tree.renaming = null;
	name = name.trim();
	if (!name) return;
	if (kind === 'folder' && name !== db.folders.items[id]?.name) update('folders', id, { name });
	if (kind === 'note' && name !== db.notes.items[id]?.title) update('notes', id, { title: name });
	if (kind === 'file' && name !== db.files.items[id]?.name) update('files', id, { name });
}

/** True if folder `id` is `target` or one of its ancestors. */
function contains(id: string, target: string | null) {
	for (let f = target; f; f = db.folders.items[f]?.parentId ?? null) if (f === id) return true;
	return false;
}

export const canMove = (item: DragItem, folderId: string | null) =>
	item.kind !== 'folder' || !contains(item.id, folderId);

/** Move a note, file or folder (with everything inside) into a folder / project root. */
export async function moveItem(item: DragItem, projectId: string | null, folderId: string | null) {
	if (item.kind === 'note') return update('notes', item.id, { projectId, folderId });
	if (item.kind === 'file') return update('files', item.id, { projectId, folderId });
	if (!canMove(item, folderId)) return;
	await batch(async () => {
		await update('folders', item.id, { projectId, parentId: folderId });
		// descendants follow into the other project
		const inside = (fid: string): string[] => [
			fid,
			...db.folders.all.filter((f) => f.parentId === fid).flatMap((f) => inside(f.id))
		];
		const ids = new Set(inside(item.id));
		for (const f of db.folders.all.filter((f) => ids.has(f.id) && f.id !== item.id))
			if ((f.projectId ?? null) !== projectId) await update('folders', f.id, { projectId });
		for (const n of db.notes.all.filter((n) => n.folderId && ids.has(n.folderId)))
			if ((n.projectId ?? null) !== projectId) await update('notes', n.id, { projectId });
		for (const x of db.files.all.filter((x) => x.folderId && ids.has(x.folderId)))
			if ((x.projectId ?? null) !== projectId) await update('files', x.id, { projectId });
	});
}

/** Delete folder; its notes and subfolders move up one level. */
export async function deleteFolder(id: string) {
	if (!(await confirmAction('Delete folder?', 'Notes and subfolders inside move up one level.')))
		return;
	const parent = db.folders.items[id]?.parentId ?? null;
	await batch(async () => {
		for (const n of db.notes.all.filter((n) => n.folderId === id))
			await update('notes', n.id, { folderId: parent });
		for (const x of db.files.all.filter((x) => x.folderId === id))
			await update('files', x.id, { folderId: parent });
		for (const f of db.folders.all.filter((f) => f.parentId === id))
			await update('folders', f.id, { parentId: parent });
		await remove('folders', id);
	});
}

export async function deleteNote(id: string) {
	if (!(await confirmAction('Delete note?', 'You can undo this.'))) return;
	if (page.params.id === id) await goto('/notes');
	await removeNote(id);
}

/** Remove a note; a deck takes its cards with it (one undo step). */
export const removeNote = (id: string) =>
	batch(async () => {
		for (const c of db.cards.all.filter((c) => c.deckId === id)) await remove('cards', c.id);
		await remove('notes', id);
	});

/** Deleting a file also deletes its blob on the server, so this one can't be undone. */
export async function deleteFile(id: string) {
	if (!(await confirmAction('Delete file?', 'The file is deleted permanently.'))) return;
	if (page.params.id === id) await goto('/notes');
	await remove('files', id, false);
}

/** Upload files (file chooser or OS drag & drop) into a project root / folder. */
export async function uploadFiles(
	files: Iterable<File>,
	projectId: string | null,
	folderId: string | null = null
) {
	if (folderId) toggle(folderId, true);
	for (const f of files) await upload(f, f.name, undefined, { projectId, folderId });
}

/** Open the OS file chooser and upload the picked files into the tree. */
export function chooseFiles(projectId: string | null, folderId: string | null = null) {
	const input = Object.assign(document.createElement('input'), { type: 'file', multiple: true });
	input.onchange = () => input.files && uploadFiles(input.files, projectId, folderId);
	input.click();
}

/** Attachment: accept files dragged in from the OS (internal tree DnD is pointer-based). */
export const fileDrop =
	(projectId: () => string | null, folderId: () => string | null = () => null) =>
	(node: HTMLElement) => {
		const isFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes('Files');
		const over = (e: DragEvent) => {
			if (!isFiles(e)) return;
			e.preventDefault();
			node.dataset.fileOver = '';
		};
		const leave = () => delete node.dataset.fileOver;
		const drop = (e: DragEvent) => {
			if (!isFiles(e)) return;
			e.preventDefault();
			e.stopPropagation(); // innermost folder wins
			leave();
			uploadFiles(e.dataTransfer!.files, projectId(), folderId());
		};
		node.addEventListener('dragover', over);
		node.addEventListener('dragleave', leave);
		node.addEventListener('drop', drop);
		return () => {
			node.removeEventListener('dragover', over);
			node.removeEventListener('dragleave', leave);
			node.removeEventListener('drop', drop);
		};
	};
