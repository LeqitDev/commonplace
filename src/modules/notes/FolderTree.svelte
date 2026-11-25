<script lang="ts">
	// Recursive folder/note/file tree for one project (projectId null = unfiled).
	import Self from './FolderTree.svelte';
	import NewNoteMenu from './NewNoteMenu.svelte';
	import * as ContextMenu from '#lib/components/ui/context-menu/index.ts';
	import { page } from '$app/state';
	import { db } from '#lib/data.svelte.ts';
	import { slot } from '#lib/slots.svelte.ts';
	import { dnd, draggable, droppable, type DragItem } from '#lib/dnd.svelte.ts';
	import {
		canMove,
		chooseFiles,
		deleteFile,
		deleteFolder,
		deleteNote,
		fileDrop,
		moveItem,
		newFolder,
		newNote,
		rename,
		toggle,
		tree
	} from './tree.svelte.ts';
	import { cn } from '#lib/utils.ts';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import FolderIcon from '@lucide/svelte/icons/folder';
	import FolderOpen from '@lucide/svelte/icons/folder-open';
	import FileText from '@lucide/svelte/icons/file-text';
	import PenTool from '@lucide/svelte/icons/pen-tool';
	import Layers from '@lucide/svelte/icons/layers';
	import FolderPlus from '@lucide/svelte/icons/folder-plus';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Trash from '@lucide/svelte/icons/trash-2';
	import Upload from '@lucide/svelte/icons/upload';
	import Download from '@lucide/svelte/icons/download';
	import FileIcon from './FileIcon.svelte';

	let {
		projectId,
		parentId = null,
		depth = 0
	}: { projectId: string | null; parentId?: string | null; depth?: number } = $props();

	const folders = $derived(
		db.folders.all
			.filter((f) => (f.projectId ?? null) === projectId && (f.parentId ?? null) === parentId)
			.sort((a, b) => a.name.localeCompare(b.name))
	);
	const notes = $derived(
		db.notes.all
			.filter(
				(n) => !n.daily && (n.projectId ?? null) === projectId && (n.folderId ?? null) === parentId
			)
			.sort((a, b) => a.title.localeCompare(b.title))
	);
	const files = $derived(
		db.files.all
			.filter(
				(x) => x.tree && (x.projectId ?? null) === projectId && (x.folderId ?? null) === parentId
			)
			.sort((a, b) => a.name.localeCompare(b.name))
	);

	const row = 'group flex h-7 items-center gap-1.5 rounded-md pr-1 text-sm hover:bg-muted/60';
	// one step in from the project label, then one step per folder level
	const pad = (extra = 0) => `padding-left: ${0.25 + (depth + 1) * 0.9 + extra}rem`;
	const icon = 'size-3.5 shrink-0 text-muted-foreground';
	// keep focus in the rename field instead of returning it to the menu trigger
	const keepFocus = (e: Event) => e.preventDefault();
	const startRename = (e: KeyboardEvent, id: string) => e.key === 'F2' && (tree.renaming = id);
</script>

