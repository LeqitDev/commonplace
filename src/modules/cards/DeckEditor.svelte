<script lang="ts">
	// Cards of a deck note: front/back as Typst markup with live preview.
	import { Button } from '#lib/components/ui/button/index.ts';
	import TypstView from './TypstView.svelte';
	import { create, db, remove, settings, update } from '#lib/data.svelte.ts';
	import { applyTemplate, isDue } from './cards.ts';
	import type { Card, Note } from '#lib/types.ts';
	import Plus from '@lucide/svelte/icons/plus';
	import Trash from '@lucide/svelte/icons/trash-2';
	import Play from '@lucide/svelte/icons/play';
	import FileCode from '@lucide/svelte/icons/file-code';

	let { deck }: { deck: Note } = $props();

	const cards = $derived(
		db.cards.all
			.filter((c) => c.deckId === deck.id)
			.sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''))
	);
	const due = $derived(cards.filter((c) => isDue(c) && c.front.trim()).length);
	// unsaved text while typing (saved on blur, so every edit is one undo step)
	let drafts = $state<Record<string, string>>({});
	const key = (c: Card, side: 'front' | 'back') => `${c.id}:${side}`;
	const text = (c: Card, side: 'front' | 'back') => drafts[key(c, side)] ?? c[side];

	let focusId = $state<string | null>(null);
	function add() {
		// focus the new card right away (not after the request: until then the "Card" button
		// keeps focus and typed spaces would press it again)
		const id = crypto.randomUUID();
		focusId = id;
		create('cards', { id, deckId: deck.id, front: '', back: '' });
	}
	function save(c: Card, side: 'front' | 'back') {
		const k = key(c, side);
		if (k in drafts && drafts[k] !== c[side]) update('cards', c.id, { [side]: drafts[k] });
		delete drafts[k];
	}
	// deck template (overrides the global one from Settings when non-empty), edited live
	let showTemplate = $state(false);
	let tplDraft = $state<string | null>(null);
	const deckTpl = $derived(tplDraft ?? deck.cardTemplate ?? '');
	const render = (s: string) => applyTemplate(s, deckTpl, settings().cardTemplate);
	function saveTemplate() {
		if (tplDraft !== null && tplDraft !== (deck.cardTemplate ?? ''))
			update('notes', deck.id, { cardTemplate: tplDraft });
		tplDraft = null;
	}

	const fmt = (iso?: string) => (iso ? new Date(iso).toLocaleDateString() : 'new');
</script>

<div class="mx-auto flex max-w-5xl flex-col gap-4 p-6">
	<div class="flex items-center gap-3">
		<span class="text-sm text-muted-foreground"
			>{cards.length} cards · {due} due · Typst markup, e.g. <code>$a^2 + b^2 = c^2$</code></span
		>
		<div class="flex-1"></div>
		<Button
			size="sm"
			variant="ghost"
			aria-pressed={showTemplate}
			class={showTemplate ? 'bg-accent' : ''}
			onclick={() => (showTemplate = !showTemplate)}><FileCode /> Template</Button
		>
		<Button size="sm" variant="outline" onclick={add}><Plus /> Card</Button>
		<Button size="sm" href={`/review?deck=${deck.id}`} disabled={!due}><Play /> Review</Button>
	</div>
	{#if showTemplate}
		<div class="flex flex-col gap-1 rounded-lg border p-3">
			<textarea
				class="min-h-24 resize-y rounded-md border border-input bg-transparent p-2 font-mono text-xs outline-none focus:border-ring"
				placeholder={settings().cardTemplate?.trim()
					? `Empty: uses the global template from Settings:\n${settings().cardTemplate}`
					: '#set text(font: "New Computer Modern")\n%box_content%'}
				value={deckTpl}
				oninput={(e) => (tplDraft = e.currentTarget.value)}
				onblur={saveTemplate}></textarea>
			<span class="text-xs text-muted-foreground"
				>Typst template for this deck. <code>%box_content%</code> is replaced by each card's front/back;
				without it, the template is put in front of the content. Empty = the global template (Settings).</span
			>
		</div>
	{/if}
	{#each cards as c (c.id)}
		<div class="group grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg border p-3">
			{#each ['front', 'back'] as const as side (side)}
				<textarea
					class="min-h-16 resize-y rounded-md border border-input bg-transparent p-2 font-mono text-xs outline-none focus:border-ring"
					placeholder={side === 'front' ? 'Front (question)' : 'Back (answer)'}
					value={text(c, side)}
					oninput={(e) => (drafts[key(c, side)] = e.currentTarget.value)}
					onblur={() => save(c, side)}
					{@attach (el: HTMLTextAreaElement) => {
						if (side === 'front' && focusId === c.id) {
							el.focus();
							focusId = null;
						}
					}}></textarea>
			{/each}
			{#each ['front', 'back'] as const as side (side)}
				<TypstView src={render(text(c, side))} class="min-h-6 px-2" />
			{/each}
			<div class="col-span-2 flex items-center gap-2 text-xs text-muted-foreground">
				<span
					>Due {fmt(c.due)}{c.srs ? ` · ${c.srs.reps} reviews, ${c.srs.lapses} lapses` : ''}</span
				>
				<div class="flex-1"></div>
				<Button
					size="icon-xs"
					variant="ghost"
					class="opacity-0 group-hover:opacity-100"
					title="Delete card"
					onclick={() => remove('cards', c.id)}><Trash /></Button
				>
			</div>
		</div>
	{:else}
		<p class="text-sm text-muted-foreground">No cards yet.</p>
	{/each}
</div>
