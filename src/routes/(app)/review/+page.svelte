<script lang="ts">
	// Flashcard review: due cards of all decks in focus (or one deck via ?deck=), again / good.
	// "Again" brings the card back in a minute, "Good" is done for this session (src/lib/cards.ts).
	import { page } from '$app/state';
	import { Button } from '#lib/components/ui/button/index.ts';
	import TypstView from '#modules/cards/TypstView.svelte';
	import { db, settings, update } from '#lib/data.svelte.ts';
	import { applyTemplate, isDue, review } from '#modules/cards/cards.ts';
	import { bindKeys } from '#lib/shortcuts.ts';
	import { inFocus } from '#lib/ui.svelte.ts';

	const deckId = $derived(page.url.searchParams.get('deck'));
	const decks = $derived(
		db.notes.all.filter((n) => n.type === 'deck' && (deckId ? n.id === deckId : inFocus(n)))
	);
	// re-check due dates regularly: "again" cards become due after a minute
	let now = $state(new Date());
	$effect(() => {
		const t = setInterval(() => (now = new Date()), 15_000);
		return () => clearInterval(t);
	});

	// Like Anki's "learn ahead": cards answered "again" that come back within 20 minutes stay in
	// the session; when nothing else is due they are shown right away instead of ending it.
	const LEARN_AHEAD = 20 * 60_000;
	const cards = $derived.by(() => {
		const ids = new Set(decks.map((d) => d.id));
		return db.cards.all
			.filter((c) => ids.has(c.deckId) && c.front.trim())
			.sort((a, b) => (a.due ?? '').localeCompare(b.due ?? ''));
	});
	const due = $derived(cards.filter((c) => isDue(c, now)));
	const repeat = $derived(
		cards.filter((c) => !isDue(c, now) && isDue(c, new Date(+now + LEARN_AHEAD)))
	);
	const card = $derived(due[0] ?? repeat[0]);
	let shown = $state(false);
	let busy = false;

	// today's answers, kept per browser so a reload doesn't reset them
	type Done = { good: number; again: number };
	const todayKey = () => `review:${new Date().toLocaleDateString('sv')}`;
	function loadDone(): Done {
		try {
			const d = JSON.parse(localStorage.getItem(todayKey()) ?? '{}');
			return { good: Number(d.good) || 0, again: Number(d.again) || 0 };
		} catch {
			return { good: 0, again: 0 };
		}
	}
	let done = $state(loadDone());

	async function answer(good: boolean) {
		if (!card || !shown || busy) return;
		busy = true;
		const c = card;
		shown = false;
		const d = loadDone(); // another tab may have counted too
		d[good ? 'good' : 'again']++;
		done = d;
		try {
			localStorage.setItem(todayKey(), JSON.stringify(d));
		} catch {
			/* storage unavailable */
		}
		try {
			await update('cards', c.id, review(c, good), false);
		} finally {
			now = new Date();
			busy = false;
		}
	}
	$effect(() =>
		bindKeys({
			Space: () => (shown = true),
			Enter: () => (shown = true),
			'1': () => answer(false),
			'2': () => answer(true)
		})
	);
</script>

<div class="mx-auto flex h-full w-full max-w-3xl flex-col gap-6 overflow-y-auto p-6">
	<div class="flex items-baseline gap-3">
		<h1 class="text-lg font-semibold">
			Review{deckId && decks[0] ? `: ${decks[0].title}` : ''}
		</h1>
		<span class="text-sm text-muted-foreground" data-testid="counts"
			>{due.length} due{repeat.length ? ` · ${repeat.length} to repeat` : ''} · today {done.good}
			good · {done.again} again</span
		>
		{#if deckId}<a class="ml-auto text-sm underline underline-offset-4" href="/review">All decks</a
			>{/if}
	</div>

	{#if card}
		{@const deck = db.notes.items[card.deckId]}
		{@const tpl = (s: string) => applyTemplate(s, deck?.cardTemplate, settings().cardTemplate)}
		<!-- keyed: a new card must not show the previous card's rendering while it compiles -->
		{#key card.id}
			<div class="flex flex-col gap-4 rounded-xl border p-6">
				<div class="flex gap-2 text-xs text-muted-foreground">
					<a class="hover:underline" href={`/notes/${card.deckId}`}>{deck?.title}</a>
					{#if !isDue(card, now)}<span>· repeat</span>{/if}
				</div>
				<TypstView src={tpl(card.front)} />
				{#if shown}
					<div class="border-t"></div>
					<TypstView src={tpl(card.back)} />
				{/if}
			</div>
		{/key}
		<div class="flex justify-center gap-3">
			{#if shown}
				<Button variant="outline" class="w-36" onclick={() => answer(false)}
					>Again <kbd class="text-xs text-muted-foreground">1</kbd></Button
				>
				<Button class="w-36" onclick={() => answer(true)}
					>Good <kbd class="text-xs opacity-70">2</kbd></Button
				>
			{:else}
				<Button variant="outline" class="w-48" onclick={() => (shown = true)}
					>Show answer <kbd class="text-xs text-muted-foreground">Space</kbd></Button
				>
			{/if}
		</div>
	{:else}
		<p class="text-sm text-muted-foreground">
			{decks.length
				? 'Nothing due. Well done.'
				: 'No decks yet: create one with "+" → Flashcard deck in the notes tree.'}
		</p>
	{/if}
</div>
