// Tables. Their rows stay lines of the document, laid out as table rows by CSS, so cells are
// edited in place like any other text. What makes that safe: the cursor only stops in the text
// of cells (never in the pipes and the padding around them, which are hidden: `stayInCells`),
// and typing or deleting leaves those pipes alone (`keepPipes`). Rows and columns are changed
// with the commands below.
import { syntaxTree } from '@codemirror/language';
import {
	type ChangeDesc,
	type ChangeSpec,
	EditorSelection,
	EditorState,
	type Line,
	type SelectionRange,
	type StateCommand
} from '@codemirror/state';
import type { SyntaxNode } from '@lezer/common';

interface Span {
	from: number;
	to: number;
}
/** What is between two pipes, and the text in it (an empty span where the cursor goes, if none). */
interface Cell extends Span {
	text: Span;
}
interface Row {
	line: Line;
	cells: Cell[];
}
export interface Table {
	/** Header and body rows. */
	rows: Row[];
	/** The `|---|:-:|` row. */
	sep: Row;
}

/**
 * The cells of a line with pipes at `pipes`. The padding of a cell up to a cursor in it (one of
 * `heads`) counts as its text: a space typed at the end of a cell must not hide the cursor.
 */
function row(line: Line, pipes: number[], heads: number[] = []): Row {
	const cells = pipes.map((pipe, i) => ({ from: pipe + 1, to: pipes[i + 1] ?? line.to }));
	if (!line.text.slice(cells.at(-1)!.from - line.from).trim()) cells.pop(); // behind the last pipe
	return {
		line,
		cells: cells.map(({ from, to }) => {
			const text = line.text.slice(from - line.from, to - line.from);
			const empty = from + +(to > from); // an empty cell: behind one space
			const span = text.trim()
				? { from: from + text.length - text.trimStart().length, to: from + text.trimEnd().length }
				: { from: empty, to: empty };
			for (const head of heads)
				if (head >= from && head <= to)
					[span.from, span.to] = [Math.min(span.from, head), Math.max(span.to, head)];
			return { from, to, text: span };
		})
	};
}

/**
 * The table of a `Table` node. Null when it is left as plain text: inside a quote or a list, or
 * with a row that doesn't start with a pipe.
 */
export function tableOf(state: EditorState, node: SyntaxNode): Table | null {
	if (node.parent?.parent) return null;
	const rows: Row[] = [];
	const heads = state.selection.ranges.map((r) => r.head);
	let sep: Row | undefined;
	for (let child = node.firstChild; child; child = child.nextSibling) {
		const line = state.doc.lineAt(child.from);
		if (!/^ *\|/.test(line.text)) return null;
		if (child.name === 'TableDelimiter')
			sep = row(
				line,
				[...line.text.matchAll(/\|/g)].map((m) => line.from + m.index)
			);
		else
			rows.push(
				row(
					line,
					child.getChildren('TableDelimiter').map((d) => d.from),
					heads
				)
			);
	}
	return sep ? { rows, sep } : null;
}

/** The table `pos` is in, with the row and the column of `pos` (row -1: the delimiter row). */
export function tableAt(state: EditorState, pos: number) {
	for (const side of [1, -1] as const)
		for (let n: SyntaxNode | null = syntaxTree(state).resolveInner(pos, side); n; n = n.parent)
			if (n.name === 'Table') {
				const table = tableOf(state, n);
				if (!table) return null;
				const r = table.rows.findIndex((row) => pos <= row.line.to);
				const at = pos < table.sep.line.from || pos > table.sep.line.to ? table.rows[r] : table.sep;
				const c = Math.max(
					0,
					at.cells.findIndex((cell, i) => pos <= cell.to || i === at.cells.length - 1)
				);
				return { table, r: at === table.sep ? -1 : r, c };
			}
	return null;
}

/** A table is shown as its markdown while the cursor is on its delimiter row (it is being typed). */
export const isRaw = (table: Table, ranges: readonly SelectionRange[]) =>
	ranges.some((r) => r.head >= table.sep.line.from && r.head <= table.sep.line.to);

interface Place {
	table: Table;
	/** Index of the row in `table.rows` (0: the header) and of the column. */
	r: number;
	c: number;
	row: Row;
}

