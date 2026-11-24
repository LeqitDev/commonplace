// Live preview: markdown syntax is hidden (or drawn as a widget) wherever the selection isn't.
// Only decorations that stay inside one line live here, so a view plugin may provide them.
import { syntaxTree } from '@codemirror/language';
import { type EditorState, type Range, StateField } from '@codemirror/state';
import type { SyntaxNode } from '@lezer/common';
import {
	Decoration,
	type DecorationSet,
	type EditorView,
	showTooltip,
	type Tooltip,
	type TooltipView,
	ViewPlugin,
	type ViewUpdate,
	WidgetType
} from '@codemirror/view';
import { typstError, typstMath } from '../typst.ts';
import { imageOptions, zoom } from './images.ts';
import { textStart } from './lists.ts';
import { headingSizes } from './theme.ts';
import { aligns, isRaw, tableOf } from './tables.ts';

class Rule extends WidgetType {
	toDOM() {
		const el = document.createElement('span');
		el.className = 'md-hr';
		return el;
	}
}

class Bullet extends WidgetType {
	toDOM() {
		const el = document.createElement('span');
		el.textContent = '•';
		return el;
	}
}

class Check extends WidgetType {
	constructor(readonly checked: boolean) {
		super();
	}
	eq(other: Check) {
		return other.checked === this.checked;
	}
	toDOM() {
		const el = document.createElement('span');
		el.className = 'md-check';
		el.setAttribute('role', 'checkbox');
		el.setAttribute('aria-checked', String(this.checked));
		return el;
	}
	/** Clicks go to the plugin below, which ticks the box. */
	ignoreEvent() {
		return false;
	}
}

/** The picture of `![alt](src)`. It is kept (not rebuilt) while the cursor moves in and out. */
class Img extends WidgetType {
	constructor(
		readonly src: string,
		/** With its options (`alt|center|300`). */
		readonly alt: string,
		/** Shown next to its markdown: on a row of its own, so that it doesn't move sideways. */
		readonly row: boolean
	) {
		super();
	}
	eq(other: Img) {
		return other.src === this.src && other.alt === this.alt && other.row === this.row;
	}
	toDOM(view: EditorView) {
		const el = document.createElement('span');
		const img = el.appendChild(document.createElement('img'));
		img.onload = img.onerror = () => view.requestMeasure(); // its height is known only now
		this.updateDOM(el);
		return el;
	}
	updateDOM(el: HTMLElement) {
		const img = el.firstChild as HTMLImageElement;
		const { alt, align, width, height } = imageOptions(this.alt);
		if (img.getAttribute('src') !== this.src) img.src = this.src;
		img.alt = alt;
		Object.assign(img.style, {
			width: width ? `${width}px` : '',
			height: height ? `${height}px` : '',
			maxHeight: width ? 'none' : '' // a width that is asked for is not cut down by the height
		});
		el.className = this.row || align ? 'md-img md-img-row' : 'md-img';
		el.style.textAlign = align ?? '';
		return true;
	}
	/** A click goes to the plugin below, which shows the picture large. */
	ignoreEvent() {
		return false;
	}
}

/** Draws a formula into `el` when Typst has it (it is loaded when the first one shows up); what
 *  `el` shows stays until then, and of several calls the last one counts. */
function draw(
	el: HTMLElement,
	src: string,
	display: boolean,
	view: EditorView,
	fail: (message: string) => void
) {
	el.dataset.src = src;
	typstMath(src, display).then(
		({ svg, width, height, depth }) => {
			if (el.dataset.src !== src) return;
			el.classList.remove('md-math-error');
			el.title = '';
			el.innerHTML = svg; // made by the Typst compiler from the user's own note
			// what Typst adds for selecting text in a document would get in the way here
			for (const extra of el.querySelectorAll('script, foreignObject')) extra.remove();
			Object.assign((el.firstElementChild as SVGElement).style, {
				width: `${width}em`,
				height: `${height}em`,
				verticalAlign: `${-depth}em`
			});
			view.requestMeasure();
		},
		(error) => {
			if (el.dataset.src !== src) return;
			el.classList.add('md-math-error');
			fail(typstError(error));
		}
	);
}

