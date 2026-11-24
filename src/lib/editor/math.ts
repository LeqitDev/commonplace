// Math in notes: `$…$` in a line of text and `$$…$$` for a formula on its own, which may also
// fill several lines when the `$$` opens a line. What is between the dollars is Typst math.
import { tags as t } from '@lezer/highlight';
import type { Line, MarkdownConfig } from '@lezer/markdown';

const DOLLAR = 36;

/**
 * Whether a line opens a block: it starts with `$$`. (`$$x$$ and more text` does not: that is a
 * formula in a line of text.)
 */
function opens(line: Line) {
	if (line.next !== DOLLAR || line.text.charCodeAt(line.pos + 1) !== DOLLAR) return false;
	const rest = line.text.slice(line.pos + 2);
	const close = rest.indexOf('$$');
	return close < 0 || !rest.slice(close + 2).trim();
}

/** Where the `$$` that ends a line of a block is (behind it), -1 if the line has none. */
function closes(text: string, from: number) {
	const end = text.trimEnd().length;
	return end >= from + 2 && text.slice(end - 2, end) === '$$' ? end : -1;
}

export const mathSyntax: MarkdownConfig = {
	defineNodes: [
		{ name: 'InlineMath' },
		{ name: 'MathBlock', block: true },
		{ name: 'MathMark', style: t.processingInstruction }
	],
	parseInline: [
		{
			name: 'InlineMath',
			parse(cx, next, pos) {
				if (next !== DOLLAR) return -1;
				const n = cx.char(pos + 1) === DOLLAR ? 2 : 1;
				const text = cx.slice(pos + n, cx.end).split('\n', 1)[0]; // it ends in its line
				// up to the next `$` that is not escaped. A single `$` is only math when the two hug
				// what is between and no digit follows: "$5 and $10" is not.
				const close = text.search(n > 1 ? /(?<!\\)\$\$/ : /(?<!\\)\$/);
				if (close < 1 || (n === 1 && !/^\S(.*\S)?\$(?!\d)/.test(text.slice(0, close + 2))))
					return -1;
				const end = pos + n + close + n;
				return cx.addElement(
					cx.elt('InlineMath', pos, end, [
						cx.elt('MathMark', pos, pos + n),
						cx.elt('MathMark', end - n, end)
					])
				);
			}
		}
	],
	parseBlock: [
		{
			name: 'MathBlock',
			// like a code fence it ends a paragraph, and nothing in it is markdown
			endLeaf: (_, line) => opens(line),
			parse(cx, line) {
				if (!opens(line)) return false;
				const from = cx.lineStart + line.pos;
				const marks = [cx.elt('MathMark', from, from + 2)];
				let end = closes(line.text, line.pos + 2);
				let to = cx.lineStart + line.text.length;
				// up to the closing `$$`, or the end of the quote / list item it is in (`depth`, which
				// the types of lezer-markdown leave out: its own code fences end the same way)
				const inside = () => (line as Line & { depth: number }).depth >= cx.depth;
				while (end < 0 && cx.nextLine() && inside()) {
					end = closes(line.text, line.pos);
					to = cx.lineStart + line.text.length;
				}
				if (end >= 0) {
					to = cx.lineStart + end;
					marks.push(cx.elt('MathMark', to - 2, to));
					cx.nextLine();
				}
				cx.addElement(cx.elt('MathBlock', from, to, marks));
				return true;
			}
		}
	]
};
