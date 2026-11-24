import { goto } from '$app/navigation';
import type { ClientModule } from '#lib/modules.ts';
import { db } from '#lib/data.svelte.ts';
import { inFocus } from '#lib/ui.svelte.ts';
import { isDue } from './cards.ts';
import Layers from '@lucide/svelte/icons/layers';
import CardTemplate from './CardTemplate.svelte';
import DeckNote from './DeckNote.svelte';

/** Cards due now in the decks of the focused project. */
function due() {
	const decks = new Set(
		db.notes.all.filter((n) => n.type === 'deck' && inFocus(n)).map((n) => n.id)
	);
	return db.cards.all.filter((c) => decks.has(c.deckId) && c.front.trim() && isDue(c)).length;
}

export default {
	id: 'cards',
	nav: [{ href: '/review', label: 'Review', icon: Layers, key: 'g r', order: 50, badge: due }],
	commands: [{ label: 'Go to Review', run: () => goto('/review') }],
	keys: { 'g r': () => goto('/review') },
	shortcuts: [['g r', 'Review flashcards']],
	noteTypes: [{ type: 'deck', label: 'Flashcard deck', icon: Layers, editor: DeckNote }],
	settingsTabs: [
		{ id: 'cards', label: 'Flashcards', icon: Layers, component: CardTemplate, order: 60 }
	]
} satisfies ClientModule;
