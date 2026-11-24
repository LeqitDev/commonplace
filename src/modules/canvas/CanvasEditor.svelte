<script lang="ts">
	// Excalidraw (React) mounted inside Svelte. Image binaries live in /data/files (keyed by
	// Excalidraw's fileId) so the stored scene stays small.
	import { untrack } from 'svelte';
	import { mode } from 'mode-watcher';
	import { Button } from '#lib/components/ui/button/index.ts';
	import { Switch } from '#lib/components/ui/switch/index.ts';
	import * as ToggleGroup from '#lib/components/ui/toggle-group/index.ts';
	import AppSelect from '#lib/components/app/AppSelect.svelte';
	import PenBar, { type PenTool } from './PenBar.svelte';
	import { saveSettings, settings, upload } from '#lib/data.svelte.ts';
	import { pick } from '#lib/ui.svelte.ts';
	import {
		DEFAULT_PDF_LAYOUT,
		flatten,
		pdfLayout,
		touchMove,
		type PdfLayout,
		type Pen
	} from '#lib/canvas.ts';
	import type { Note } from '#lib/types.ts';
	import type {
		ExcalidrawImperativeAPI,
		BinaryFileData,
		AppState
	} from '@excalidraw/excalidraw/types';
	import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types';
	import FileText from '@lucide/svelte/icons/file-text';
	import FileUp from '@lucide/svelte/icons/file-up';
	import Paperclip from '@lucide/svelte/icons/paperclip';
	import PenLine from '@lucide/svelte/icons/pen-line';

	type Scene = NonNullable<Note['scene']>;
	type PdfPage = { gid: string; page: number; w: number; h: number; layout?: PdfLayout };
	let { scene, onchange }: { scene?: Scene; onchange: (s: Scene) => void } = $props();

	let el: HTMLDivElement;
	let xapi: ExcalidrawImperativeAPI | undefined;
	let lib: typeof import('@excalidraw/excalidraw') | undefined;
	let busy = $state(false);
	const stored = new Set<string>(untrack(() => scene?.fileIds ?? []));

	const toDataURL = (b: Blob) =>
		new Promise<string>((res) => {
			const r = new FileReader();
			r.onload = () => res(r.result as string);
			r.readAsDataURL(b);
		});

	/** Own embeds (/embed/…, /files/…) on the current origin; links are stored absolute, so a
	 * scene made on another host (dev vs prod) still works. */
	function ownUrl(link: string | null | undefined) {
		try {
			const u = new URL(link ?? '', location.origin);
			return /^\/(embed|files)\//.test(u.pathname) ? location.origin + u.pathname + u.search : null;
		} catch {
			return null;
		}
	}

	async function loadFiles(ids: string[]) {
		const files = await Promise.all(
			ids.map(async (id) => {
				const res = await fetch(`/files/${id}`);
				if (!res.ok) return null;
				const blob = await res.blob();
				return {
					id,
					dataURL: await toDataURL(blob),
					mimeType: blob.type,
					created: Date.now()
				} as BinaryFileData;
			})
		);
		return files.filter((f) => f !== null);
	}

	let timer: ReturnType<typeof setTimeout>;
	let lastVersion = -1;
	function changed(elements: readonly ExcalidrawElement[], appState: AppState) {
		if (!xapi || !lib) return;
		trackPdfSelection(elements, appState);
		trackTool(appState);
		const version = lib.getSceneVersion(xapi.getSceneElementsIncludingDeleted());
		if (version === lastVersion) return;
		lastVersion = version;
		clearTimeout(timer);
		timer = setTimeout(save, 800);
	}

	async function save() {
		if (!xapi) return;
		const elements = xapi.getSceneElements();
		const files = xapi.getFiles();
		const used = new Set(
			elements.flatMap((e) => ('fileId' in e && e.fileId ? [e.fileId as string] : []))
		);
		for (const id of used) {
			if (stored.has(id) || !files[id]) continue;
			const blob = await (await fetch(files[id].dataURL)).blob();
			await upload(blob, `${id}`, id);
			stored.add(id);
		}
		const { viewBackgroundColor, gridSize } = xapi.getAppState();
		onchange({
			elements: JSON.parse(JSON.stringify(elements)),
			appState: { viewBackgroundColor, gridSize },
			fileIds: [...used]
		});
	}

	$effect(() => {
		let root: import('react-dom/client').Root | undefined;
		let cancelled = false;
		(async () => {
			(window as unknown as { EXCALIDRAW_ASSET_PATH: string }).EXCALIDRAW_ASSET_PATH = '/';
			const [React, ReactDOM, x] = await Promise.all([
				import('react'),
				import('react-dom/client'),
				import('@excalidraw/excalidraw'),
				import('@excalidraw/excalidraw/index.css')
			]);
			if (cancelled) return;
			lib = x;
			const initial = untrack(() => scene);
			const files = await loadFiles(initial?.fileIds ?? []);
			root = ReactDOM.createRoot(el);
			root.render(
				React.createElement(x.Excalidraw, {
					initialData: {
						// re-measure text (it may have been laid out before Excalidraw's fonts loaded)
						elements: x.restoreElements((initial?.elements ?? []) as never, null, {
							refreshDimensions: true,
							repairBindings: true
						}),
						appState: { ...initial?.appState },
						files: Object.fromEntries(files.map((f) => [f.id, f])),
						scrollToContent: true
					},
					theme: untrack(() => mode.current) ?? 'light',
					excalidrawAPI: (a: ExcalidrawImperativeAPI) => {
						xapi = a;
						a.onPointerUp((active) => active.type === 'freedraw' && setTimeout(evenStroke));
					},
					onChange: changed,
					validateEmbeddable: (url: string) => !!ownUrl(url),
					// Excalidraw sandboxes iframes without allow-same-origin; own pages need cookies + scripts
					renderEmbeddable: (e: { link: string | null }) => {
						const src = ownUrl(e.link);
						return src
							? React.createElement('iframe', {
									src,
									style: { width: '100%', height: '100%', border: 0, borderRadius: 6 }
								})
							: null;
					},
					UIOptions: { canvasActions: { loadScene: false, saveToActiveFile: false } }
				})
			);
		})();
		return () => {
			cancelled = true;
			clearTimeout(timer);
			if (xapi) save();
			root?.unmount();
		};
	});

	// follow the app theme
	$effect(() => {
		const theme = mode.current;
		xapi?.updateScene({ appState: { theme: theme ?? 'light' } });
	});

	// ---- Pen UI (touch devices): our PenBar instead of Excalidraw's tool bar and properties panel
	let penUi = $state(
		(localStorage.getItem('canvasUi') ??
			(matchMedia('(any-pointer: coarse)').matches ? 'pen' : 'full')) === 'pen'
	);
	let tool: PenTool = $state(null);
	let lastPen = 0;
	const pens = $derived(settings().pens);

	function setPenUi(on: boolean) {
		penUi = on;
		localStorage.setItem('canvasUi', on ? 'pen' : 'full');
		if (on) usePen(lastPen);
	}

	function usePen(i: number, all: Pen[] = pens) {
		const pen = all[i];
		if (!xapi || !pen) return;
		lastPen = i;
		tool = i;
		xapi.updateScene({
			appState: {
				currentItemStrokeColor: pen.color,
				currentItemStrokeWidth: pen.width,
				currentItemOpacity: pen.opacity,
				// pen mode: touches don't draw (see `touch`)
				penMode: true,
				penDetected: true
			}
		});
		xapi.setActiveTool({ type: 'freedraw' });
	}

	/** Keep the bar in sync with tools chosen elsewhere (keyboard shortcuts); start with a pen. */
	let started = false;
	function trackTool(appState: AppState) {
		if (!penUi) return;
		if (!started) {
			started = true;
			return usePen(0);
		}
		const t = appState.activeTool.type;
		const next = t === 'freedraw' ? lastPen : t === 'eraser' || t === 'selection' ? t : null;
		if (next !== tool) tool = next;
	}

	/** A pen without pressure: the stroke just drawn gets an even width. */
	function evenStroke() {
		if (!xapi || !lib || !penUi || pens[lastPen]?.pressure !== false) return;
		const all = xapi.getSceneElementsIncludingDeleted();
		const last = all.findLast((e) => e.type === 'freedraw' && !e.isDeleted);
		const flat = last?.type === 'freedraw' && flatten(last);
		if (!flat) return;
		xapi.updateScene({
			elements: all.map((e) => (e === last ? lib!.newElementWith(last, flat) : e)),
			captureUpdate: lib.CaptureUpdateAction.NEVER
		});
	}

	/** Excalidraw's API has no undo: use its (hidden) buttons, else its shortcut. */
	function history(redo: boolean) {
		const button = el.querySelector<HTMLButtonElement>(
			`[data-testid="button-${redo ? 'redo' : 'undo'}"]`
		);
		if (button) return button.click();
		el.querySelector('.excalidraw-container, .excalidraw')?.dispatchEvent(
			new KeyboardEvent('keydown', {
				key: 'z',
				code: 'KeyZ',
				ctrlKey: true,
				shiftKey: redo,
				bubbles: true
			})
		);
	}

	/** Fingers move and zoom the canvas while a pen or the eraser is active (only the pencil draws).
	 * Excalidraw's pen mode ignores one finger and doesn't zoom with two, so we do it and keep the
	 * touches from it. With the select tool, touches are Excalidraw's. A hand resting on the screen
	 * while the pencil is down moves nothing. */
	const fingers = new Map<number, { x: number; y: number }>();
	let pencilDown = false;
	function touch(e: PointerEvent) {
		if (e.pointerType === 'pen')
			pencilDown = e.buttons > 0 && e.type !== 'pointerup' && e.type !== 'pointercancel';
		if (e.pointerType !== 'touch' || !xapi) return;
		const held = fingers.has(e.pointerId);
		if (e.type === 'pointerdown') {
			const onCanvas = e.target instanceof HTMLCanvasElement && el.contains(e.target);
			if (!penUi || !onCanvas || (typeof tool !== 'number' && tool !== 'eraser')) return;
		} else if (!held) return;
		e.stopPropagation();
		const prev = [...fingers.values()];
		if (e.type === 'pointerup' || e.type === 'pointercancel')
			return void fingers.delete(e.pointerId);
		const { offsetLeft, offsetTop, scrollX, scrollY, zoom } = xapi.getAppState();
		fingers.set(e.pointerId, { x: e.clientX - offsetLeft, y: e.clientY - offsetTop });
		if (!held || fingers.size > 2 || pencilDown) return;
		const view = touchMove({ scrollX, scrollY, zoom: zoom.value }, prev, [...fingers.values()]);
		xapi.updateScene({
			appState: {
				scrollX: view.scrollX,
				scrollY: view.scrollY,
				zoom: { value: view.zoom as never }
			}
		});
	}

	/** Where to drop new content: below everything that's already there. */
	function nextSlot() {
		const els = xapi!.getSceneElements();
		if (!els.length) return { x: 0, y: 0 };
		const [minX, , , maxY] = lib!.getCommonBounds(els);
		return { x: minX, y: maxY + 60 };
	}

	function insertElements(
		skeletons: Parameters<typeof import('@excalidraw/excalidraw').convertToExcalidrawElements>[0],
		extra?: (
			els: ReturnType<typeof import('@excalidraw/excalidraw').convertToExcalidrawElements>
		) => unknown[]
	) {
		const created = lib!.convertToExcalidrawElements(skeletons);
		const els = extra ? extra(created) : created;
		xapi!.updateScene({
			elements: [...xapi!.getSceneElementsIncludingDeleted(), ...(els as typeof created)]
		});
		xapi!.scrollToContent(els as typeof created, { fitToContent: true });
	}

	/** Embeddable iframe pointing at our own origin (rectangle skeleton → embeddable). */
	function embed(url: string, width: number, height: number) {
		const { x, y } = nextSlot();
		insertElements([{ type: 'rectangle', x, y, width, height }], (els) =>
			els.map((e) => ({
				...e,
				type: 'embeddable',
				link: url,
				backgroundColor: 'transparent',
				roundness: null
			}))
		);
	}

	async function addNote() {
		const hit = await pick();
		if (hit.coll === 'notes') embed(`${location.origin}/embed/note/${hit.id}`, 520, 380);
	}

	function chooseFile(accept: string): Promise<File | undefined> {
		return new Promise((res) => {
			const i = Object.assign(document.createElement('input'), { type: 'file', accept });
			i.onchange = () => res(i.files?.[0]);
			i.click();
		});
	}

	/** Render every PDF page to an image; the pages form one group with layout settings. */
	async function addPdf() {
		const file = await chooseFile('application/pdf');
		if (!file || !xapi) return;
		busy = true;
		try {
			const pdfjs = await import('pdfjs-dist');
			pdfjs.GlobalWorkerOptions.workerSrc = (
				await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
			).default;
			const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
			const files: BinaryFileData[] = [];
			const pages: { w: number; h: number }[] = [];
			for (let i = 1; i <= doc.numPages; i++) {
				const page = await doc.getPage(i);
				const viewport = page.getViewport({ scale: 2 });
				const canvas = document.createElement('canvas');
				canvas.width = viewport.width;
				canvas.height = viewport.height;
				await page.render({ canvas, viewport }).promise;
				files.push({
					id: crypto.randomUUID() as BinaryFileData['id'],
					dataURL: canvas.toDataURL('image/jpeg', 0.85) as BinaryFileData['dataURL'],
					mimeType: 'image/jpeg',
					created: Date.now()
				});
				pages.push({ w: viewport.width / 2, h: viewport.height / 2 });
			}
			const start = nextSlot();
			const gid = crypto.randomUUID();
			const rects = pdfLayout(pages, DEFAULT_PDF_LAYOUT);
			xapi.addFiles(files);
			insertElements(
				files.map((f, i) => ({
					type: 'image',
					fileId: f.id,
					...rects[i],
					x: start.x + rects[i].x,
					y: start.y + rects[i].y
				})),
				(els) =>
					els.map((e, i) => ({
						...e,
						groupIds: [gid],
						customData: {
							pdf: { gid, page: i, ...pages[i], layout: DEFAULT_PDF_LAYOUT } satisfies PdfPage
						}
					}))
			);
		} finally {
			busy = false;
		}
	}

	// ---- PDF layout panel: shown while exactly one PDF group is selected
	let pdfSel: { gid: string; layout: PdfLayout } | null = $state(null);
	const pdfOf = (e: ExcalidrawElement) => e.customData?.pdf as PdfPage | undefined;

	function trackPdfSelection(elements: readonly ExcalidrawElement[], appState: AppState) {
		const sel = elements.filter((e) => appState.selectedElementIds[e.id]);
		const gid = sel.length ? pdfOf(sel[0])?.gid : undefined;
		const all = gid && sel.every((e) => pdfOf(e)?.gid === gid);
		if (!all) return void (pdfSel &&= null);
		if (pdfSel?.gid !== gid) pdfSel = { gid, layout: pdfOf(sel[0])!.layout ?? DEFAULT_PDF_LAYOUT };
	}

	/** Re-position the pages of a PDF group; drawings lying on a page move along with it. */
	function relayout(patch: Partial<PdfLayout>) {
		if (!xapi || !lib || !pdfSel) return;
		const layout = { ...pdfSel.layout, ...patch };
		pdfSel = { ...pdfSel, layout };
		const gid = pdfSel.gid;
		const pages = xapi
			.getSceneElements()
			.filter((e) => pdfOf(e)?.gid === gid)
			.sort((a, b) => pdfOf(a)!.page - pdfOf(b)!.page);
		const x0 = Math.min(...pages.map((p) => p.x));
		const y0 = Math.min(...pages.map((p) => p.y));
		const rects = pdfLayout(
			pages.map((p) => pdfOf(p)!),
			layout
		);
		const next = new Map(
			pages.map((p, i) => [p.id, { ...rects[i], x: x0 + rects[i].x, y: y0 + rects[i].y }])
		);
		const onPage = (e: ExcalidrawElement) => {
			const [cx, cy] = [e.x + e.width / 2, e.y + e.height / 2];
			return pages.find(
				(p) => cx >= p.x && cx <= p.x + p.width && cy >= p.y && cy <= p.y + p.height
			);
		};
		const elements = xapi.getSceneElementsIncludingDeleted().map((e) => {
			const r = next.get(e.id);
			if (r) return lib!.newElementWith(e, { ...r, customData: { pdf: { ...pdfOf(e)!, layout } } });
			const page = !e.isDeleted && !pdfOf(e) ? onPage(e) : undefined;
			if (!page) return e;
			const to = next.get(page.id)!;
			const k = to.width / page.width;
			return lib!.newElementWith(e, { x: to.x + (e.x - page.x) * k, y: to.y + (e.y - page.y) * k });
		});
		xapi.updateScene({ elements, captureUpdate: lib.CaptureUpdateAction.IMMEDIATELY });
	}

	/** Any other file: stored as attachment and embedded via the browser's viewer. */
	async function addFile() {
		const file = await chooseFile('*/*');
		if (!file) return;
		const url = await upload(file, file.name);
		embed(`${location.origin}${url}`, 480, 360);
	}
