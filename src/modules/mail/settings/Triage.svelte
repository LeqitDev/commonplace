<script lang="ts">
	// Mail triage: the decision model on this device (LM Studio), and who the mail is for (shared).
	import { Switch } from '#lib/components/ui/switch/index.ts';
	import { saveSettings, settings } from '#lib/data.svelte.ts';
	import {
		device,
		drain,
		listModels,
		refreshStatus,
		runAgain,
		saveDevice,
		testModel,
		triage
	} from '#modules/mail/triage/triage.svelte.ts';
	import { DEFAULT_MODEL, DEFAULT_URL } from '#modules/mail/triage/triage.ts';
	import { confirmAction } from '#lib/choice.svelte.ts';
	import Check from '@lucide/svelte/icons/check';
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import { card, h3, input, quiet, soft } from '#lib/components/settings/styles.ts';

	let testing = $state(false);
	let tested = $state<{ ok: true; ms: number } | { ok: false; error: string } | null>(null);
	let models = $state<string[]>([]);
	let about = $state(settings().triage?.about ?? '');

	$effect(() => {
		void refreshStatus().catch(() => {});
	});
	$effect(() => {
		const url = device.url;
		void listModels(url).then((m) => url === device.url && (models = m));
	});

	async function test() {
		testing = true;
		tested = null;
		try {
			tested = { ok: true, ms: await testModel() };
		} catch (e) {
			tested = { ok: false, error: (e as Error).message };
		} finally {
			testing = false;
		}
		// the click may just have granted local network access: the list of models works now too
		models = await listModels(device.url);
	}
	async function toggle(on: boolean) {
		saveDevice({ on });
		if (on) {
			await test();
			void drain();
		}
	}
	async function again() {
		const ok = await confirmAction(
			'Ask the model again?',
			`The answers about the last two weeks of inbox mail are dropped and asked again${device.on ? ' by this device' : ' by a device that has the model'}.`,
			'Run again'
		);
		if (ok) await runAgain();
	}
	const row = 'flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 [&+&]:border-t';
</script>

<h3 class="{h3} mt-2">Triage</h3>
<div class={card}>
	<div class={row}>
		<div class="min-w-0 flex-[1_1_220px]">
			<label for="tr-on" class="font-medium">Triage new mail with a local model</label>
			<div class="text-muted-foreground">
				On this device only: the model runs on this computer (LM Studio) while a tab is open, and
				the answers are saved for every device.
			</div>
		</div>
		<Switch id="tr-on" checked={device.on} onCheckedChange={toggle} />
	</div>
	<div class="{row} grid! grid-cols-[76px_minmax(0,1fr)] gap-y-2!">
		<label for="tr-url" class="text-muted-foreground">Server</label>
		<input
			id="tr-url"
			class={input}
			value={device.url}
			placeholder={DEFAULT_URL}
			onchange={(e) => saveDevice({ url: e.currentTarget.value.trim() || DEFAULT_URL })}
		/>
		<label for="tr-model" class="text-muted-foreground">Model</label>
		<input
			id="tr-model"
			class={input}
			list="tr-models"
			value={device.model}
			placeholder={DEFAULT_MODEL}
			onchange={(e) => saveDevice({ model: e.currentTarget.value.trim() || DEFAULT_MODEL })}
		/>
		<datalist id="tr-models">
			{#each models as m (m)}<option value={m}></option>{/each}
		</datalist>
		<label for="tr-key" class="text-muted-foreground">API token</label>
		<input
			id="tr-key"
			class={input}
			type="password"
			autocomplete="off"
			placeholder="only if LM Studio asks for one"
			value={device.key ?? ''}
			onchange={(e) => saveDevice({ key: e.currentTarget.value.trim() || undefined })}
		/>
	</div>
	<div class="{row} text-[13px]">
		<button class={soft} disabled={testing} onclick={test}>
			{#if testing}<LoaderCircle class="inline size-3.5 animate-spin" />{/if} Test
		</button>
		{#if tested?.ok}
			<span role="status" class="flex items-center gap-1.5"
				><Check class="size-4" />Answers in {tested.ms} ms</span
			>
		{:else if tested}
			<span role="status" class="flex min-w-0 flex-1 items-center gap-1.5 text-muted-foreground"
				><TriangleAlert class="size-4 shrink-0" />{tested.error}</span
			>
		{/if}
		<span class="flex-1"></span>
		<span class="text-muted-foreground tabular-nums" role="status">
			{#if triage.running}
				<LoaderCircle class="mr-1 inline size-3.5 animate-spin" />Triaging · {triage.waiting} waiting
			{:else}
				{triage.total} triaged{#if triage.waiting}
					· {triage.waiting} waiting{/if}
			{/if}
			{#if triage.ms}· {(triage.ms / 1000).toFixed(1)} s per mail{/if}
		</span>
		<button class={quiet} onclick={again}>Run again</button>
	</div>
	{#if triage.error && device.on}
		<div class="{row} text-[13px] text-muted-foreground">
			<TriangleAlert class="size-4 shrink-0" /><span class="min-w-0 flex-1">{triage.error}</span>
			<button class={soft} onclick={() => drain()}>Retry</button>
		</div>
	{/if}
	<div class="{row} items-start!">
		<div class="min-w-0 flex-[1_1_100%]">
			<label for="tr-about" class="font-medium">About you</label>
			<div class="text-muted-foreground">
				Told to the model with every mail, so it can judge what concerns you.
			</div>
		</div>
		<textarea
			id="tr-about"
			class="{input} h-auto min-h-16 w-full flex-[1_1_100%] py-2"
			placeholder="Computer science master's student; student assistant at a systems chair"
			bind:value={about}
			onchange={() => saveSettings({ triage: { ...settings().triage, about: about.trim() } })}
		></textarea>
	</div>
</div>
<p class="m-0 text-[11.5px] text-muted-foreground">
	Mail of the last two weeks is triaged. In LM Studio, load the model and start the server (its CORS
	setting must be on). Chrome asks once to let this site reach the local network; Safari blocks it,
	use Chrome or Firefox. {#if triage.labels}{triage.labels} mails have corrected answers: evaluate them
		with <code>bun scripts/triage-eval.ts</code>.{/if}
</p>
