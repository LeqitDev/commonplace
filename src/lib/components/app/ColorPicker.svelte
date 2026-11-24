<script lang="ts">
	// Swatch button + popover: preset palette, recently used, saturation/value area + hue slider,
	// hex field (replaces <input type="color">). Dragging previews locally, commits on release.
	import * as Popover from '#lib/components/ui/popover/index.ts';
	import { Input } from '#lib/components/ui/input/index.ts';
	import { cn } from '#lib/utils.ts';

	let {
		value,
		onchange,
		title = 'Colour',
		mark,
		class: className
	}: {
		value?: string;
		onchange: (c: string) => void;
		title?: string;
		/** Trigger as a dot or ring inside a 34px button (default: a filled swatch). */
		mark?: 'dot' | 'ring';
		class?: string;
	} = $props();

	let open = $state(false);
	// prettier-ignore
	const COLORS = [
		'#ef4444', '#f97316', '#f59e0b', '#84cc16', '#22c55e', '#14b8a6', '#06b6d4', '#0ea5e9',
		'#3b82f6', '#6366f1', '#8b5cf6', '#a855f7', '#ec4899', '#f43f5e', '#888888', '#404040'
	];
	const RECENT_KEY = 'recentColors';
	const readRecent = (): string[] => {
		try {
			return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
		} catch {
			return [];
		}
	};
	let recent = $state(readRecent());

	// --- HSV <-> hex (h 0..360, s/v 0..1)
	function toHsv(hex: string) {
		const n = parseInt(hex.slice(1), 16);
		const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((x) => x / 255);
		const max = Math.max(r, g, b);
		const d = max - Math.min(r, g, b);
		const h = !d
			? 0
			: max === r
				? ((g - b) / d + 6) % 6
				: max === g
					? (b - r) / d + 2
					: (r - g) / d + 4;
		return { h: h * 60, s: max ? d / max : 0, v: max };
	}
	function toHex({ h, s, v }: { h: number; s: number; v: number }) {
		const f = (n: number) => {
			const k = (n + h / 60) % 6;
			return Math.round((v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255);
		};
		return '#' + [f(5), f(3), f(1)].map((x) => x.toString(16).padStart(2, '0')).join('');
	}

	const valid = (c?: string) => !!c && /^#[0-9a-f]{6}$/i.test(c);
	let hsv = $state(toHsv('#888888')); // synced from `value` by the effect below
	const current = $derived(toHex(hsv));
	// follow outside changes while the popover is closed
	$effect(() => {
		if (!open && valid(value)) hsv = toHsv(value!);
	});

	function commit(c: string) {
		c = c.toLowerCase();
		recent = [c, ...recent.filter((x) => x !== c)].slice(0, 8);
		try {
			localStorage.setItem(RECENT_KEY, JSON.stringify(recent));
		} catch {
			/* storage unavailable */
		}
		onchange(c);
	}
	function pick(c: string) {
		hsv = toHsv(c);
		commit(c);
		open = false;
	}

	/** Pointer drag on an element: `set` gets the relative position (0..1) on every move. */
	function drag(set: (x: number, y: number) => void) {
		return (e: PointerEvent) => {
			const el = e.currentTarget as HTMLElement;
			el.setPointerCapture(e.pointerId);
			const move = (ev: PointerEvent) => {
				const r = el.getBoundingClientRect();
				const clamp = (n: number) => Math.min(1, Math.max(0, n));
				set(clamp((ev.clientX - r.left) / r.width), clamp((ev.clientY - r.top) / r.height));
			};
			const up = () => {
				el.removeEventListener('pointermove', move);
				commit(current);
			};
			move(e);
			el.addEventListener('pointermove', move);
			el.addEventListener('pointerup', up, { once: true });
		};
	}
</script>

{#snippet swatch(c: string)}
	<button
		class={cn(
			'size-5 rounded-full ring-offset-2 ring-offset-popover',
			c === value?.toLowerCase() && 'ring-2 ring-ring'
		)}
		style="background: {c}"
		title={c}
		aria-label={c}
		onclick={() => pick(c)}
	></button>
{/snippet}

<Popover.Root bind:open>
	{#if mark}
		<!-- a dot (or ring, for feeds) in a control-sized button -->
		<Popover.Trigger
			class={cn(
				'flex size-8.5 shrink-0 items-center justify-center rounded-lg hover:bg-muted',
				className
			)}
			{title}
			aria-label={title}
		>
			<span
				class="size-3.5 rounded-full"
				style={mark === 'ring'
					? `border: 2.5px solid ${value ?? 'var(--line2)'}`
					: `background: ${value ?? 'var(--line2)'}`}
			></span>
		</Popover.Trigger>
	{:else}
		<Popover.Trigger
			class={cn('size-5 shrink-0 rounded-full border border-border', className)}
			style="background: {value ?? 'transparent'}"
			{title}
			aria-label={title}
		/>
	{/if}
	<Popover.Content class="w-auto p-2" align="start">
		<div class="grid grid-cols-8 gap-1.5">
			{#each COLORS as c (c)}{@render swatch(c)}{/each}
		</div>
		{#if recent.length}
			<div class="mt-2 grid grid-cols-8 gap-1.5 border-t border-border pt-2">
				{#each recent as c (c)}{@render swatch(c)}{/each}
			</div>
		{/if}
		<!-- saturation (x) / value (y) area for the current hue (pointer only; the hex field is the keyboard path) -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="relative mt-2 h-28 w-full cursor-crosshair touch-none rounded-md"
			style="background: linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl({hsv.h} 100% 50%))"
			data-testid="sv-area"
			onpointerdown={drag((x, y) => (hsv = { ...hsv, s: x, v: 1 - y }))}
		>
			<div
				class="pointer-events-none absolute size-3 -translate-1/2 rounded-full border-2 border-white shadow"
				style="left: {hsv.s * 100}%; top: {(1 - hsv.v) * 100}%; background: {current}"
			></div>
		</div>
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="relative mt-2 h-3 w-full cursor-pointer touch-none rounded-full"
			style="background: linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)"
			data-testid="hue"
			onpointerdown={drag((x) => (hsv = { ...hsv, h: x * 360 }))}
		>
			<div
				class="pointer-events-none absolute top-1/2 size-3.5 -translate-1/2 rounded-full border-2 border-white shadow"
				style="left: {(hsv.h / 360) * 100}%; background: hsl({hsv.h} 100% 50%)"
			></div>
		</div>
		<div class="mt-2 flex items-center gap-2">
			<div
				class="size-7 shrink-0 rounded-md border border-border"
				style="background: {current}"
			></div>
			<Input
				class="h-7 font-mono text-xs"
				value={current}
				placeholder="#rrggbb"
				onchange={(e) => {
					const v = e.currentTarget.value.trim();
					if (valid(v)) pick(v);
				}}
			/>
		</div>
	</Popover.Content>
</Popover.Root>
