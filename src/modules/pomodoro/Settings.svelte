<script lang="ts">
	import { saveSettings, settings } from '#lib/data.svelte.ts';
	import { card, h2, tabPanel } from '#lib/components/settings/styles.ts';

	const s = $derived(settings());
	const rows = [
		['work', 'Focus', 'min'],
		['short', 'Short break', 'min'],
		['long', 'Long break', 'min'],
		['every', 'Long break every', 'rounds']
	] as const;
</script>

<div role="tabpanel" aria-labelledby="h-pomo" class={tabPanel}>
	<h2 id="h-pomo" class="{h2} pr-9">Pomodoro</h2>
	<div class={card}>
		{#each rows as [k, label, unit] (k)}
			<div class="flex h-13 items-center gap-2 border-t px-4 first:border-t-0">
				<label for="p-{k}" class="flex-1 font-medium">{label}</label>
				<input
					id="p-{k}"
					type="number"
					min="1"
					class="h-8.5 w-14 rounded-lg border border-line2 bg-transparent text-center tabular-nums outline-none focus-visible:border-foreground"
					value={s.pomodoro[k]}
					onchange={(e) =>
						saveSettings({
							pomodoro: { ...s.pomodoro, [k]: Math.max(1, Number(e.currentTarget.value) || 1) }
						})}
				/>
				<span class="w-12 text-muted-foreground">{unit}</span>
			</div>
		{/each}
	</div>
</div>
