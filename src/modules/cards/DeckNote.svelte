<script lang="ts">
	import DeckEditor from './DeckEditor.svelte';
	import type { Note } from '#lib/types.ts';

	let { note }: { note: Note } = $props();
</script>

<DeckEditor deck={note} />
