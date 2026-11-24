<script lang="ts">
	import { saveSettings, settings } from '#lib/data.svelte.ts';
	import { area, h2, tabPanel } from '#lib/components/settings/styles.ts';

	const s = $derived(settings());
</script>

<div role="tabpanel" aria-labelledby="h-tpl" class="{tabPanel} gap-5">
	<h2 id="h-tpl" class="{h2} pr-9">Templates</h2>
	<div class="flex flex-col gap-2">
		<div>
			<label for="t-daily" class="block font-medium">Daily note template</label>
			<div class="text-muted-foreground">Markdown that every new daily note starts with.</div>
		</div>
		<textarea
			id="t-daily"
			spellcheck="false"
			class="{area} h-42"
			value={s.dailyTemplate}
			onchange={(e) => saveSettings({ dailyTemplate: e.currentTarget.value })}></textarea>
	</div>
</div>