/** A formula, drawn by Typst. */
class Formula extends WidgetType {
	constructor(
		readonly src: string,
		/** `$$…$$`: on a row of its own, in the middle. */
		readonly display: boolean,
		/** Font size, in em of the text of the note (a formula in a heading is larger). */
		readonly size: number
	) {
		super();
	}
	eq(other: Formula) {
		return other.src === this.src && other.display === this.display && other.size === this.size;
	}
	toDOM(view: EditorView) {
		const el = document.createElement('span');
		el.className = this.display ? 'md-math md-math-row' : 'md-math';
		if (this.size !== 1) el.style.fontSize = `${this.size}em`;
		el.textContent = this.display ? `$$${this.src}$$` : `$${this.src}$`; // until it is drawn
		draw(el, this.src, this.display, view, (message) => (el.title = message));
		return el;
	}
	/** A click puts the cursor next to it, which shows the markdown. */
	ignoreEvent() {
		return false;
	}
}

const hide = Decoration.replace({});
const rule = Decoration.replace({ widget: new Rule() });
const bullet = Decoration.replace({ widget: new Bullet() });
const check = [false, true].map((on) => Decoration.replace({ widget: new Check(on) }));
const done = Decoration.mark({ class: 'md-done' });
/** What stands in front of the text of a list line (indentation, marker, checkbox): a box as wide
 *  as the indentation of the item, which makes the lines of an item line up, wrapped ones too. */
const lead = Decoration.mark({ class: 'md-lead', inclusiveStart: true }); // a bullet at its start is inside
/** The same around a marker that has no space behind it yet (CSS adds one). */
const leadBare = Decoration.mark({ class: 'md-lead md-lead-bare', inclusiveStart: true });
const code = Decoration.mark({ class: 'md-code' });
const link = Decoration.mark({ class: 'md-link' });
const quote = Decoration.line({ class: 'md-quote' });
/** Lines of a code block; index: 1 = its first line, 2 = its last one (rounded corners). */
const pre = ['', ' md-pre-first', ' md-pre-last', ' md-pre-first md-pre-last'].map((c) =>
	Decoration.line({ class: 'md-pre' + c })
);
const fence = Decoration.line({ class: 'md-fence' });
const mathSource = Decoration.mark({ class: 'md-math-src' });
/** A line that is not shown: the further lines of a formula that is drawn in its first one. */
const gone = Decoration.line({ class: 'md-gone' });
// table rows are lines, their cells marks: CSS lays them out as a table (see tables.ts)
const tableRow = ['md-tr md-th', 'md-tr'].map((c) => Decoration.line({ class: c }));
const tableSep = Decoration.line({ class: 'md-tsep' });
const tableCell = Object.fromEntries(
	['left', 'center', 'right'].map((align) => [
		align,
		Decoration.mark({ class: `md-td md-td-${align}`, inclusive: true }) // with what is hidden at its ends
	])
);

/**
 * Decorations for the given part of the document. An inline element shows its syntax while the
 * selection touches it, a heading / quote / rule / code fence while the selection is on its line,
 * a bullet or checkbox while the selection touches the marker; without focus everything is
 * rendered. Pictures and formulas on rows of their own stay, below their markdown.
 */
