<script lang="ts">
	import CanvasEditor from './CanvasEditor.svelte';
	import { update } from '#lib/data.svelte.ts';
	import type { Note } from '#lib/types.ts';

	let { note }: { note: Note } = $props();
</script>

<CanvasEditor scene={note.scene} onchange={(scene) => update('notes', note.id, { scene }, false)} />
