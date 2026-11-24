<script lang="ts">
	// Preview of a file uploaded into the notes tree.
	import { page } from '$app/state';
	import { Button } from '#lib/components/ui/button/index.ts';
	import { db, update } from '#lib/data.svelte.ts';
	import { deleteFile } from '#modules/notes/tree.svelte.ts';
	import Download from '@lucide/svelte/icons/download';
	import Trash from '@lucide/svelte/icons/trash-2';

	const file = $derived(db.files.items[page.params.id!]);
	const src = $derived(file && `/files/${file.id}`);
	const mime = $derived(file?.mime ?? '');
	const isText = $derived(/^text\/|json|xml|javascript|x-sh|x-yaml|csv/.test(mime));

	let text = $state<string | null>(null);
	$effect(() => {
		text = null;
		if (file && isText && file.size < 2_000_000)
			fetch(src!)
				.then((r) => r.text())
				.then((t) => (text = t));
	});

	const size = (n: number) =>
		n < 1024
			? `${n} B`
			: n < 1048576
				? `${(n / 1024).toFixed(0)} KB`
				: `${(n / 1048576).toFixed(1)} MB`;
</script>

{#if file}
	<div class="flex h-full min-h-0 flex-col">
		<div class="flex items-center gap-3 border-b px-6 py-3">
			<input
				class="min-w-0 flex-1 bg-transparent text-lg font-semibold outline-none"
				value={file.name}
				onchange={(e) => {
					const name = e.currentTarget.value.trim();
					if (name) update('files', file.id, { name });
				}}
			/>
			<span class="text-xs text-muted-foreground"
				>{mime.split(';')[0] || 'unknown type'} · {size(file.size)}</span
			>
			<Button size="sm" variant="outline" href={`${src}?download`}><Download /> Download</Button>
			<Button size="icon-sm" variant="ghost" title="Delete" onclick={() => deleteFile(file.id)}
				><Trash /></Button
			>
		</div>
		<div class="min-h-0 flex-1 overflow-auto">
			{#if mime.startsWith('image/')}
				<img {src} alt={file.name} class="mx-auto max-h-full max-w-full object-contain p-6" />
			{:else if mime === 'application/pdf'}
				<iframe {src} title={file.name} class="size-full border-0"></iframe>
			{:else if mime.startsWith('video/')}
				<!-- svelte-ignore a11y_media_has_caption -->
				<video {src} controls class="mx-auto max-h-full max-w-full p-6"></video>
			{:else if mime.startsWith('audio/')}
				<audio {src} controls class="m-6"></audio>
			{:else if isText && text !== null}
				<pre class="p-6 font-mono text-xs whitespace-pre-wrap">{text}</pre>
			{:else}
				<p class="p-6 text-sm text-muted-foreground">No preview for this file type.</p>
			{/if}
		</div>
	</div>
{:else}
	<p class="p-6 text-sm text-muted-foreground">File not found.</p>
{/if}
