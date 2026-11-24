// Lists: where an item's text starts, and Tab / Shift+Tab.
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import type { ChangeSpec, EditorState, StateCommand } from '@codemirror/state';
import type { SyntaxNode } from '@lezer/common';

/**
 * Where the text of a list item starts: behind the marker and its spaces (one space when there
 * are more than four, or none: the rest is content then). Further lines of the item have to be
 * indented up to there. For an empty item that is one past the end of its line.
 */
export function textStart(state: EditorState, item: SyntaxNode): number {
	const mark = item.getChild('ListMark')!;
	const line = state.doc.lineAt(mark.to);
	const spaces = /^[ \t]*/.exec(line.text.slice(mark.to - line.from))![0].length;
	return mark.to + (spaces > 4 ? 1 : spaces || 1);
}

const up = (node: SyntaxNode | null, name: string) => {
	while (node && node.name !== name) node = node.parent;
	return node;
};

/**
 * Ordered lists in `from`…`to` count up again. A list keeps its first number, unless it begins
 * in that range (its first item was just moved there): then it starts at 1.
 */
function renumber(state: EditorState, from: number, to: number): ChangeSpec[] {
	const out: ChangeSpec[] = [];
	(ensureSyntaxTree(state, to, 200) ?? syntaxTree(state)).iterate({
		from,
		to,
		enter(n) {
			if (n.name !== 'OrderedList') return;
			let no: number | undefined;
			for (const item of n.node.getChildren('ListItem')) {
				const mark = item.getChild('ListMark')!;
				const old = state.sliceDoc(mark.from, mark.to - 1);
				no = no === undefined ? (mark.from < from ? +old : 1) : no + 1;
				if (+old !== no) out.push({ from: mark.from, to: mark.to - 1, insert: String(no) });
			}
		}
	});
	return out;
}

/** The innermost list item the line of `pos` is in; none inside a code block of an item. */
function itemAt(state: EditorState, pos: number): SyntaxNode | null {
	const line = state.doc.lineAt(pos);
	let item: SyntaxNode | null = syntaxTree(state).resolveInner(
		line.from + /^[ \t>]*/.exec(line.text)![0].length,
		1
	);
	while (item && !/^(ListItem|FencedCode|CodeBlock)$/.test(item.name)) item = item.parent;
	return item?.name === 'ListItem' ? item : null;
}

/**
 * Tab / Shift+Tab: the list items on the selected lines go one level in (under the item before
 * the first of them) or out, together with everything below them. Indentation is whatever the
 * markdown needs: in = up to the text of the item above, out = back to the marker of the parent.
 */
export const nest =
	(dir: 1 | -1): StateCommand =>
	({ state, dispatch }) => {
		const { doc } = state;
		const items: SyntaxNode[] = [];
		for (const r of state.selection.ranges)
			for (let pos = r.from; ;) {
				const item = itemAt(state, pos); // Tab inside code is not for the list
				if (item && !items.some((i) => i.from <= item.from && i.to >= item.to)) items.push(item);
				if ((pos = doc.lineAt(pos).to + 1) > r.to) break;
			}
		if (!items.length) return false;

		const col = (pos: number) => pos - doc.lineAt(pos).from;
		const start = items[0].getChild('ListMark')!.from;
		const parent = items[0].parent!.parent;
		let before = items[0].prevSibling;
		while (before && before.name !== 'ListItem') before = before.prevSibling; // `>` of a quote
		if (dir < 0 && parent?.name !== 'ListItem') return false; // top level: plain dedent
		if (dir > 0 && !before) return true; // a first item has nothing to go under
		const by =
			dir > 0
				? col(textStart(state, before!)) - col(start)
				: col(start) - col(parent!.getChild('ListMark')!.from);

		// the indentation sits behind the `>`s of the quotes the list is in
		let quotes = 0;
		for (let n = up(items[0], 'Blockquote'); n; n = up(n.parent, 'Blockquote')) quotes++;
		const prefix = new RegExp(`^(?:[ \\t]*>){0,${quotes}}`);
		const changes: ChangeSpec[] = [];
		const seen = new Set<number>();
		let end = start;
		for (const item of items)
			for (let pos = item.getChild('ListMark')!.from; pos <= item.to;) {
				const line = doc.lineAt(pos);
				pos = line.to + 1;
				end = Math.min(pos, doc.length);
				if (seen.has(line.number)) continue;
				seen.add(line.number);
				const at = line.from + prefix.exec(line.text)![0].length;
				const indent = /^[ \t]*/.exec(line.text.slice(at - line.from))![0].length;
				if (dir < 0) changes.push({ from: at, to: at + Math.min(by, indent) });
				else if (at < line.to) changes.push({ from: at, insert: ' '.repeat(by) });
			}

		// the numbers of ordered lists follow, up to the line below (its items may have a new parent)
		const moved = state.changes(changes);
		const next = state.update({ changes: moved }).state;
		const fix = renumber(next, moved.mapPos(start, 1), next.doc.lineAt(moved.mapPos(end, -1)).to);
		dispatch(
			state.update({
				changes: moved.compose(next.changes(fix)),
				scrollIntoView: true,
				userEvent: dir > 0 ? 'input.indent' : 'delete.dedent'
			})
		);
		return true;
	};

/**
 * The list item with the cursor changes places with the one above (-1) or below (1) it in its
 * list, together with everything below it. Markers stay where they are, so numbers keep counting.
 */
export const moveItem =
	(dir: 1 | -1): StateCommand =>
	({ state, dispatch }) => {
		const { doc } = state;
		const { anchor, head } = state.selection.main;
		const item = itemAt(state, head);
		if (!item) return false;
		let other = dir < 0 ? item.prevSibling : item.nextSibling;
		while (other && other.name !== 'ListItem')
			other = dir < 0 ? other.prevSibling : other.nextSibling;
		if (!other) return true; // first or last: stays
		/** The lines of an item, and its marker. */
		const block = (i: SyntaxNode) => {
			const mark = i.getChild('ListMark')!;
			return { from: doc.lineAt(mark.from).from, to: doc.lineAt(i.to).to, mark };
		};
		const [a, b] = (dir < 0 ? [other, item] : [item, other]).map(block);
		// an item that starts in the line of its parent ("- - a") can't be taken out of it
		if ([a, b].some((x) => /[^ \t>]/.test(doc.sliceString(x.from, x.mark.from)))) return true;
		/** The lines of `x` behind the marker of `y`. */
		const as = (x: typeof a, y: typeof a) =>
			doc.sliceString(x.from, x.mark.from) +
			doc.sliceString(y.mark.from, y.mark.to) +
			doc.sliceString(x.mark.to, x.to);
		const first = as(b, a);
		const between = doc.sliceString(a.to, b.from);
		const [me, it] = dir < 0 ? [b, a] : [a, b];
		const shift = dir < 0 ? a.from - b.from : first.length + between.length;
		const wider = it.mark.to - it.mark.from - (me.mark.to - me.mark.from);
		const moved = (pos: number) =>
			Math.max(me.from, Math.min(pos, me.to)) + shift + (pos >= me.mark.to ? wider : 0);
		dispatch(
			state.update({
				changes: { from: a.from, to: b.to, insert: first + between + as(a, b) },
				selection: { anchor: moved(anchor), head: moved(head) },
				scrollIntoView: true,
				userEvent: 'move.line'
			})
		);
		return true;
	};
