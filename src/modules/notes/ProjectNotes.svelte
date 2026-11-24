<script lang="ts">
	import FolderTree from './FolderTree.svelte';
	import NewNoteMenu from './NewNoteMenu.svelte';
	import type { Project } from '#lib/types.ts';

	let { project }: { project: Project } = $props();
</script>

<section>
	<h2 class="mb-2 flex items-center text-xs font-medium text-muted-foreground uppercase">
		<span class="flex-1">Notes</span>
		<NewNoteMenu projectId={project.id} />
	</h2>
	<FolderTree projectId={project.id} />
</section>