/** The cell `pos` is in, if that is in a table which is shown as one. */
export function cellAt(state: EditorState, pos: number): Place | null {
	const at = tableAt(state, pos);
	return at && at.r >= 0 && !isRaw(at.table, state.selection.ranges)
		? { ...at, row: at.table.rows[at.r] }
		: null;
}

/**
 * What is hidden of a table: everything between the texts of its cells, the line breaks around
 * it included (so that the cursor can't get in front of the first pipe or behind the last one;
 * the last gap ends behind the document when the table ends it). Only the very start of the
 * document stays free: Enter there puts a line above a table that the note begins with.
 */
export function gaps(table: Table): Span[] {
	const texts = table.rows.flatMap((row) => row.cells.map((cell) => cell.text));
	const [first, last] = [table.rows[0].line, table.rows.at(-1)!.line];
	const out: Span[] = [];
	let pos = Math.max(0, first.from - 1);
	for (const text of texts) {
		out.push({ from: pos, to: text.from });
		pos = text.to;
	}
	out.push({ from: pos, to: Math.max(last.to, table.sep.line.to) + 1 });
	return out.filter((gap) => gap.from < gap.to);
}

const alignments = { left: ' :--- ', center: ' :---: ', right: ' ---: ' };
export type Align = keyof typeof alignments;

/** Alignment of the columns, from the colons of the delimiter row. */
export const aligns = (state: EditorState, table: Table): Align[] =>
	table.sep.cells.map((cell) => {
		const text = state.sliceDoc(cell.from, cell.to).trim();
		return !text.endsWith(':') ? 'left' : text.startsWith(':') ? 'center' : 'right';
	});

/**
 * The cursor only stops in the text of cells. One that is moved into what is hidden of a table
 * goes on: across it when it came from one of its ends (arrow keys: to the next / previous cell),
 * else to the nearest cell text, of its line if there is one (clicks, Home / End, up / down).
 *
 * A cursor also has a side it sticks to, which decides where it is drawn. At the start of a cell
 * that must be the text behind it: in front of it is the pipe, which belongs to the cell before.
 */
export const stayInCells = EditorState.transactionFilter.of((tr) => {
	const state = tr.startState;
	if (!tr.selection) return tr;
	if (tr.docChanged) {
		// (the new document isn't parsed yet: every cursor that sticks to what is in front of it)
		const { ranges, mainIndex } = tr.selection;
		if (!ranges.some((r) => r.empty && r.assoc < 0) || !cellAt(state, state.selection.main.head))
			return tr;
		const forward = ranges.map((r) => (r.empty ? EditorSelection.cursor(r.head, 1) : r));
		return [tr, { selection: EditorSelection.create(forward, mainIndex), sequential: true }];
	}
	const before = state.selection.ranges.map((r) => r.head);
	const snap = (pos: number) => {
		const table = tableAt(state, pos)?.table;
		// while it is typed (shown as markdown) the cursor moves freely in its delimiter row
		if (!table || (isRaw(table, state.selection.ranges) && isRaw(table, tr.selection!.ranges)))
			return pos;
		const gap = gaps(table).find((gap) => gap.from < pos && pos < gap.to);
		if (!gap) return pos;
		const open = gap.to <= state.doc.length; // else nothing is behind it
		if (before.includes(gap.from) && open) return gap.to;
		if (before.includes(gap.to)) return gap.from;
		const line = state.doc.lineAt(pos);
		const here = [gap.from, gap.to].filter((end) => end >= line.from && end <= line.to);
		if (here.length === 1) return here[0];
		return !open || pos - gap.from < gap.to - pos ? gap.from : gap.to;
	};
	let moved = false;
	const ranges = tr.selection.ranges.map((r) => {
		const [anchor, head] = [snap(r.anchor), snap(r.head)];
		const at = anchor === head && cellAt(state, head);
		const to =
			anchor < head || anchor > head
				? EditorSelection.range(anchor, head)
				: EditorSelection.cursor(head, at && at.row.cells[at.c]?.text.from === head ? 1 : r.assoc);
		moved ||= !to.eq(r, true);
		return to;
	});
	return moved ? [tr, { selection: EditorSelection.create(ranges, tr.selection.mainIndex) }] : tr;
});

