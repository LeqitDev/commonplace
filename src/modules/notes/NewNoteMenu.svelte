<script lang="ts">
	// "+" button: new note / canvas / folder inside a project root or folder.
	import * as DropdownMenu from '#lib/components/ui/dropdown-menu/index.ts';
	import { chooseFiles, newFolder, newNote } from './tree.svelte.ts';
	import { slot } from '#lib/slots.svelte.ts';
	import Upload from '@lucide/svelte/icons/upload';
	import { cn } from '#lib/utils.ts';
	import Plus from '@lucide/svelte/icons/plus';
	import FileText from '@lucide/svelte/icons/file-text';
	import FolderPlus from '@lucide/svelte/icons/folder-plus';

	let {
		projectId,
		folderId = null,
		class: className
	}: { projectId: string | null; folderId?: string | null; class?: string } = $props();
</script>

<DropdownMenu.Root>
	<DropdownMenu.Trigger
		class={cn(
			'grid size-5 shrink-0 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground data-[state=open]:bg-muted data-[state=open]:opacity-100',
			className
		)}
		title="New…"
		onclick={(e) => e.stopPropagation()}
	>
		<Plus class="size-3.5" />
	</DropdownMenu.Trigger>
	<!-- no focus return: a new folder/note opens its inline rename field -->
	<DropdownMenu.Content align="start" class="w-44" onCloseAutoFocus={(e) => e.preventDefault()}>
		<DropdownMenu.Item onSelect={() => newNote(projectId, folderId)}
			><FileText /> Note</DropdownMenu.Item
		>
		{#each slot('noteTypes') as t (t.type)}
			<DropdownMenu.Item onSelect={() => newNote(projectId, folderId, t.type)}
				><t.icon /> {t.label}</DropdownMenu.Item
			>
		{/each}
		<DropdownMenu.Item onSelect={() => newFolder(projectId, folderId)}
			><FolderPlus /> Folder</DropdownMenu.Item
		>
		<DropdownMenu.Separator />
		<DropdownMenu.Item onSelect={() => chooseFiles(projectId, folderId)}
			><Upload /> Upload files…</DropdownMenu.Item
		>
	</DropdownMenu.Content>
</DropdownMenu.Root>