export function decorate(
	state: EditorState,
	focused: boolean,
	visible: readonly { from: number; to: number }[] = [{ from: 0, to: state.doc.length }]
): DecorationSet {
	const { doc } = state;
	const sel = focused ? state.selection.ranges : [];
	const touched = (from: number, to: number) => sel.some((r) => r.from <= to && r.to >= from);
	const lineTouched = (pos: number) => {
		const line = doc.lineAt(pos);
		return touched(line.from, line.to);
	};
	const out: Range<Decoration>[] = [];
	/** Lines of list items by their start: nesting depth of the item and where its text begins. */
	const listLines = new Map<number, { depth: number; text: number; bare?: boolean }>();

	for (const { from, to } of visible)
		syntaxTree(state).iterate({
			from,
			to,
			enter(n) {
				switch (n.name) {
					case 'HeaderMark': {
						const heading = n.node.parent!;
						if (!heading.name.startsWith('ATXHeading') || lineTouched(n.from)) break;
						if (n.from > heading.from)
							out.push(hide.range(n.from, n.to)); // closing #s
						else {
							// "# " in front; a heading without text keeps it, or the line would look empty
							const space = /^\s+(?=\S)/.exec(doc.sliceString(n.to, heading.to));
							if (space) out.push(hide.range(n.from, n.to + space[0].length));
						}
						break;
					}
					case 'EmphasisMark':
					case 'StrikethroughMark':
					case 'CodeMark': {
						const el = n.node.parent!;
						if (!touched(el.from, el.to)) out.push(hide.range(n.from, n.to));
						break;
					}
					case 'FencedCode':
					case 'CodeBlock':
						for (let pos = Math.max(n.from, from); pos <= Math.min(n.to, to);) {
							const line = doc.lineAt(pos);
							out.push(pre[+(line.from <= n.from) + 2 * +(line.to >= n.to)].range(line.from));
							pos = line.to + 1;
						}
						// a fence away from the cursor leaves a slim line (the first one names the language)
						for (const mark of n.node.getChildren('CodeMark'))
							if (!lineTouched(mark.from))
								out.push(fence.range(doc.lineAt(mark.from).from), hide.range(mark.from, mark.to));
						return false; // what is inside is not markdown
					case 'HTMLBlock':
					case 'HTMLTag':
						return false; // same
					case 'InlineMath':
					case 'MathBlock': {
						const [open, close] = n.node.getChildren('MathMark');
						const src = close ? doc.sliceString(open.to, close.from) : '';
						if (!src.trim()) break; // not closed, or nothing in it yet
						const display = open.to - open.from > 1;
						const level = /Heading(\d)$/.exec(n.node.parent?.name ?? '')?.[1];
						const formula = new Formula(src, display, headingSizes[+level! - 1] ?? 1);
						const lines = n.name === 'MathBlock';
						if (!touched(n.from, n.to)) {
							// the formula instead of its (first) line, further lines are not shown
							const first = doc.lineAt(n.from);
							out.push(
								Decoration.replace({ widget: formula }).range(n.from, Math.min(first.to, n.to))
							);
							for (let pos = Math.max(first.to + 1, from); pos <= Math.min(n.to, to);) {
								const line = doc.lineAt(pos);
								out.push(gone.range(line.from));
								pos = line.to + 1;
							}
							break;
						}
						// with the cursor in it: its markdown, a block like a code block, and one that
						// stands on its own with the formula below
						if (open.to < close.from) out.push(mathSource.range(open.to, close.from));
						for (let pos = Math.max(n.from, from); lines && pos <= Math.min(n.to, to);) {
							const line = doc.lineAt(pos);
							out.push(pre[+(line.from <= n.from) + 2 * +(line.to >= n.to)].range(line.from));
							pos = line.to + 1;
						}
						if (display) out.push(Decoration.widget({ widget: formula, side: 1 }).range(n.to));
						break;
					}
					case 'Table': {
						const table = tableOf(state, n.node);
						if (!table || isRaw(table, sel)) break;
						const align = aligns(state, table);
						out.push(tableSep.range(table.sep.line.from));
						table.rows.forEach((row, r) => {
							out.push(tableRow[+!!r].range(row.line.from));
							// Only the text of a cell is shown. The cell takes the pipe behind it along (and
							// the first one the pipe in front): the cursor is drawn next to what follows it, so
							// at the end of a cell's text that has to be something of the same cell.
							row.cells.forEach(({ from, to, text }, c) => {
								if (!c) from = row.line.from;
								to = c < row.cells.length - 1 ? to + 1 : row.line.to;
								out.push((tableCell[align[c]] ?? tableCell.left).range(from, to));
								if (from < text.from) out.push(hide.range(from, text.from));
								if (text.to < to) out.push(hide.range(text.to, to));
							});
						});
						break;
					}
					case 'Image': {
						const url = n.node.getChild('URL');
						if (!url) break; // ![alt][reference]
						const [open, close] = n.node.getChildren('LinkMark');
						const src = doc.sliceString(url.from, url.to).replace(/^<|>$/g, '');
						const row = touched(n.from, n.to);
						out.push(
							Decoration.widget({
								widget: new Img(src, doc.sliceString(open.to, close.from), row),
								side: 1
							}).range(n.to)
						);
						if (row) break;
						out.push(hide.range(n.from, n.to));
						return false;
					}
					case 'InlineCode':
						out.push(code.range(n.from, n.to));
						break;
					case 'Link':
					case 'Autolink': {
						if (touched(n.from, n.to)) break;
						const marks = n.node.getChildren('LinkMark');
						if (n.name === 'Autolink') for (const m of marks) out.push(hide.range(m.from, m.to));
						// [text](url) keeps its text; reference links and empty texts stay as they are
						else if (n.node.getChild('URL') && marks.length > 2 && marks[1].from > marks[0].to)
							out.push(hide.range(marks[0].from, marks[0].to), hide.range(marks[1].from, n.to));
						break;
					}
					case 'URL': // a URL that is shown as itself (bare or <…>), not the target of [text](…)
						if (!/^(Link|Image)$/.test(n.node.parent!.name)) out.push(link.range(n.from, n.to));
						break;
					case 'Escape':
						if (!touched(n.from, n.to)) out.push(hide.range(n.from, n.from + 1));
						break;
					case 'Blockquote':
						for (let pos = Math.max(n.from, from); pos <= Math.min(n.to, to);) {
							const line = doc.lineAt(pos);
							out.push(quote.range(line.from));
							pos = line.to + 1;
						}
						break;
					case 'QuoteMark':
						if (!lineTouched(n.from))
							out.push(hide.range(n.from, n.to + +(doc.sliceString(n.to, n.to + 1) === ' ')));
						break;
					case 'HorizontalRule':
						if (!lineTouched(n.from)) out.push(rule.range(n.from, n.to));
						break;
					case 'ListItem': {
						const mark = n.node.getChild('ListMark')!;
						const task = n.node.getChild('Task');
						const first = doc.lineAt(mark.from);
						const indent = textStart(state, n.node) - first.from;
						// a checkbox counts as part of the marker: the text starts behind it
						const text = Math.min(first.to, task ? task.from + 4 : first.from + indent);
						let depth = 0;
						for (let i: SyntaxNode | null = n.node; i; i = i.parent)
							depth += +(i.name === 'ListItem');
						listLines.set(first.from, { depth, text, bare: mark.to === first.to });
						// further lines (nested items overwrite theirs): the indentation up to the text
						for (let pos = Math.max(first.to + 1, from); pos <= Math.min(n.to, to);) {
							const line = doc.lineAt(pos);
							const space = /^[ \t>]*/.exec(line.text)![0].length;
							listLines.set(line.from, { depth, text: line.from + Math.min(space, indent) });
							pos = line.to + 1;
						}

						const dot = n.node.parent!.name === 'BulletList';
						if (task) {
							const on = doc.sliceString(task.from + 1, task.from + 2) !== ' ';
							const start = dot ? mark.from : task.from; // the box stands for "- [ ]", a number stays
							if (!touched(start, task.from + 3)) out.push(check[+on].range(start, task.from + 3));
							if (on && text < task.to) out.push(done.range(text, task.to));
						} else if (dot && !touched(mark.from, mark.to))
							out.push(bullet.range(mark.from, mark.to));
						break;
					}
				}
			}
		});
	for (const [from, { depth, text, bare }] of listLines) {
		out.push(
			Decoration.line({ class: 'md-li', attributes: { style: `--md-depth: ${depth}` } }).range(from)
		);
		if (text > from) out.push((bare ? leadBare : lead).range(from, text));
	}
	return Decoration.set(out, true);
}