/**
 * Typing and deleting leave the hidden parts of a table alone: Backspace at the start of a cell
 * or deleting a selection over several cells doesn't join cells or rows. A row that is deleted as
 * a whole (the selection covers its line) does go.
 */
export const keepPipes = EditorState.changeFilter.of((tr) => {
	if (!tr.isUserEvent('delete') && !tr.isUserEvent('input')) return true;
	const state = tr.startState;
	const deleted: Span[] = [];
	tr.changes.iterChangedRanges((from, to) => from < to && deleted.push({ from, to }));
	const tables = new Map<number, Table>();
	for (const { from, to } of deleted)
		syntaxTree(state).iterate({
			from,
			to,
			enter(n) {
				if (n.name !== 'Table') return;
				const table = tableOf(state, n.node);
				if (table && !isRaw(table, state.selection.ranges)) tables.set(n.from, table);
				return false;
			}
		});
	const keep: number[] = [];
	for (const { rows, sep } of tables.values()) {
		const lines = [rows[0], sep, ...rows.slice(1)];
		const whole = (row?: Row) =>
			!row || deleted.some((d) => d.from <= row.line.from && d.to >= row.line.to);
		lines.forEach((row, i) => {
			if (whole(row)) return;
			let pos = row.line.from;
			for (const { text } of row === sep ? [] : row.cells) {
				if (pos < text.from) keep.push(pos, text.from);
				pos = text.to;
			}
			// its line break as well, unless the next row goes as a whole
			keep.push(pos, row.line.to + +!whole(lines[i + 1]));
		});
	}
	return keep.length ? keep : true;
});

const emptyRow = (cells: number) => '|' + '  |'.repeat(cells);
/** Where cell `c` of an `emptyRow` is in its text. */
const inEmptyRow = (c: number) => 2 + 3 * c;
const isEmpty = (row: Row) => row.cells.every((cell) => cell.text.from === cell.text.to);

/** Changes to a table; `cursor` tells where the cursor goes, given those changes. */
interface Edit {
	changes: ChangeSpec;
	cursor?: (changes: ChangeDesc) => number;
}

/** A command that edits the table the cursor is in (and does nothing elsewhere). */
const inTable =
	(edit: (at: Place, state: EditorState) => Edit | null): StateCommand =>
	({ state, dispatch }) => {
		const at = cellAt(state, state.selection.main.head);
		const result = at && edit(at, state);
		if (!result) return false;
		const changes = state.changes(result.changes);
		dispatch(
			state.update({
				changes,
				selection: result.cursor && { anchor: result.cursor(changes) },
				scrollIntoView: true,
				userEvent: 'input',
				filter: false // these do touch the pipes
			})
		);
		return true;
	};

/** The row goes; the cursor stays in its column, or goes to the end of the row above (`back`). */
const removeRow = ({ table, r, c, row }: Place, back = false): Edit | null => {
	if (!r) return null; // a table can't be without its header
	const next = (!back && table.rows[r + 1]) || table.rows[r - 1];
	const cell = next.cells[back ? next.cells.length - 1 : Math.min(c, next.cells.length - 1)];
	return {
		changes: { from: row.line.from - 1, to: row.line.to },
		cursor: cell && ((changes) => changes.mapPos(cell.text.to))
	};
};

const removeTable = ({ table: { rows, sep } }: Place): Edit => ({
	changes: { from: rows[0].line.from, to: Math.max(rows.at(-1)!.line.to, sep.line.to) }
});

/** A new row above (-1) or below (1) the one with the cursor, which goes to it. */
export const insertRow = (dir: 1 | -1, firstCell = false) =>
	inTable(({ table, r, c, row }) => {
		if (!r && dir < 0) return null; // nothing goes above the header
		const cells = table.rows[0].cells.length;
		const at = dir < 0 ? row.line.from : (r ? row : table.sep).line.to;
		const col = firstCell ? 0 : Math.min(c, cells - 1);
		return {
			changes: { from: at, insert: dir < 0 ? emptyRow(cells) + '\n' : '\n' + emptyRow(cells) },
			cursor: (changes) => changes.mapPos(at, -1) + +(dir > 0) + inEmptyRow(col)
		};
	});