{#snippet nameField(kind: DragItem['kind'], id: string, value: string)}
	<input
		class="h-6 min-w-0 flex-1 rounded-sm border border-ring bg-background px-1 text-sm outline-none"
		{value}
		{@attach (el: HTMLInputElement) => (el.focus(), el.select())}
		onkeydown={(e) => {
			if (e.key === 'Enter') e.currentTarget.blur();
			else if (e.key === 'Escape') tree.renaming = null;
		}}
		onblur={(e) => tree.renaming === id && rename(kind, id, e.currentTarget.value)}
	/>
{/snippet}

{#each folders as f (f.id)}
	{@const key = `folder:${f.id}`}
	{@const open = !tree.collapsed[f.id]}
	<ContextMenu.Root>
		<ContextMenu.Trigger>
			{#snippet child({ props })}
				<div
					{...props}
					class={cn(row, 'data-file-over:bg-accent', dnd.over === key && 'bg-accent')}
					style={pad()}
					role="treeitem"
					aria-selected="false"
					aria-expanded={open}
					tabindex="-1"
					{@attach draggable(() => ({ kind: 'folder', id: f.id, label: f.name }))}
					{@attach droppable(
						key,
						(i) => i.id !== f.id && canMove(i, f.id),
						(i) => moveItem(i, projectId, f.id)
					)}
					{@attach fileDrop(
						() => projectId,
						() => f.id
					)}
				>
					{#if tree.renaming === f.id}
						<ChevronRight class="size-3.5 shrink-0 {open ? 'rotate-90' : ''}" />
						<FolderIcon class={icon} />
						{@render nameField('folder', f.id, f.name)}
					{:else}
						<button
							class="flex min-w-0 flex-1 items-center gap-1.5"
							onclick={() => toggle(f.id)}
							ondblclick={() => (tree.renaming = f.id)}
							onkeydown={(e) => startRename(e, f.id)}
						>
							<ChevronRight
								class="size-3.5 shrink-0 transition-transform {open ? 'rotate-90' : ''}"
							/>
							{#if open}<FolderOpen class={icon} />{:else}<FolderIcon class={icon} />{/if}
							<span class="truncate">{f.name}</span>
						</button>
						<NewNoteMenu {projectId} folderId={f.id} class="opacity-0 group-hover:opacity-100" />
					{/if}
				</div>
			{/snippet}
		</ContextMenu.Trigger>
		<ContextMenu.Content class="w-44" onCloseAutoFocus={keepFocus}>
			<ContextMenu.Item onSelect={() => newNote(projectId, f.id)}
				><FileText /> New note</ContextMenu.Item
			>
			{#each slot('noteTypes') as t (t.type)}
				<ContextMenu.Item onSelect={() => newNote(projectId, f.id, t.type)}
					><t.icon /> New {t.label.toLowerCase()}</ContextMenu.Item
				>
			{/each}
			<ContextMenu.Item onSelect={() => newFolder(projectId, f.id)}
				><FolderPlus /> New folder</ContextMenu.Item
			>
			<ContextMenu.Item onSelect={() => chooseFiles(projectId, f.id)}
				><Upload /> Upload files…</ContextMenu.Item
			>
			<ContextMenu.Separator />
			<ContextMenu.Item onSelect={() => (tree.renaming = f.id)}
				><Pencil /> Rename <ContextMenu.Shortcut>F2</ContextMenu.Shortcut></ContextMenu.Item
			>
			<ContextMenu.Item variant="destructive" onSelect={() => deleteFolder(f.id)}
				><Trash /> Delete</ContextMenu.Item
			>
		</ContextMenu.Content>
	</ContextMenu.Root>
	{#if open}
		<div class="relative">
			<!-- indent guide under the chevron -->
			<span
				class="pointer-events-none absolute inset-y-0 border-l"
				style="left: calc({0.25 + (depth + 1) * 0.9}rem + 7px)"
			></span>
			<Self {projectId} parentId={f.id} depth={depth + 1} />
		</div>
	{/if}
{/each}
{#each notes as n (n.id)}
	{@const active = page.params.id === n.id}
	<ContextMenu.Root>
		<ContextMenu.Trigger>
			{#snippet child({ props })}
				{#if tree.renaming === n.id}
					<div {...props} class={row} style={pad(1.25)}>
						{#if n.type === 'canvas'}<PenTool class={icon} />{:else if n.type === 'deck'}<Layers
								class={icon}
							/>{:else}<FileText class={icon} />{/if}
						{@render nameField('note', n.id, n.title)}
					</div>
				{:else}
					<a
						{...props}
						href={`/notes/${n.id}`}
						draggable="false"
						class={cn(row, active && 'bg-muted font-medium')}
						style={pad(1.25)}
						onkeydown={(e) => startRename(e, n.id)}
						{@attach draggable(() => ({ kind: 'note', id: n.id, label: n.title || 'Untitled' }))}
					>
						{#if n.type === 'canvas'}<PenTool class={icon} />{:else if n.type === 'deck'}<Layers
								class={icon}
							/>{:else}<FileText class={icon} />{/if}
						<span class="truncate">{n.title || 'Untitled'}</span>
					</a>
				{/if}
			{/snippet}
		</ContextMenu.Trigger>
		<ContextMenu.Content class="w-44" onCloseAutoFocus={keepFocus}>
			<ContextMenu.Item onSelect={() => (tree.renaming = n.id)}
				><Pencil /> Rename <ContextMenu.Shortcut>F2</ContextMenu.Shortcut></ContextMenu.Item
			>
			<ContextMenu.Item variant="destructive" onSelect={() => deleteNote(n.id)}
				><Trash /> Delete</ContextMenu.Item
			>
		</ContextMenu.Content>
	</ContextMenu.Root>
{/each}
{#each files as x (x.id)}
	{@const active = page.params.id === x.id}
	<ContextMenu.Root>
		<ContextMenu.Trigger>
			{#snippet child({ props })}
				{#if tree.renaming === x.id}
					<div {...props} class={row} style={pad(1.25)}>
						<FileIcon mime={x.mime} class={icon} />
						{@render nameField('file', x.id, x.name)}
					</div>
				{:else}
					<a
						{...props}
						href={`/notes/file/${x.id}`}
						draggable="false"
						class={cn(row, active && 'bg-muted font-medium')}
						style={pad(1.25)}
						onkeydown={(e) => startRename(e, x.id)}
						ondblclick={(e) => (e.preventDefault(), (tree.renaming = x.id))}
						{@attach draggable(() => ({ kind: 'file', id: x.id, label: x.name }))}
					>
						<FileIcon mime={x.mime} class={icon} />
						<span class="truncate">{x.name}</span>
					</a>
				{/if}
			{/snippet}
		</ContextMenu.Trigger>
		<ContextMenu.Content class="w-44" onCloseAutoFocus={keepFocus}>
			<ContextMenu.Item onSelect={() => (tree.renaming = x.id)}
				><Pencil /> Rename <ContextMenu.Shortcut>F2</ContextMenu.Shortcut></ContextMenu.Item
			>
			<ContextMenu.Item onSelect={() => window.open(`/files/${x.id}?download`, '_self')}
				><Download /> Download</ContextMenu.Item
			>
			<ContextMenu.Item variant="destructive" onSelect={() => deleteFile(x.id)}
				><Trash /> Delete</ContextMenu.Item
			>
		</ContextMenu.Content>
	</ContextMenu.Root>
{/each}
{#if depth === 0 && !folders.length && !notes.length && !files.length}
	<p class="py-1 text-xs text-muted-foreground" style={pad(1.25)}>No notes</p>
{/if}
