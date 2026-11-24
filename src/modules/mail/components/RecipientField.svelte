<script lang="ts">
	// Addresses as chips; typing suggests addresses seen in the mail. Enter, comma or leaving the
	// field adds what was typed; Backspace in the empty field takes the last chip back.
	import { api } from '#lib/data.svelte.ts';
	import { addrOf, formatAddr } from '#modules/mail/mail.ts';
	import X from '@lucide/svelte/icons/x';

	let {
		label,
		value,
		onchange,
		autofocus = false
	}: {
		label: string;
		value: string[];
		onchange: (v: string[]) => void;
		autofocus?: boolean;
	} = $props();
	let text = $state('');
	let hits = $state<{ name: string; address: string }[]>([]);
	let active = $state(0);
	let timer: ReturnType<typeof setTimeout>;

	$effect(() => {
		const q = text.trim();
		clearTimeout(timer);
		if (q.length < 2) return void (hits = []);
		timer = setTimeout(async () => {
			const r = await api<{ name: string; address: string }[]>(
				`/api/mail/contacts?q=${encodeURIComponent(q)}`
			).catch(() => []);
			hits = r.filter((h) => !value.some((v) => addrOf(v) === h.address));
			active = 0;
		}, 150);
	});

	function add(s: string) {
		const parts = s
			.split(/[,;]/)
			.map((p) => p.trim())
			.filter((p) => /@/.test(p));
		const next = [...value, ...parts.filter((p) => !value.some((v) => addrOf(v) === addrOf(p)))];
		if (next.length !== value.length) onchange(next);
		text = '';
		hits = [];
	}
	function onkeydown(e: KeyboardEvent) {
		if (hits.length && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
			e.preventDefault();
			active = (active + (e.key === 'ArrowDown' ? 1 : hits.length - 1)) % hits.length;
		} else if ((e.key === 'Enter' || e.key === 'Tab') && hits.length && text.trim()) {
			e.preventDefault();
			add(formatAddr(hits[active]));
		} else if ((e.key === 'Enter' || e.key === ',' || e.key === ';') && text.trim()) {
			e.preventDefault();
			add(text);
		} else if (e.key === 'Backspace' && !text && value.length) {
			text = value.at(-1)!;
			onchange(value.slice(0, -1));
			e.preventDefault();
		}
	}
	const short = (v: string) => v.match(/^(.*?)\s*</)?.[1] || v;
</script>

<div class="relative flex min-h-9 items-center gap-2 border-b px-4">
	<span class="w-12 shrink-0 text-muted-foreground">{label}</span>
	<div class="flex min-w-0 flex-1 flex-wrap items-center gap-1 py-1">
		{#each value as v (v)}
			<span
				class="flex h-6 items-center gap-0.5 rounded-full bg-muted pr-1 pl-2.5 text-xs"
				title={v}
			>
				{short(v)}
				<button
					class="grid size-4 place-items-center rounded-full text-muted-foreground hover:text-foreground"
					aria-label="Remove {v}"
					onclick={() => onchange(value.filter((x) => x !== v))}><X class="size-3" /></button
				>
			</span>
		{/each}
		<!-- svelte-ignore a11y_autofocus -->
		<input
			class="h-7 min-w-32 flex-1 bg-transparent outline-none"
			aria-label={label}
			bind:value={text}
			{autofocus}
			{onkeydown}
			onblur={() => setTimeout(() => text.trim() && add(text), 150)}
		/>
	</div>
	{#if hits.length}
		<div
			class="absolute top-full left-16 z-50 mt-1 w-80 overflow-hidden rounded-lg border bg-popover py-1 shadow-panel"
			role="listbox"
		>
			{#each hits as h, i (h.address)}
				<button
					role="option"
					aria-selected={i === active}
					class="flex w-full flex-col px-3 py-1.5 text-left {i === active ? 'bg-muted' : ''}"
					onmousedown={(e) => {
						e.preventDefault();
						add(formatAddr(h));
					}}
				>
					<span class="truncate">{h.name || h.address}</span>
					{#if h.name}<span class="truncate text-xs text-muted-foreground">{h.address}</span>{/if}
				</button>
			{/each}
		</div>
	{/if}
</div>
