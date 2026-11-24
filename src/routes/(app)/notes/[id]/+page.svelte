<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import * as Popover from '#lib/components/ui/popover/index.ts';
	import * as ToggleGroup from '#lib/components/ui/toggle-group/index.ts';
	import { Button } from '#lib/components/ui/button/index.ts';
	import MarkdownEditor from '#lib/components/editor/MarkdownEditor.svelte';
	import MetaFields from '#lib/components/app/MetaFields.svelte';
	import { api, db, fetchDoc, update } from '#lib/data.svelte.ts';
	import { noteType, slot } from '#lib/slots.svelte.ts';
	import { removeNote } from '#modules/notes/tree.svelte.ts';
	import { confirmAction } from '#lib/choice.svelte.ts';
	import { canvasText } from '#lib/canvas.ts';
	import { autosaver } from '#modules/notes/notes.ts';
	import { bindKeys } from '#lib/shortcuts.ts';
	import { hrefFor, pick } from '#lib/ui.svelte.ts';
	import type { SearchHit } from '#lib/types.ts';
	import Link from '@lucide/svelte/icons/link';
	import Ellipsis from '@lucide/svelte/icons/ellipsis';

	const id = $derived(page.params.id!);
	let loaded: string | null = $state(null);
	let mdEditor: { insertLink(text: string, href: string): void } | undefined = $state();
	let backlinks: SearchHit[] = $state([]);
	const note = $derived(loaded ? db.notes.items[loaded] : undefined);
	let saver: ReturnType<typeof autosaver> | undefined = $state.raw();
	const kind = $derived(noteType(note?.type));
	/** Types a markdown note can become (canvas), and markdown again. */
	const convertible = $derived(slot('noteTypes').filter((t) => t.fromMarkdown));

	$effect(() => {
		const nid = id;
		loaded = null;
		const s = (saver = autosaver(nid, (md) => update('notes', nid, { content: md }, false)));
		fetchDoc('notes', nid).then((full) => {
			db.notes.items[nid] = full; // full doc (with body) so undo snapshots are complete
			loaded = nid;
			s.recover(full.content);
		});
		api<SearchHit[]>(`/api/search?q=${nid}`).then(
			(h) => (backlinks = h.filter((x) => x.id !== nid))
		);
		return () => s.flush();
	});

	async function convert(to: string) {
		if (!note || !to || to === note.type) return;
		if (to === 'md') {
			if (
				!(await confirmAction(
					'Convert to markdown?',
					'Only the text is kept; drawings and embeds are dropped.',
					'Convert'
				))
			)
				return;
			await update('notes', note.id, {
				type: 'md',
				content: canvasText(note.scene?.elements),
				scene: undefined
			});
			return;
		}
		const t = noteType(to);
		if (t?.fromMarkdown) await update('notes', note.id, await t.fromMarkdown(note));
	}

	async function insertLink() {
		if (note?.type !== 'md') return;
		const hit = await pick();
		mdEditor?.insertLink(hit.title.replace(/[[\]]/g, ''), hrefFor(hit.coll, hit.id));
	}
	$effect(() => bindKeys({ '$mod+l': insertLink }, { always: ['$mod+l'] }));

	async function del() {
		if (!note || !(await confirmAction('Delete note?', 'You can undo this.'))) return;
		const nid = note.id;
		await goto('/notes');
		await removeNote(nid);
	}
</script>

{#if note}
	<div class="flex h-full flex-col">
		<div class="flex items-center gap-2 border-b px-4 py-2">
			<input
				class="min-w-0 flex-1 bg-transparent text-lg font-semibold outline-none"
				value={note.title}
				onchange={(e) => update('notes', note.id, { title: e.currentTarget.value })}
			/>
			{#each slot('itemBadges') as Badge (Badge)}<Badge item={note} />{/each}
			{#if backlinks.length}
				<Popover.Root>
					<Popover.Trigger class="text-xs text-muted-foreground hover:underline"
						>{backlinks.length} linked from</Popover.Trigger
					>
					<Popover.Content class="w-72 p-1">
						{#each backlinks as b (b.coll + b.id)}
							<a
								class="block truncate rounded px-2 py-1 text-sm hover:bg-muted"
								href={hrefFor(b.coll, b.id)}>{b.title}</a
							>
						{/each}
					</Popover.Content>
				</Popover.Root>
			{/if}
			{#if note.type === 'md'}
				<Button size="sm" variant="ghost" onclick={insertLink} title="Insert link (Ctrl L)"
					><Link /> Link</Button
				>
			{/if}
			{#if (note.type ?? 'md') === 'md' ? convertible.length : kind?.fromMarkdown}<ToggleGroup.Root
					type="single"
					size="sm"
					variant="outline"
					value={note.type}
					onValueChange={convert}
				>
					<ToggleGroup.Item value="md">Markdown</ToggleGroup.Item>
					{#each kind?.fromMarkdown ? [kind] : convertible as t (t.type)}
						<ToggleGroup.Item value={t.type}>{t.label}</ToggleGroup.Item>
					{/each}
				</ToggleGroup.Root>{/if}
			<Popover.Root>
				<Popover.Trigger><Ellipsis class="size-4" /></Popover.Trigger>
				<Popover.Content class="w-80">
					<div class="grid grid-cols-[5rem_1fr] items-center gap-x-3 gap-y-2 text-sm">
						<MetaFields coll="notes" doc={note} category={false} />
					</div>
					<div class="mt-3 flex justify-between">
						<span class="text-xs text-muted-foreground"
							>Updated {new Date(note.updatedAt ?? '').toLocaleString()}</span
						>
						<Button size="xs" variant="destructive" onclick={del}>Delete</Button>
					</div>
				</Popover.Content>
			</Popover.Root>
		</div>
		<div class="min-h-0 flex-1 overflow-y-auto">
			{#key note.id + note.type}
				{#if kind}
					<kind.editor {note} />
				{:else if note.type && note.type !== 'md'}
					<!-- its module isn't in this build: the text at least -->
					<pre class="p-6 text-sm whitespace-pre-wrap">{note.type === 'canvas'
							? canvasText(note.scene?.elements)
							: `This ${note.type} needs a module that isn't installed.`}</pre>
				{:else}
					<MarkdownEditor
						bind:this={mdEditor}
						value={saver?.draft() ?? note.content ?? ''}
						onchange={(md) => saver?.change(md)}
					/>
				{/if}
			{/key}
		</div>
	</div>
{/if}
