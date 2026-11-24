// Typst → SVG in the browser (typst.ts WASM, loaded on first use). Used for flashcards and for
// the math in notes.
import { TYPST_FONTS } from './typst-fonts.ts';

type Snippet = import('@myriaddreamin/typst.ts/dist/esm/contrib/snippet.mjs').TypstSnippet;
let engine: Promise<Snippet> | undefined;

function load() {
	return (engine ??= (async () => {
		const [{ TypstSnippet }, compiler, renderer] = await Promise.all([
			import('@myriaddreamin/typst.ts/dist/esm/contrib/snippet.mjs'),
			import('@myriaddreamin/typst-ts-web-compiler/wasm?url'),
			import('@myriaddreamin/typst-ts-renderer/wasm?url')
		]);
		const t = new TypstSnippet();
		t.setCompilerInitOptions({ getModule: () => compiler.default });
		t.setRendererInitOptions({ getModule: () => renderer.default });
		t.use(
			TypstSnippet.disableDefaultFontAssets(),
			TypstSnippet.preloadFonts(TYPST_FONTS.map((f) => `/typst-fonts/${f}`))
		);
		return t;
	})());
}

// Fixed page width so long answers wrap; the SVG is scaled down to the container by CSS.
const PREAMBLE = `#set page(width: 12cm, height: auto, margin: 2pt, fill: none)
#set text(size: 13pt)
#set align(center)
`;

const cache = new Map<string, Promise<unknown>>();
let queue: Promise<unknown> = Promise.resolve(); // the compiler is not re-entrant

/** Run `run` with the compiler, once per `key`: results are kept, calls wait for each other. */
function compile<T>(key: string, run: (typst: Snippet) => Promise<T>): Promise<T> {
	let hit = cache.get(key) as Promise<T> | undefined;
	if (!hit) {
		hit = queue.then(async () => run(await load()));
		queue = hit.catch(() => {});
		hit.catch(() => cache.delete(key)); // don't cache errors (fonts may still be loading etc.)
		cache.set(key, hit);
		if (cache.size > 500) cache.delete(cache.keys().next().value!);
	}
	return hit;
}

/** Render Typst markup to an SVG string. Rejects with Typst's error message. */
export const typstSvg = (src: string) =>
	compile('svg:' + src, (typst) => typst.svg({ mainContent: PREAMBLE + src }));

/**
 * Size of the text that math in notes stands in (px), and of the math itself (pt, drawn as px):
 * a little larger, the letters of the math font are small next to those of the text.
 */
const TEXT_SIZE = 14;
const MATH_SIZE = 16;
const MATH = `#set page(width: auto, height: auto, margin: 0pt, fill: none)
#set text(size: ${MATH_SIZE}pt)
`;

/** The value of the metadata labelled `label` in a document. */
async function query<T>(typst: Snippet, source: string, label: string): Promise<T> {
	// (`typst.query` of this version asks a document that it didn't compile: do both by hand)
	const compiler = await typst.getCompiler();
	compiler.addSource('/query.typ', source);
	return compiler.runWithWorld({ mainFilePath: '/query.typ' }, async (world) => {
		await world.compile();
		return (await world.query({ selector: label, field: 'value' }))[0];
	});
}

export interface TypstMath {
	svg: string;
	/** In em of the surrounding text; `depth`: how far the SVG reaches below the baseline. */
	width: number;
	height: number;
	depth: number;
}

/**
 * Render a formula (what is between the `$`s of a note) to an SVG of the size Typst gives it in
 * a line of text; what a line has room for anyway (a fraction, an index) reaches out of it.
 * An inline one is measured as well, so that it can be put on the baseline of its line: next to
 * a box of 100pt standing on that line, all height beyond those 100pt is below the baseline.
 */
export const typstMath = (src: string, display: boolean) =>
	compile<TypstMath>(`math${+display}:${src}`, async (typst) => {
		const mainContent = display
			? `${MATH}$ ${src} $`
			: `${MATH}#let eq = $${src.trim()}$
#eq#context [#metadata((measure(eq).height.pt(), measure([#eq#box(height: 100pt)]).height.pt() - 100)) <size>]`;
		const svg = await typst.svg({ mainContent });
		const size = (name: string) =>
			+(new RegExp(`<svg[^>]*?\\b${name}="([\\d.]+)`).exec(svg)?.[1] ?? 0);
		// (the SVG is a little higher than the formula: its size is rounded up to whole points)
		const [height, below] = display
			? [size('height'), 0]
			: await query<[number, number]>(typst, mainContent, '<size>');
		return {
			svg,
			width: size('width') / TEXT_SIZE,
			height: size('height') / TEXT_SIZE,
			depth: (size('height') - height + below) / TEXT_SIZE
		};
	});

/** Make Typst's error output readable ("[SourceDiagnostic { … message: "…" …}]" → message). */
export const typstError = (e: unknown) =>
	[...String(e).matchAll(/message: "((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]).join('; ') || String(e);