/** A new column left (-1) or right (1) of the one with the cursor, which goes to it. */
export const insertColumn = (dir: 1 | -1) =>
	inTable(({ table, c, row }) => {
		if (!row.cells[c]) return null;
		const at = (line: Row) => (dir < 0 ? line.cells[c].from - 1 : line.cells[c].to);
		return {
			changes: [table.sep, ...table.rows]
				.filter((line) => line.cells[c])
				.map((line) => ({ from: at(line), insert: line === table.sep ? '| --- ' : '|  ' })),
			cursor: (changes) => changes.mapPos(at(row), -1) + 2
		};
	});

export const deleteRow = inTable((at) => removeRow(at));

/** The column with the cursor goes; the last one takes the table along. */
export const deleteColumn = inTable((at) => {
	const { table, c, row } = at;
	if (table.rows[0].cells.length < 2) return removeTable(at);
	const next = row.cells[c + 1] ?? row.cells[c - 1];
	return {
		changes: [table.sep, ...table.rows]
			.filter((line) => line.cells[c])
			.map((line) => ({ from: line.cells[c].from - 1, to: line.cells[c].to })),
		cursor: next && ((changes) => changes.mapPos(next.text.to))
	};
});

export const deleteTable = inTable(removeTable);

export const alignColumn = (align: Align) =>
	inTable(({ table, c }) => {
		const cell = table.sep.cells[c];
		return cell ? { changes: { from: cell.from, to: cell.to, insert: alignments[align] } } : null;
	});

/**
 * Enter in a table: a new row below, cursor in its first cell. In an empty last row it leaves the
 * table instead: the row becomes an empty line, and the cursor goes to a line below that one
 * (text right below a table would be a row of it). In front of a table that the note begins
 * with, it puts an empty line above it.
 */
export const enterRow: StateCommand = (target) =>
	inTable(({ table, r, row }, state) => {
		const { from, to } = row.line;
		if (state.selection.main.head === from)
			return { changes: { from, insert: '\n' }, cursor: () => from };
		return r && r === table.rows.length - 1 && isEmpty(row)
			? { changes: { from, to, insert: '\n' }, cursor: (changes) => changes.mapPos(to, 1) }
			: null;
	})(target) || insertRow(1, true)(target);

/** Backspace in an empty row removes it. */
export const backspaceRow = inTable((at) => (isEmpty(at.row) ? removeRow(at, true) : null));

/** Tab / Shift+Tab: to the next / previous cell; behind the last one, to a new row. */
export const nextCell =
	(dir: 1 | -1): StateCommand =>
	(target) => {
		const { state, dispatch } = target;
		const at = cellAt(state, state.selection.main.head);
		if (!at) return false;
		const cells = at.table.rows.flatMap((row) => row.cells);
		const i = cells.indexOf(at.row.cells[at.c]) + dir;
		if (i >= cells.length) return insertRow(1, true)(target);
		if (i >= 0)
			dispatch(
				state.update({
					selection: { anchor: cells[i].text.to },
					scrollIntoView: true,
					userEvent: 'select'
				})
			);
		return true;
	};

/**
 * Enter behind a line of cells (`| a | b |`) that is not a table yet makes it the header of one:
 * the delimiter row and an empty first row are added.
 */
export const startTable: StateCommand = ({ state, dispatch }) => {
	const { head, empty } = state.selection.main;
	const line = state.doc.lineAt(head);
	const block = syntaxTree(state).resolve(line.from, 1);
	const cells = (line.text.match(/(?<!\\)\|/g)?.length ?? 0) - 1;
	if (!empty || head < line.to || cells < 1 || !/^\|.*\|$/.test(line.text.trim())) return false;
	if (block.name !== 'Paragraph' || block.parent?.parent || block.from < line.from) return false;
	const insert = `\n|${' --- |'.repeat(cells)}\n${emptyRow(cells)}`;
	dispatch(
		state.update({
			changes: { from: head, insert },
			selection: { anchor: head + insert.length - emptyRow(cells).length + inEmptyRow(0) },
			scrollIntoView: true,
			userEvent: 'input'
		})
	);
	return true;
};
