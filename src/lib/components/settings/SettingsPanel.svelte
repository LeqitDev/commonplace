<script lang="ts">
	// Settings: a floating panel (no scrim) with vertical tabs; changes save as they are made.
	import FloatingPanel from '#lib/components/app/FloatingPanel.svelte';
	import { slot } from '#lib/slots.svelte.ts';
	import type { SettingsTab } from '#lib/modules.ts';
	import { ui } from '#lib/ui.svelte.ts';
	import SlidersHorizontal from '@lucide/svelte/icons/sliders-horizontal';
	import Tag from '@lucide/svelte/icons/tag';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import X from '@lucide/svelte/icons/x';
	import Categories from './Categories.svelte';
	import General from './General.svelte';

	const CORE: SettingsTab[] = [
		{ id: 'general', label: 'General', icon: SlidersHorizontal, component: General, order: 0 },
		{ id: 'categories', label: 'Categories', icon: Tag, component: Categories, order: 10 }
	];
	// the modules' tabs (only of those that are on); one tab per id (Calendars comes from two)
	const tabs = $derived(
		[...CORE, ...slot('settingsTabs')]
			.filter((t, i, all) => all.findIndex((x) => x.id === t.id) === i)
			.sort((a, b) => a.order - b.order)
			.map((t) => ({ ...t, warning: t.warn?.() }))
	);
	const shown = $derived(tabs.find((t) => t.id === ui.settings) ?? tabs[0]);

	const close = () => (ui.settings = null);

	/** Arrow keys move between the tabs (vertical tablist). */
	function onkeydown(e: KeyboardEvent) {
		const step = { ArrowDown: 1, ArrowUp: -1 }[e.key];
		if (!step || !ui.settings) return;
		e.preventDefault();
		const i = tabs.findIndex((t) => t.id === ui.settings);
		ui.settings = tabs[(i + step + tabs.length) % tabs.length].id;
		requestAnimationFrame(() =>
			(e.currentTarget as HTMLElement | null)
				?.querySelector<HTMLElement>('[aria-selected=true]')
				?.focus()
		);
	}
</script>

{#if ui.settings}
	<FloatingPanel key="settings" label="Settings" width={860} onclose={close} overlayHandle>
		<div class="relative flex h-160 min-h-0 overflow-hidden rounded-[14px]">
			<button
				aria-label="Close settings"
				class="absolute top-3.5 right-3 z-10 flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
				onclick={close}><X class="size-4" /></button
			>

			<div
				class="flex min-w-32 flex-[0_1_196px] flex-col gap-0.5 border-r bg-panel px-2.5 pt-4 pb-3.5"
			>
				<div id="st-title" class="flex h-7.5 items-center px-2.5 text-[15px] font-semibold">
					Settings
				</div>
				<!-- svelte-ignore a11y_interactive_supports_focus -->
				<div
					role="tablist"
					aria-orientation="vertical"
					aria-labelledby="st-title"
					class="flex flex-col gap-0.5"
					{onkeydown}
				>
					{#each tabs as t (t.id)}
						{@const on = shown.id === t.id}
						<button
							role="tab"
							aria-selected={on}
							tabindex={on ? 0 : -1}
							class="flex h-8.5 items-center gap-2.5 rounded-lg px-2.5 text-left {on
								? 'bg-muted font-medium'
								: 'hover:bg-muted/60'}"
							onclick={() => (ui.settings = t.id)}
						>
							<t.icon class="size-4 shrink-0" />
							<span class="flex-1 truncate">{t.label}</span>
							{#if t.warning}
								<TriangleAlert class="size-3.25 shrink-0" role="img" aria-label={t.warning} />
							{/if}
						</button>
					{/each}
				</div>
				<div class="flex-1"></div>
				<p class="m-0 px-2.5 text-[11.5px] text-muted-foreground">
					Changes are saved as you make them.
				</p>
			</div>

			<div class="min-w-0 flex-1 overflow-y-auto">
				<shown.component />
			</div>
		</div>
	</FloatingPanel>
{/if}
