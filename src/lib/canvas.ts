import type { CanvasElement } from './types.ts';

/** Text of all live text elements in reading order (top→bottom, left→right). */
export function canvasText(elements: CanvasElement[] = []): string {
	return elements
		.filter((e) => e.type === 'text' && !e.isDeleted && e.text)
		.sort((a, b) => a.y - b.y || a.x - b.x)
		.map((e) => e.text)
		.join('\n\n');
}

// ---- PDF pages: one Excalidraw group of page images, laid out by these options

export interface PdfLayout {
	layout: 'column' | 'spread' | 'row';
	/** Spread only: page 1 sits alone on the right (book style, "odd start"). */
	coverAlone: boolean;
	gap: number;
	scale: number;
}
export const DEFAULT_PDF_LAYOUT: PdfLayout = {
	layout: 'column',
	coverAlone: true,
	gap: 24,
	scale: 1
};

type Rect = { x: number; y: number; width: number; height: number };

/** Page rectangles relative to the group's top-left, from the pages' natural (100%) sizes. */
export function pdfLayout(pages: { w: number; h: number }[], o: PdfLayout): Rect[] {
	const size = (p: { w: number; h: number }) => ({ width: p.w * o.scale, height: p.h * o.scale });
	const out: Rect[] = [];
	if (o.layout !== 'spread') {
		let at = 0;
		for (const p of pages) {
			const s = size(p);
			out.push(o.layout === 'row' ? { x: at, y: 0, ...s } : { x: 0, y: at, ...s });
			at += (o.layout === 'row' ? s.width : s.height) + o.gap;
		}
		return out;
	}
	// two pages per row around a spine; left pages are right-aligned to it
	const spine = Math.max(...pages.map((p) => size(p).width));
	const slots = [...(o.coverAlone ? [null] : []), ...pages.keys()];
	let y = 0;
	for (let r = 0; r < slots.length; r += 2) {
		const row = slots.slice(r, r + 2);
		let height = 0;
		row.forEach((i, side) => {
			if (i === null || i === undefined) return;
			const s = size(pages[i]);
			out[i] = { x: side === 0 ? spine - s.width : spine + o.gap, y, ...s };
			height = Math.max(height, s.height);
		});
		y += height + o.gap;
	}
	return out;
}

// ---- Pen UI (touch devices): pen presets and finger pan/zoom

export interface Pen {
	color: string;
	/** Excalidraw stroke width (its own pens are 1, 2 and 4). */
	width: number;
	/** 0–100; a highlighter is a wide pen with a low opacity. */
	opacity: number;
	/** Off: the stroke gets an even width when the pen is lifted. */
	pressure: boolean;
}
export const DEFAULT_PENS: Pen[] = [
	{ color: '#1e1e1e', width: 0.5, opacity: 100, pressure: true },
	{ color: '#1e1e1e', width: 1.5, opacity: 100, pressure: true },
	{ color: '#e03131', width: 1, opacity: 100, pressure: true },
	{ color: '#1971c2', width: 1, opacity: 100, pressure: true },
	{ color: '#ffd43b', width: 6, opacity: 35, pressure: false }
];

/** Patch that gives a freedraw element an even width (null: it already has one). */
export function flatten(e: {
	points: readonly unknown[];
	simulatePressure: boolean;
	pressures: readonly number[];
}) {
	if (
		!e.simulatePressure &&
		e.pressures.length === e.points.length &&
		e.pressures.every((p) => p === 0.5)
	)
		return null;
	return { simulatePressure: false, pressures: e.points.map(() => 0.5) };
}

type Point = { x: number; y: number };
export type View = { scrollX: number; scrollY: number; zoom: number };

/** Fingers moved from `prev` to `next` (1 or 2 points, relative to the canvas): the scene point
 * under their centre stays under it (pan), and two fingers zoom by their change in distance. */
export function touchMove(view: View, prev: Point[], next: Point[]): View {
	const centre = (p: Point[]) => ({
		x: p.reduce((s, q) => s + q.x, 0) / p.length,
		y: p.reduce((s, q) => s + q.y, 0) / p.length
	});
	const dist = (p: Point[]) => Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
	const [a, b] = [centre(prev), centre(next)];
	const k = prev.length === 2 && next.length === 2 && dist(prev) > 0 ? dist(next) / dist(prev) : 1;
	const zoom = Math.min(30, Math.max(0.1, view.zoom * k));
	return {
		zoom,
		scrollX: view.scrollX + b.x / zoom - a.x / view.zoom,
		scrollY: view.scrollY + b.y / zoom - a.y / view.zoom
	};
}
