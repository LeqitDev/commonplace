<script lang="ts">
	// Note shown inside a canvas embed (iframe): solid background; markdown notes are editable
	// (click the embed in Excalidraw to activate it), canvas notes are shown as text.
	import { page } from '$app/state';
	import { marked } from 'marked';
	import MarkdownEditor from '#lib/components/editor/MarkdownEditor.svelte';
	import { api, fetchDoc } from '#lib/data.svelte.ts';
	import { canvasText } from '#lib/canvas.ts';
	import { autosaver } from '#modules/notes/notes.ts';
	import type { Note } from '#lib/types.ts';

	let note: Note | null = $state(null);
	let saver: ReturnType<typeof autosaver> | undefined = $state.raw();

	$effect(() => {
		const nid = page.params.id!;
		const s = (saver = autosaver(nid, (md) =>
			api(`/api/notes/${nid}`, { method: 'PATCH', body: JSON.stringify({ content: md }) })
		));
		fetchDoc('notes', nid).then((n) => {
			s.recover(n.content);
			note = n;
		});
		const flush = () => s.flush();
		addEventListener('pagehide', flush);
		return () => {
			removeEventListener('pagehide', flush);
			flush();
		};
	});
</script>

{#if note}
	<div class="flex h-svh flex-col bg-card text-card-foreground">
		<a
			href={`/notes/${note.id}`}
			target="_top"
			class="block shrink-0 truncate px-7 pt-4 pb-1 text-base font-semibold hover:underline"
			>{note.title}</a
		>
		{#if note.type === 'md'}
			<div class="min-h-0 flex-1 overflow-y-auto">
				<MarkdownEditor
					compact
					value={saver?.draft() ?? note.content ?? ''}
					onchange={(md) => saver?.change(md)}
				/>
			</div>
		{:else}
			<article
				class="prose prose-sm max-w-none overflow-y-auto px-7 py-2 prose-neutral dark:prose-invert"
			>
				<!-- eslint-disable-next-line svelte/no-at-html-tags -- the user's own note -->
				{@html marked.parse(canvasText(note.scene?.elements))}
			</article>
		{/if}
	</div>
{/if}