/** The formula `$…$` the cursor is in: where it starts and what is between the dollars. */
export function inlineMath(state: EditorState) {
	const { head } = state.selection.main;
	for (const side of [-1, 1] as const)
		for (let n: SyntaxNode | null = syntaxTree(state).resolveInner(head, side); n; n = n.parent) {
			if (n.name !== 'InlineMath') continue;
			const [open, close] = n.getChildren('MathMark');
			const src = close ? state.sliceDoc(open.to, close.from) : '';
			// `$$…$$` in a line is drawn below its markdown anyway
			return src.trim() && open.to - open.from === 1 ? { pos: n.from, src } : null;
		}
	return null;
}

/** One function for every tooltip: that is what makes the editor keep it while its formula is
 *  typed, instead of building a new one per keystroke. */
function mathTip(view: EditorView): TooltipView {
	const dom = document.createElement('div');
	dom.className = 'md-math md-math-tip';
	const show = (state: EditorState) => {
		const math = inlineMath(state);
		if (math && math.src !== dom.dataset.src)
			draw(dom, math.src, false, view, (message) => (dom.textContent = message));
	};
	show(view.state);
	return { dom, update: (u) => show(u.state) };
}

const mathTooltip = (state: EditorState): Tooltip | null => {
	const math = inlineMath(state);
	return math && { pos: math.pos, above: false, create: mathTip };
};

