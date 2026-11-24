<script lang="ts">
	// The canvas' compact bar for touch devices: pen presets, eraser, select, undo/redo. It replaces
	// Excalidraw's own UI there (CanvasEditor does the wiring).
	import { Button } from '#lib/components/ui/button/index.ts';
	import { Slider } from '#lib/components/ui/slider/index.ts';
	import { Switch } from '#lib/components/ui/switch/index.ts';
	import * as Popover from '#lib/components/ui/popover/index.ts';
	import ColorPicker from '#lib/components/app/ColorPicker.svelte';
	import { cn } from '#lib/utils.ts';
	import type { Pen } from '#lib/canvas.ts';
	import Eraser from '@lucide/svelte/icons/eraser';
	import MousePointer from '@lucide/svelte/icons/mouse-pointer-2';
	import Plus from '@lucide/svelte/icons/plus';
	import Redo from '@lucide/svelte/icons/redo-2';
	import Shapes from '@lucide/svelte/icons/shapes';
	import Undo from '@lucide/svelte/icons/undo-2';

	export type PenTool = number | 'eraser' | 'selection' | null;
	let {
		pens,
		tool,
		onpen,
		ontool,
		onpens,
		onundo,
		onredo,
		onfull
	}: {
		pens: Pen[];
		/** Index of the active pen, or the active tool. */
		tool: PenTool;
		onpen: (i: number) => void;
		ontool: (t: 'eraser' | 'selection') => void;
		/** Presets changed; `use` = the pen to activate afterwards. */
		onpens: (pens: Pen[], use: number) => void;
		onundo: () => void;
		onredo: () => void;
		onfull: () => void;
	} = $props();

	let editing = $state(false);
	const patch = (i: number, p: Partial<Pen>) =>
		onpens(
			pens.map((pen, j) => (j === i ? { ...pen, ...p } : pen)),
			i
		);
	function add() {
		const from = typeof tool === 'number' ? tool : pens.length - 1;
		onpens(
			[...pens.slice(0, from + 1), { ...pens[from] }, ...pens.slice(from + 1)],
			Math.min(from + 1, pens.length)
		);
	}
	function remove(i: number) {
		editing = false;
		onpens(
			pens.filter((_, j) => j !== i),
			Math.max(0, i - 1)
		);
	}
	// Excalidraw inverts the canvas colours in dark mode; the dots show what will be drawn
	const inverted = 'dark:[filter:invert(93%)_hue-rotate(180deg)]';
	const item = 'grid size-8 shrink-0 place-items-center rounded-md hover:bg-accent';
</script>

{#snippet dot(pen: Pen)}
	<span
		class={cn('rounded-full', inverted)}
		style="background: {pen.color}; opacity: {Math.max(0.25, pen.opacity / 100)}; width: {4 +
			pen.width * 2}px; height: {4 + pen.width * 2}px"
	></span>
{/snippet}

<div
	class="absolute top-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-0.5 rounded-md border bg-background/90 p-1 shadow-sm"
	data-testid="pen-bar"
>
	{#each pens as pen, i (i)}
		{#if i === tool}
			<Popover.Root bind:open={editing}>
				<Popover.Trigger class={cn(item, 'bg-accent ring-1 ring-ring')} title="Pen settings">
					{@render dot(pen)}
				</Popover.Trigger>
				<Popover.Content
					class="grid w-64 grid-cols-[4rem_1fr] items-center gap-x-2 gap-y-3 text-xs"
				>
					<span class="text-muted-foreground">Colour</span>
					<ColorPicker
						value={pen.color}
						class={inverted}
						onchange={(color) => patch(i, { color })}
					/>
					<span class="text-muted-foreground">Width</span>
					<Slider
						type="single"
						value={pen.width}
						min={0.5}
						max={8}
						step={0.5}
						aria-label="Width"
						onValueCommit={(width) => patch(i, { width })}
					/>
					<span class="text-muted-foreground">Opacity</span>
					<Slider
						type="single"
						value={pen.opacity}
						min={10}
						max={100}
						step={5}
						aria-label="Opacity"
						onValueCommit={(opacity) => patch(i, { opacity })}
					/>
					<span class="text-muted-foreground">Pressure</span>
					<label class="flex items-center gap-2">
						<Switch checked={pen.pressure} onCheckedChange={(pressure) => patch(i, { pressure })} />
						<span>{pen.pressure ? 'Follows pressure' : 'Even width'}</span>
					</label>
					{#if pens.length > 1}
						<Button class="col-span-2" size="xs" variant="outline" onclick={() => remove(i)}
							>Remove pen</Button
						>
					{/if}
				</Popover.Content>
			</Popover.Root>
		{:else}
			<button class={item} title="Pen {i + 1}" onclick={() => onpen(i)}>{@render dot(pen)}</button>
		{/if}
	{/each}
	<Button size="icon-sm" variant="ghost" title="Add pen" onclick={add}><Plus /></Button>
	<span class="mx-1 h-5 w-px bg-border"></span>
	<Button
		size="icon-sm"
		variant={tool === 'eraser' ? 'secondary' : 'ghost'}
		title="Eraser"
		onclick={() => ontool('eraser')}><Eraser /></Button
	>
	<Button
		size="icon-sm"
		variant={tool === 'selection' ? 'secondary' : 'ghost'}
		title="Select"
		onclick={() => ontool('selection')}><MousePointer /></Button
	>
	<span class="mx-1 h-5 w-px bg-border"></span>
	<Button size="icon-sm" variant="ghost" title="Undo" onclick={onundo}><Undo /></Button>
	<Button size="icon-sm" variant="ghost" title="Redo" onclick={onredo}><Redo /></Button>
	<span class="mx-1 h-5 w-px bg-border"></span>
	<Button size="icon-sm" variant="ghost" title="All tools" onclick={onfull}><Shapes /></Button>
</div>
