// Editing commands of the markdown editor.
import { insertNewlineContinueMarkupCommand } from '@codemirror/lang-markdown';
import { syntaxTree } from '@codemirror/language';
import { type ChangeSpec, EditorSelection, type StateCommand } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';
import { cellAt, enterRow, startTable, tableAt } from './tables.ts';

const continueMarkup = insertNewlineContinueMarkupCommand({ nonTightLists: false });

/**
 * Enter at the end of a code fence (or `$$`) that opens a block which is never closed (it has
 * just been typed, and the rest of the note has become code): the closing fence is added below
 * the cursor. Between the dollars of an empty `$$$$`, they go to lines of their own.
 */
const closeFence: StateCommand = ({ state, dispatch }) => {
	const { head, empty } = state.selection.main;
	const line = state.doc.lineAt(head);
	let block: SyntaxNode | null = syntaxTree(state).resolveInner(head, -1);
	if (!/^(FencedCode|MathBlock)$/.test(block.name)) block = block.parent;
	if (!empty || !block || !/^(FencedCode|MathBlock)$/.test(block.name) || block.from < line.from)
		return false;
	const [open, close] = block.getChildren(block.name === 'MathBlock' ? 'MathMark' : 'CodeMark');
	if (close ? open.to < head || close.from > head : head < line.to) return false;
	// what precedes the fence in its line (list marker, quote) as indentation
	const indent = '\n' + line.text.slice(0, block.from - line.from).replace(/[^\s>]/g, ' ');
	dispatch(
		state.update({
			changes: {
				from: head,
				insert: indent + indent + (close ? '' : state.sliceDoc(open.from, open.to))
			},
			selection: { anchor: head + indent.length },
			scrollIntoView: true,
			userEvent: 'input'
		})
	);
	return true;
};

/**
 * Enter inside lists and quotes: a new item on the next line; on an empty item, one level back
 * (at the top level the marker is removed). CodeMirror's command does that, except that in a
 * list with blank lines between its items it also puts a blank line before the new item; that
 * line is taken out again here.
 */
export const enter: StateCommand = ({ state, dispatch }) =>
	closeFence({ state, dispatch }) ||
	startTable({ state, dispatch }) ||
	enterRow({ state, dispatch }) ||
	continueMarkup({
		state,
		dispatch(tr) {
			const specs: ChangeSpec[] = [];
			let loose = false;
			tr.changes.iterChanges((from, to, _from, _to, text) => {
				const insert = text.toString().replace(/^\n[ \t>]*(?=\n)/, '');
				loose ||= insert.length !== text.length;
				specs.push({ from, to, insert });
			});
			if (!loose) return dispatch(tr);
			const changes = state.changes(specs);
			dispatch(
				state.update({
					changes,
					selection: EditorSelection.create(
						state.selection.ranges.map((r) => EditorSelection.cursor(changes.mapPos(r.from, 1))),
						state.selection.mainIndex
					),
					scrollIntoView: true,
					userEvent: 'input'
				})
			);
		}
	});

const INLINE: Record<string, string> = {
	'**': 'StrongEmphasis',
	'*': 'Emphasis',
	'~~': 'Strikethrough',
	'`': 'InlineCode'
};

/** Ctrl+B and friends: unwrap the bold / italic / code the selection lies in, else wrap it. */
export const toggle =
	(mark: string): StateCommand =>
	({ state, dispatch }) => {
		const n = mark.length;
		const spec = state.changeByRange((r) => {
			for (const side of [-1, 1] as const)
				for (
					let node: SyntaxNode | null = syntaxTree(state).resolveInner(r.from, side);
					node;
					node = node.parent
				)
					if (node.name === INLINE[mark] && node.from <= r.from && node.to >= r.to) {
						const [open, close] = [node.firstChild!, node.lastChild!];
						const changes = state.changes([
							{ from: open.from, to: open.to },
							{ from: close.from, to: close.to }
						]);
						return { changes, range: r.map(changes) };
					}
			// an empty pair (the command was just used without a selection) is taken back
			if (r.empty && state.sliceDoc(r.from - n, r.from + n) === mark + mark) {
				const changes = state.changes({ from: r.from - n, to: r.from + n });
				return { changes, range: r.map(changes) };
			}
			// the marks have to touch the text: "**word **" is not bold
			const text = state.sliceDoc(r.from, r.to);
			const from = r.from + (text.trim() ? text.length - text.trimStart().length : 0);
			const to = r.to - (text.trim() ? text.length - text.trimEnd().length : 0);
			return {
				changes: [
					{ from, insert: mark },
					{ from: to, insert: mark }
				],
				range:
					r.anchor > r.head
						? EditorSelection.range(to + n, from + n)
						: EditorSelection.range(from + n, to + n)
			};
		});
		dispatch(state.update(spec, { scrollIntoView: true, userEvent: 'input' }));
		return true;
	};

/**
 * Typing: `*`, `_`, `~` or `$` over a selection wraps it instead of replacing it. Brackets and
 * backticks are paired by CodeMirror's closeBrackets; a third backtick in a row is typed as it
 * is, so that a code fence doesn't end up with four. A `|` in a table cell is escaped: it is
 * text there, not the start of another cell. Text typed on the empty line right below a table
 * gets an empty line in front: markdown would take it for another row of the table. A second
 * `$` at the start of a line gets its closing `$$` (else the rest of the note would be math
 * until they are typed), and a `$` typed in front of the one that ends a formula goes over it.
 */
export const typing = EditorView.inputHandler.of((view, from, to, text) => {
	if (text.length !== 1 || view.composing) return false;
	if (from < to && '*_~$'.includes(text)) {
		view.dispatch({
			changes: [
				{ from, insert: text },
				{ from: to, insert: text }
			],
			selection: { anchor: from + 1, head: to + 1 },
			userEvent: 'input.type'
		});
		return true;
	}
	const { state } = view;
	const line = state.doc.lineAt(from);
	if (text === '$' && from === to) {
		const mark = syntaxTree(state).resolveInner(from, 1);
		const closing = mark.name === 'MathMark' && mark.prevSibling && mark.to > from;
		const second = from === line.to && /^\s*\$$/.test(line.text);
		if (closing || second) {
			view.dispatch({
				changes: second ? { from, insert: '$$$' } : [],
				selection: { anchor: from + 1 },
				userEvent: 'input.type'
			});
			return true;
		}
	}
	const insert =
		text === '|' && cellAt(state, from)
			? '\\|'
			: text === '`' && from === to && state.sliceDoc(from - 2, from + 1) === '``'
				? text
				: text !== '|' && !line.length && line.number > 1 && tableAt(state, line.from - 1)
					? '\n' + text
					: null;
	if (insert === null) return false;
	view.dispatch({
		changes: { from, to, insert },
		selection: { anchor: from + insert.length },
		userEvent: 'input.type'
	});
	return true;
});