/** While a formula in a line of text is edited (it shows its markdown then), it is drawn in a
 *  popup below it. */
export const mathPopup = StateField.define<Tooltip | null>({
	create: mathTooltip,
	update: (tip, tr) => (tr.docChanged || tr.selection ? mathTooltip(tr.state) : tip),
	provide: (field) => showTooltip.from(field)
});

export const preview = ViewPlugin.fromClass(
	class {
		decorations: DecorationSet;
		/** While the mouse button is down nothing is revealed or hidden: text moving under the
		 *  pointer would make a click land elsewhere and a drag selection jump. */
		down = false;
		stale = false;
		dead = false;

		constructor(view: EditorView) {
			this.decorations = decorate(view.state, view.hasFocus, view.visibleRanges);
		}

		update(u: ViewUpdate) {
			const content =
				u.docChanged || u.viewportChanged || syntaxTree(u.startState) !== syntaxTree(u.state);
			if (!content && !u.selectionSet && !u.focusChanged && !this.stale) return;
			if ((this.stale = this.down && !content)) return;
			this.decorations = decorate(u.state, u.view.hasFocus, u.view.visibleRanges);
		}

		destroy() {
			this.dead = true;
		}
	},
	{
		decorations: (v) => v.decorations,
		eventHandlers: {
			mousedown(e, view) {
				if (e.button !== 0) return;
				if ((e.target as Element).matches('.md-img img')) {
					e.preventDefault(); // the cursor stays where it is: the click shows the picture large
					return true;
				}
				const box = (e.target as Element).closest('.md-check');
				if (box) {
					const from = view.posAtDOM(box); // of what it replaces: "[ ]" or "- [ ]"
					const at = from + view.state.sliceDoc(from, from + 6).indexOf('[') + 1;
					const insert = view.state.sliceDoc(at, at + 1) === ' ' ? 'x' : ' ';
					view.dispatch({ changes: { from: at, to: at + 1, insert }, userEvent: 'input' });
					e.preventDefault(); // the cursor stays where it is
					return true;
				}
				this.down = true;
				view.dom.ownerDocument.addEventListener(
					'mouseup',
					() => {
						this.down = false;
						if (this.stale && !this.dead) view.dispatch({});
					},
					{ once: true }
				);
			},
			click(e) {
				const img = e.target as HTMLImageElement;
				if (e.button !== 0 || !img.matches('.md-img img')) return;
				zoom(img.currentSrc || img.src);
				return true;
			}
		}
	}
);
