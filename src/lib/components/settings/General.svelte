<script lang="ts">
	import { saveSettings, settings } from '#lib/data.svelte.ts';
	import { askNotificationPermission } from '#lib/notify.ts';
	import Bell from '@lucide/svelte/icons/bell';
	import Check from '@lucide/svelte/icons/check';
	import Download from '@lucide/svelte/icons/download';
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';
	import { toast } from 'svelte-sonner';
	import { Switch } from '#lib/components/ui/switch/index.ts';
	import { BUILT, MODULES, isOn, on as ready, requires } from '#modules/registry.ts';
	import { card, h2, h3, tabPanel } from './styles.ts';

	const s = $derived(settings());
	const btn =
		'flex h-8.5 items-center gap-1.5 rounded-lg border border-line2 px-3 font-medium disabled:text-muted-foreground [&_svg]:size-4';
	const row = 'flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 [&+&]:border-t';

	const perm = () =>
		typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
	let permission = $state(perm());
	async function allow() {
		await askNotificationPermission();
		permission = perm();
	}

	let backingUp = $state(false);
	async function downloadBackup() {
		backingUp = true;
		try {
			const res = await fetch('/api/backup');
			if (!res.ok) throw new Error((await res.text()) || res.statusText);
			const name =
				res.headers.get('content-disposition')?.match(/filename="(.+?)"/)?.[1] ?? 'planner.db';
			const a = Object.assign(document.createElement('a'), {
				href: URL.createObjectURL(await res.blob()),
				download: name
			});
			a.click();
			setTimeout(() => URL.revokeObjectURL(a.href), 1000);
		} catch (e) {
			toast.error('Backup download failed', { description: (e as Error).message });
		} finally {
			backingUp = false;
		}
	}
</script>

<div role="tabpanel" aria-labelledby="h-general" class={tabPanel}>
	<h2 id="h-general" class="{h2} pr-9">General</h2>
	<div class={card}>
		<div class={row}>
			<div class="min-w-0 flex-[1_1_160px]">
				<div id="g-week" class="font-medium">First day of week</div>
				<div class="text-muted-foreground">
					Used by the week view, the month view and every date picker.
				</div>
			</div>
			<div role="group" aria-labelledby="g-week" class="flex rounded-[9px] bg-muted p-[3px]">
				{#each [[1, 'Monday'], [0, 'Sunday'], [6, 'Saturday']] as const as [d, label] (d)}
					{@const on = (s.firstDay ?? 1) === d}
					<button
						aria-pressed={on}
						class="h-7 rounded-md px-3 {on
							? 'bg-background font-medium shadow-[0_1px_2px_rgba(0,0,0,.12)]'
							: 'text-muted-foreground'}"
						onclick={() => saveSettings({ firstDay: d })}>{label}</button
					>
				{/each}
			</div>
		</div>
		<div class={row}>
			<div class="min-w-0 flex-[1_1_160px]">
				<div class="font-medium">Notifications</div>
				<div class="text-muted-foreground">
					Reminders and the pomodoro reach you while the tab is in the background.
				</div>
			</div>
			{#if permission === 'granted'}
				<span role="status" class="flex h-8.5 items-center gap-1.5 font-medium"
					><Check class="size-4" />Allowed in this browser</span
				>
			{:else if permission === 'denied'}
				<span role="status" class="flex h-8.5 items-center text-muted-foreground"
					>Blocked in this browser's site settings</span
				>
			{:else if permission === 'unsupported'}
				<span class="flex h-8.5 items-center text-muted-foreground">Not supported here</span>
			{:else}
				<button class={btn} onclick={allow}><Bell />Allow notifications</button>
			{/if}
		</div>
		<div class={row}>
			<div class="min-w-0 flex-[1_1_160px]">
				<div class="font-medium">Backup</div>
				<div class="text-muted-foreground">Everything in the Planner as one database file.</div>
			</div>
			<button class={btn} disabled={backingUp} aria-busy={backingUp} onclick={downloadBackup}>
				{#if backingUp}<LoaderCircle class="animate-spin" />Preparing snapshot…{:else}<Download
					/>Download database snapshot{/if}
			</button>
		</div>
	</div>
	<h3 class="{h3} mt-2">Features</h3>
	<div class={card}>
		<!-- only the modules in this build (MODULES build arg) -->
		{#each BUILT as id (id)}
			{@const f = MODULES[id]}
			{@const needs = requires(id).filter((r) => !ready(s, r))}
			<div class="flex items-center gap-4 px-4 py-2.5 [&+&]:border-t">
				<div class="min-w-0 flex-1">
					<label for="f-{id}" class="font-medium">{f.label}</label>
					<div class="text-muted-foreground">
						{f.hint}{#if needs.length}&nbsp;(needs {needs
								.map((r) => MODULES[r].label)
								.join(', ')}){/if}
					</div>
				</div>
				<Switch
					id="f-{id}"
					checked={isOn(s, id) && !needs.length}
					disabled={!!needs.length}
					onCheckedChange={(v) => saveSettings({ features: { ...s.features, [id]: v } })}
				/>
			</div>
		{/each}
	</div>
	<p class="m-0 text-[12px] text-muted-foreground">
		Switching a part off hides it everywhere and stops its syncing; nothing is deleted.
	</p>
</div>
