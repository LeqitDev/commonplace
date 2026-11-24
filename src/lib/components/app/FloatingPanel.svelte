<script lang="ts">
	// A panel that floats over the page without a scrim, docked to a corner of the window. The grab
	// handle on top moves it; on release it snaps to the nearest corner (remembered per `key`).
	import type { Snippet } from 'svelte';

	type Corner = 'top left' | 'top right' | 'bottom left' | 'bottom right';
	let {
		key,
		label,
		width = 400,
		onclose,
		overlayHandle = false,
		full = false,
		children
	}: {
		key: string;
		label: string;
		width?: number;
		onclose: () => void;
		/** The grab handle lies over the content's top edge instead of taking a row of its own. */
		overlayHandle?: boolean;
		/** Fills the window instead of docking to a corner. */
		full?: boolean;
		children: Snippet;
	} = $props();

	const storeKey = $derived(`panel:${key}`);
	const read = (k: string) => {
		try {
			return localStorage.getItem(k) as Corner | null;
		} catch {
			return null;
		}
	};
	let corner = $derived<Corner>(read(storeKey) ?? 'top right');
	let drag: { x: number; y: number; dx: number; dy: number } | null = $state(null);
	let el: HTMLElement | undefined = $state();

	// top corners leave the page header (60px) free
	const pos = $derived.by(() => {
		const [v, h] = corner.split(' ');
		return `${v === 'top' ? 'top: 76px' : 'bottom: 16px'}; ${h}: 16px`;
	});

	function down(e: PointerEvent) {
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		drag = { x: e.clientX, y: e.clientY, dx: 0, dy: 0 };
	}
	function move(e: PointerEvent) {
		if (drag) Object.assign(drag, { dx: e.clientX - drag.x, dy: e.clientY - drag.y });
	}
	function up() {
		if (!drag || !el) return;
		const r = el.getBoundingClientRect();
		const v = r.top + r.height / 2 < innerHeight / 2 ? 'top' : 'bottom';
		const h = r.left + r.width / 2 < innerWidth / 2 ? 'left' : 'right';
		corner = `${v} ${h}`;
		try {
			localStorage.setItem(storeKey, corner);
		} catch {
			/* storage unavailable */
		}
		drag = null;
	}
	// filling the window, it covers what had the focus: take it, so Escape and Tab are the panel's
	$effect(() => {
		if (full && el && !el.contains(document.activeElement)) el.focus();
	});
	function onkeydown(e: KeyboardEvent) {
		// popovers/menus inside handle their own Escape (and portal outside of the panel)
		if (e.key !== 'Escape' || e.defaultPrevented) return;
		const t = e.target as Element | null;
		if (t && t !== document.body && !el?.contains(t)) return;
		e.preventDefault();
		onclose();
	}
</script>

<svelte:window {onkeydown} />

{#if drag}
	<!-- the four corners it can snap to -->
	{#each ['top-[72px] left-3 border-t-2 border-l-2 rounded-tl-[14px]', 'top-[72px] right-3 border-t-2 border-r-2 rounded-tr-[14px]', 'bottom-3 left-3 border-b-2 border-l-2 rounded-bl-[14px]', 'bottom-3 right-3 border-b-2 border-r-2 rounded-br-[14px]'] as c (c)}
		<div
			aria-hidden="true"
			class="pointer-events-none fixed z-40 size-14 border-dashed border-muted-foreground {c}"
		></div>
	{/each}
{/if}

<div
	bind:this={el}
	role="dialog"
	tabindex="-1"
	aria-label={label}
	class="fixed z-40 flex flex-col rounded-[14px] border border-line2 bg-background text-[13px] leading-[1.4] shadow-panel outline-none {full
		? 'inset-4 pt-2'
		: 'max-h-[calc(100svh-92px)] max-w-[calc(100vw-32px)]'}"
	style={full
		? ''
		: `${pos}; width: ${width}px; ${drag ? `transform: translate(${drag.dx}px, ${drag.dy}px)` : ''}`}
>
	{#if !full}<button
			aria-label="Move panel to another corner"
			class="flex h-5 shrink-0 cursor-grab touch-none items-center justify-center rounded-t-[14px] active:cursor-grabbing {overlayHandle
				? 'absolute top-0 left-1/2 z-10 w-40 -translate-x-1/2'
				: ''}"
			onpointerdown={down}
			onpointermove={move}
			onpointerup={up}
			onpointercancel={up}
		>
			<span class="h-1 w-9 rounded-full bg-line2"></span>
		</button>{/if}
	{@render children()}
</div>
