<script lang="ts">
	// Settings › Flashcards: the Typst set-up every card is compiled with.
	import { saveSettings, settings } from '#lib/data.svelte.ts';
	import { area, h2, tabPanel } from '#lib/components/settings/styles.ts';

	const s = $derived(settings());
</script>

<div role="tabpanel" aria-labelledby="h-cards" class="{tabPanel} gap-5">
	<h2 id="h-cards" class="{h2} pr-9">Flashcards</h2>
	<div class="flex flex-col gap-2">
		<div>
			<label for="t-card" class="block font-medium">Flashcard template</label>
			<div class="text-muted-foreground">
				Typst set-up placed before every card; <code>%box_content%</code> is replaced by the front or
				back of the card. A deck with its own template uses that one.
			</div>
		</div>
		<textarea
			id="t-card"
			spellcheck="false"
			class="{area} h-33"
			placeholder={'#set text(font: "New Computer Modern")\n%box_content%'}
			value={s.cardTemplate ?? ''}
			onchange={(e) => saveSettings({ cardTemplate: e.currentTarget.value })}></textarea>
	</div>
</div>