</script>

<div
	class={['relative h-full', penUi && 'pen-ui']}
	onpointerdowncapture={touch}
	onpointermovecapture={touch}
	onpointerupcapture={touch}
	onpointercancelcapture={touch}
>
	<div bind:this={el} class="h-full"></div>
	{#if penUi}
		<PenBar
			{pens}
			{tool}
			onpen={usePen}
			ontool={(type) => xapi?.setActiveTool({ type })}
			onpens={(next, use) => {
				saveSettings({ pens: next });
				usePen(use, next);
			}}
			onundo={() => history(false)}
			onredo={() => history(true)}
			onfull={() => setPenUi(false)}
		/>
	{/if}
	<div
		class={[
			'absolute right-3 z-10 flex flex-col gap-1 rounded-md border bg-background/90 p-1 shadow-sm',
			penUi ? 'top-3' : 'top-16'
		]}
	>
		{#if !penUi}
			<Button size="icon-sm" variant="ghost" title="Pen bar" onclick={() => setPenUi(true)}
				><PenLine /></Button
			>
		{/if}
		<Button size="icon-sm" variant="ghost" title="Embed note" onclick={addNote}><FileText /></Button
		>
		<Button size="icon-sm" variant="ghost" title="Insert PDF" disabled={busy} onclick={addPdf}
			><FileUp /></Button
		>
		<Button size="icon-sm" variant="ghost" title="Embed file" onclick={addFile}
			><Paperclip /></Button
		>
	</div>
	{#if pdfSel}
		<div
			class="absolute top-16 right-16 z-10 grid w-72 grid-cols-[3.5rem_1fr] items-center gap-x-2 gap-y-2 rounded-md border bg-background p-3 text-xs shadow-sm"
		>
			<span class="col-span-2 text-sm font-medium">PDF layout</span>
			<span class="text-muted-foreground">Pages</span>
			<ToggleGroup.Root
				type="single"
				size="sm"
				variant="outline"
				value={pdfSel.layout.layout}
				onValueChange={(v) => v && relayout({ layout: v as PdfLayout['layout'] })}
			>
				<ToggleGroup.Item value="column" class="text-xs">Column</ToggleGroup.Item>
				<ToggleGroup.Item value="spread" class="text-xs">Spread</ToggleGroup.Item>
				<ToggleGroup.Item value="row" class="text-xs">Row</ToggleGroup.Item>
			</ToggleGroup.Root>
			{#if pdfSel.layout.layout === 'spread'}
				<span class="text-muted-foreground">Cover</span>
				<label class="flex items-center gap-2" title="Odd start: page 1 alone, like a book cover">
					<Switch
						checked={pdfSel.layout.coverAlone}
						onCheckedChange={(coverAlone) => relayout({ coverAlone })}
					/>
					<span>{pdfSel.layout.coverAlone ? 'Page 1 alone' : 'Pages 1 | 2'}</span>
				</label>
			{/if}
			<span class="text-muted-foreground">Scale</span>
			<AppSelect
				value={pdfSel.layout.scale}
				options={[0.25, 0.5, 0.75, 1, 1.5, 2].map((s) => ({
					value: String(s),
					label: `${s * 100}%`
				}))}
				onchange={(v) => relayout({ scale: Number(v) })}
			/>
			<span class="text-muted-foreground">Gap</span>
			<AppSelect
				value={pdfSel.layout.gap}
				options={[0, 8, 24, 48].map((g) => ({ value: String(g), label: `${g}px` }))}
				onchange={(v) => relayout({ gap: Number(v) })}
			/>
		</div>
	{/if}
</div>
