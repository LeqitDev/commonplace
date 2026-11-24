import { describe, expect, test } from 'bun:test';
import { EditorSelection, EditorState } from '@codemirror/state';
import { enter, toggle } from '../src/lib/editor/commands.ts';
import { extensions, linkAt } from '../src/lib/editor/index.ts';
import { moveItem, nest } from '../src/lib/editor/lists.ts';
import { foldable } from '@codemirror/language';
import { imageOptions, setImage } from '../src/lib/editor/images.ts';
import { decorate, inlineMath, mathPopup } from '../src/lib/editor/preview.ts';
import {
	alignColumn,
	backspaceRow,
	deleteColumn,
	deleteRow,
	deleteTable,
	insertColumn,
	insertRow,
	nextCell
} from '../src/lib/editor/tables.ts';

const state = (doc: string, onchange: (md: string) => void = () => {}) =>
	EditorState.create({ doc, extensions: extensions({ onchange }) });

// markdown as Milkdown wrote it, plus things a normalising editor would touch
const SAMPLE = `# Title

* star bullet
-   wide bullet
1) paren list

Escaped \\[brackets\\] and a hard break  
next line<br />

| a | b |
|---|:-:|
| 1 | 2 |

- [ ] todo
- [x] done

Setext
======
`;

/**
 * Run a command on `doc`, where `‹` `›` enclose the selection, or `|` is the cursor (`‸` if
 * there is one: tables are full of `|`).
 */
const run = (cmd: typeof enter, src: string) => {
	const caret = src.includes('‸') ? '‸' : '|';
	const a = Math.max(src.indexOf('‹'), src.indexOf(caret));
	const b = src.includes('›') ? src.indexOf('›') - 1 : a;
	const doc = src.replace(/[‹›]/g, '').replace(caret, '');
	let s = EditorState.create({
		doc,
		selection: { anchor: a, head: b },
		extensions: extensions({ onchange() {} })
	});
	cmd({ state: s, dispatch: (tr) => (s = tr.state) });
	const { from, to } = s.selection.main;
	const out = s.doc.toString();
	return from === to
		? out.slice(0, from) + caret + out.slice(from)
		: out.slice(0, from) + '‹' + out.slice(from, to) + '›' + out.slice(to);
};

describe('markdown editor', () => {
	test('the text is never rewritten', () => {
		expect(state(SAMPLE).doc.toString()).toBe(SAMPLE);
		const s = state(SAMPLE);
		const edited = s.update({ changes: { from: s.doc.length, insert: 'x' } }).state;
		expect(edited.doc.toString()).toBe(SAMPLE + 'x');
	});

	test('link target under the cursor', () => {
		const doc =
			'see [a note](/notes/abc) and ![img](/files/f1) or <https://x.org> and https://y.org now';
		const s = state(doc);
		const at = (needle: string) => linkAt(s, doc.indexOf(needle) + 1);
		expect(at('a note')).toBe('/notes/abc');
		expect(at('/notes/abc')).toBe('/notes/abc');
		expect(at('img')).toBe('/files/f1');
		expect(at('https://x.org')).toBe('https://x.org');
		expect(at('https://y.org')).toBe('https://y.org');
		expect(at('see')).toBeNull();
		expect(at('now')).toBeNull();
	});
});

describe('Enter in lists', () => {
	/** Press Enter at the end of `doc`; null when the command leaves it to the default. */
	const press = (doc: string) => {
		let out: string | null = null;
		const s = EditorState.create({
			doc,
			selection: { anchor: doc.length },
			extensions: extensions({ onchange() {} })
		});
		enter({
			state: s,
			dispatch: (tr) => {
				expect(tr.state.selection.main.head).toBe(tr.state.doc.length);
				out = tr.state.doc.toString();
			}
		});
		return out;
	};

	test.each([
		['continues a list', '- a', '- a\n- '],
		['continues a nested list', '- a\n    - b', '- a\n    - b\n    - '],
		['numbers the next item', '1. a\n2. b', '1. a\n2. b\n3. '],
		['empty item ends the list (no blank line pushed in)', '- a\n- ', '- a\n'],
		['empty first item ends the list', '- ', ''],
		['empty nested item goes one level back', '- a\n    - b\n    - ', '- a\n    - b\n- '],
		['no blank line after items separated by one', '- a\n\n- b', '- a\n\n- b\n- '],
		['same for numbered items', '1. a\n\n2. b', '1. a\n\n2. b\n3. '],
		['same inside a quote', '> - a\n>\n> - b', '> - a\n>\n> - b\n> - '],
		['continues a quote', '> a', '> a\n> ']
	])('%s', (_, doc, want) => expect(press(doc)).toBe(want));

	test('plain text is left to the default Enter', () => expect(press('hello')).toBeNull());

	test.each([
		['closes a code fence that was just typed', '```js|', '```js\n|\n```'],
		['before the text it would swallow', 'a\n~~~|\n\nb', 'a\n~~~\n|\n~~~\n\nb'],
		['inside a list item', '- a\n- ```|', '- a\n- ```\n  |\n  ```'],
		['inside a quote', '> ```|', '> ```\n> |\n> ```'],
		['not one that is closed', '```|\n```', '```|\n```'],
		['nor from inside the code', '```\ncode|', '```\ncode|'],
		['closes a math block as well', 'a\n$$|\n\nb', 'a\n$$\n|\n$$\n\nb'],
		['opens up an empty one', '$$|$$', '$$\n|\n$$'],
		['not one with something in it', '$$x|$$', '$$x|$$']
	])('%s', (_, src, want) => expect(run(enter, src)).toBe(want));
});

describe('live preview', () => {
	/** What is on screen for `doc`; `|` is the cursor (none: the editor is not focused). */
	const shown = (src: string) => {
		const caret = src.includes('‸') ? '‸' : src.split('|').length > 2 ? 'none' : '|'; // tables: `‸`
		const at = src.indexOf(caret);
		const doc = src.replace(caret, '');
		const s = EditorState.create({
			doc,
			selection: { anchor: Math.max(at, 0) },
			extensions: extensions({ onchange() {} })
		});
		let out = '';
		let pos = 0;
		for (let i = decorate(s, at >= 0).iter(); i.value; i.next()) {
			if (i.value.spec.class) continue; // styling only
			const w = i.value.spec.widget;
			const glyph = {
				Rule: '―',
				Bullet: '•',
				Check: w?.checked ? '☑' : '☐',
				Img: `▣${w?.src}`,
				Formula: `${w?.display ? '∑∑' : '∑'}${w?.src}`
			}[w?.constructor.name as string];
			out += doc.slice(pos, i.from) + (glyph ?? '');
			pos = i.to;
		}
		return out + doc.slice(pos);
	};

	test.each([
		[
			'inline marks',
			'Some **bold**, *it*, __b__, ~~gone~~ and `code`',
			'Some bold, it, b, gone and code'
		],
		['nested marks', '**bold *both***', 'bold both'],
		['cursor inside reveals that element only', '**bo|ld** and *it*', '**bold** and it'],
		['cursor at its edge reveals too', '**bold**| and *it*', '**bold** and it'],
		['cursor one further does not', '**bold** |and *it*', 'bold and it'],
		['link', 'a [note](/notes/1 "t") b', 'a note b'],
		['link with the cursor in it', 'a [no|te](/notes/1) b', 'a [note](/notes/1) b'],
		['styled link text', '[a **b**](/x)', 'a b'],
		['autolink', '<https://x.org> https://y.org', 'https://x.org https://y.org'],
		['reference links and empty texts stay', '[a][b] [](/x)', '[a][b] [](/x)'],
		['image', 'a ![alt *x*](/files/1 "t") b', 'a ▣/files/1 b'],
		[
			'image with the cursor in it: behind its markdown',
			'![a|lt](</f 1.png>)',
			'![alt](</f 1.png>)▣/f 1.png'
		],
		['image as a link', '[![a](/i.png)](/x)', '▣/i.png'],
		['reference images stay', '![alt][ref]', '![alt][ref]'],
		['escape', 'a \\[b\\] \\* c', 'a [b] * c'],
		['heading', '## Title\ntext', 'Title\ntext'],
		['heading with closing marks', '# Title #', 'Title '],
		['heading under the cursor', '## Ti|tle\n# Other', '## Title\nOther'],
		['empty heading keeps its mark', '#\n\n## ', '#\n\n## '],
		['setext heading stays', 'Title\n===', 'Title\n==='],
		['quote', '> one **b**\n> two\nlazy', 'one b\ntwo\nlazy'],
		['quote line under the cursor', '> one\n> t|wo', 'one\n> two'],
		['rule', 'a\n\n---\n\nb', 'a\n\n―\n\nb'],
		['rule under the cursor', 'a\n\n---|', 'a\n\n---'],
		['bullets', '- a\n* b\n    + c', '• a\n• b\n    • c'],
		['numbers stay', '1. a\n2) b', '1. a\n2) b'],
		['bullet with the cursor on it', '|- a\n- b', '- a\n• b'],
		['but not with the cursor in its text', '- |a\n- b', '• a\n• b'],
		['checkboxes', '- [ ] a\n* [x] b\n1. [X] c', '☐ a\n☑ b\n1. ☑ c'],
		['checkbox with the cursor in its marker', '- [x|] a\n- [ ] b', '- [x] a\n☐ b'],
		['or on the bullet in front of it', '-| [ ] a', '- [ ] a'],
		['checkbox with the cursor in its text', '- [ ] |a', '☐ a'],
		['brackets that are no checkbox', '- [y] a\n[ ] b', '• [y] a\n[ ] b'],
		['code fences: the language stays as a label', '```js\nlet a = `x`\n```', 'js\nlet a = `x`\n'],
		['fence under the cursor', '~~~|\ncode\n~~~', '~~~\ncode\n'],
		[
			'nothing in code is markdown',
			'```\n**a** \\* [b](c)\n```\n\n    > *d*',
			'\n**a** \\* [b](c)\n\n\n    > *d*'
		],
		['nor in an HTML block', '<div>\n**a**\n</div>', '<div>\n**a**\n</div>']
	])('%s', (_, src, want) => expect(shown(src)).toBe(want));

	test.each([
		[
			'table: only the text of its cells',
			'| a | **b** |\n|---|:-:|\n|1|  |  2\n',
			'ab\n|---|:-:|\n12\n'
		],
		['with the cursor in a cell', '| a‸ | b |\n|-|-|', 'ab\n|-|-|'],
		['as markdown while its delimiter row is typed', '| a | b |\n|-|-‸', '| a | b |\n|-|-'],
		['not inside a quote', '> | a |\n> |---|', '| a |\n|---|'],
		['nor without pipes in front', 'a | b\n--|--', 'a | b\n--|--']
	])('%s', (_, src, want) => expect(shown(src)).toBe(want));

	test('rows and cells of a table', () => {
		const doc = 'x\n\n| a | b | c |\n|:--|:-:|--:|\n| 1 |\n';
		const marks: string[] = [];
		for (let i = decorate(state(doc), false).iter(); i.value; i.next()) {
			const cls: string = i.value.spec.class ?? '';
			if (cls.startsWith('md-t')) marks.push(`${cls} ${JSON.stringify(doc.slice(i.from, i.to))}`);
		}
		expect(marks).toEqual([
			'md-tr md-th ""',
			'md-td md-td-left "| a |"',
			'md-td md-td-center " b |"',
			'md-td md-td-right " c |"',
			'md-tsep ""',
			'md-tr ""',
			'md-td md-td-left "| 1 |"'
		]);
	});

	test.each([
		['math', 'a $x^2$ b', 'a ∑x^2 b'],
		['nothing in it is markdown', '$a*b*c$ and $[x](y)$', '∑a*b*c and ∑[x](y)'],
		['with the cursor in it', 'a $x^|2$ b $y$', 'a $x^2$ b ∑y'],
		['prices are not math', 'from $5 to $10, or 5 $ and 10 $', 'from $5 to $10, or 5 $ and 10 $'],
		['also next to math', '$5 and $10 or $x$', '$5 and $10 or ∑x'],
		['nor is an escaped dollar', 'a \\$x$ b', 'a $x$ b'],
		['it ends in its line', 'a $x\ny$ b', 'a $x\ny$ b'],
		['a formula on its own, in a line of text', 'a $$x^2$$ b', 'a ∑∑x^2 b'],
		['and as a block', '$$ x^2 $$', '∑∑ x^2 '],
		['with the cursor in it: the formula stays, below', '$$x|^2$$', '$$x^2$$∑∑x^2'],
		['an empty one stays as it is', '$$$$ and\n\n$$$$', '$$$$ and\n\n$$$$'],
		['one that is not closed is text', '$$\nx *y*', '$$\nx *y*']
	])('%s', (_, src, want) => expect(shown(src)).toBe(want));

	test('a formula of several lines is drawn in its first one', () => {
		const doc = 'a\n$$\nx = 1\n\n- y $$\nb';
		const lines = (focused: boolean) => {
			const out: string[] = [];
			const s = EditorState.create({
				doc,
				selection: { anchor: doc.indexOf('x') },
				extensions: extensions({ onchange() {} })
			});
			for (let i = decorate(s, focused).iter(); i.value; i.next()) {
				const { class: cls, widget } = i.value.spec;
				const line = doc.slice(0, i.from).split('\n').length;
				if (widget) out.push(`${line} formula ${JSON.stringify(widget.src)}`);
				else if (/md-(pre|gone)/.test(cls)) out.push(`${line} ${cls}`);
			}
			return out;
		};
		expect(lines(false)).toEqual([
			'2 formula "\\nx = 1\\n\\n- y "',
			'3 md-gone',
			'4 md-gone',
			'5 md-gone'
		]);
		// with the cursor in it: its lines as a block, the formula behind the last one
		expect(lines(true)).toEqual([
			'2 md-pre md-pre-first',
			'3 md-pre',
			'4 md-pre',
			'5 md-pre md-pre-last',
			'5 formula "\\nx = 1\\n\\n- y "'
		]);
	});

	test('lines of code blocks', () => {
		const doc = 'a\n```\nx\n```\n\n    one line\n\n- b\n  ~~~\n  y';
		const lines: string[] = [];
		for (let i = decorate(state(doc), false).iter(); i.value; i.next()) {
			const cls: string = i.value.spec.class ?? '';
			if (/md-(pre|fence)/.test(cls))
				lines.push(`${doc.slice(0, i.from).split('\n').length} ${cls}`);
		}
		expect(lines).toEqual([
			'2 md-pre md-pre-first',
			'2 md-fence',
			'3 md-pre',
			'4 md-pre md-pre-last',
			'4 md-fence',
			'6 md-pre md-pre-first md-pre-last',
			'9 md-pre md-pre-first',
			'9 md-fence',
			'10 md-pre md-pre-last'
		]);
	});

	test('a selection reveals everything it touches', () => {
		const doc = '**a** *b* `c`';
		const s = EditorState.create({
			doc,
			selection: { anchor: 3, head: 7 },
			extensions: extensions({ onchange() {} })
		});
		const hidden: string[] = [];
		for (let i = decorate(s, true).iter(); i.value; i.next())
			if (!i.value.spec.class) hidden.push(doc.slice(i.from, i.to));
		expect(hidden).toEqual(['`', '`']);
	});
});

describe('lists', () => {
	test('lines of an item are indented by its depth, behind what precedes their text', () => {
		const doc = '- a\n  more\n    1. [x] b\nlazy\n\ntext\n> - q\n>   r';
		const s = state(doc);
		const lines: string[] = [];
		for (let i = decorate(s, false).iter(); i.value; i.next()) {
			const { class: cls, attributes } = i.value.spec;
			if (cls === 'md-li') lines.push(attributes.style.replace('--md-depth: ', ''));
			if (cls === 'md-lead') lines[lines.length - 1] += `:${doc.slice(i.from, i.to)}`;
		}
		expect(lines).toEqual(['1:- ', '1:  ', '2:    1. [x] ', '2', '1:> - ', '1:>   ']);
	});

	test.each([
		['goes under the item above', '- a\n- b|', '- a\n  - b|'],
		['as far as that one needs', '1. a\n- x\n\n10. a\n11. b|', '1. a\n- x\n\n10. a\n    1. b|'],
		['a first item stays', '- a|\n- b', '- a|\n- b'],
		[
			'takes what is below it along',
			'- a\n- b|\n  more\n    - c\n- d',
			'- a\n  - b|\n    more\n      - c\n- d'
		],
		['all selected items', '- a\n- ‹b\n- c›\n- d', '- a\n  - ‹b\n  - c›\n- d'],
		['tasks', '- [ ] a\n- [ ] b|', '- [ ] a\n  - [ ] b|'],
		['inside a quote', '> - a\n> - b|', '> - a\n>   - b|'],
		['numbers follow', '1. a\n2. b|\n3. c', '1. a\n   1. b|\n2. c'],
		['joins the list that is there', '1. a\n   1. x\n2. b|\n3. c', '1. a\n   1. x\n   2. b|\n2. c'],
		['a list that starts elsewhere keeps its start', '5. a\n6. b\n7. c|', '5. a\n6. b\n   1. c|']
	])('Tab: %s', (_, src, want) => expect(run(nest(1), src)).toBe(want));

	test.each([
		['back to the level of its parent', '- a\n  - b|', '- a\n- b|'],
		['however far it was indented', '- a\n    - b|', '- a\n- b|'],
		['takes what is below it along', '- a\n  - b|\n    - c', '- a\n- b|\n  - c'],
		[
			'numbers follow',
			'1. a\n   1. b\n   2. c|\n   3. d\n2. e',
			'1. a\n   1. b\n2. c|\n   1. d\n3. e'
		],
		['inside a quote', '> - a\n>   - b|', '> - a\n> - b|'],
		['top level stays', '- a\n- b|', '- a\n- b|']
	])('Shift+Tab: %s', (_, src, want) => expect(run(nest(-1), src)).toBe(want));

	test.each([
		['down', '- a|\n- b', '- b\n- a|'],
		['up, with what is below it', '- a\n- b|\n  - c\n- d', '- b|\n  - c\n- a\n- d'],
		['down, from a line below its first', '- a\n  mo|re\n- b', '- b\n- a\n  mo|re'],
		['down: numbers stay in order', '1. a|\n2. b', '1. b\n2. a|'],
		['down: a selection goes along', '9. ‹a›\n10. b', '9. b\n10. ‹a›'],
		['down, among its siblings only', '- a\n  - x|\n  - y\n- b', '- a\n  - y\n  - x|\n- b'],
		['down: the last one stays', '- a\n  - x\n  - y|\n- b', '- a\n  - x\n  - y|\n- b'],
		['up: the first one stays', '- a|\n- b', '- a|\n- b'],
		['down, inside a quote', '> - a|\n> - b', '> - b\n> - a|'],
		['down, loose lists', '- a|\n\n- b\n\ntext', '- b\n\n- a|\n\ntext']
	])('move item %s', (name, src, want) =>
		expect(run(moveItem(name.startsWith('up') ? -1 : 1), src)).toBe(want)
	);

	test('moving outside of a list is not handled here', () => {
		expect(moveItem(-1)({ state: state('text'), dispatch() {} })).toBe(false);
	});

	test('a marker without its space is marked as such', () => {
		const classes = (doc: string) => {
			const out: string[] = [];
			for (let i = decorate(state(doc), false).iter(); i.value; i.next())
				if (i.value.spec.class?.startsWith('md-lead')) out.push(i.value.spec.class);
			return out;
		};
		expect(classes('-')).toEqual(['md-lead md-lead-bare']);
		expect(classes('- ')).toEqual(['md-lead']);
	});

	test('Tab outside of a list is not handled here', () => {
		expect(nest(1)({ state: state('text'), dispatch() {} })).toBe(false);
	});

	test('nor in a code block of a list item', () => {
		const doc = '- a\n- b\n  ```\n  code\n  ```';
		const s = EditorState.create({
			doc,
			selection: { anchor: doc.indexOf('code') + 4 },
			extensions: extensions({ onchange() {} })
		});
		expect(nest(1)({ state: s, dispatch() {} })).toBe(false);
	});
});

describe('tables', () => {
	const T = '| a | b |\n|---|---|\n';

	test.each([
		[
			'Enter behind a row of cells starts a table',
			enter,
			'| a | b |‸',
			'| a | b |\n| --- | --- |\n| ‸ |  |'
		],
		['but not in the middle of text', enter, 'x\n| a |‸', 'x\n| a |‸'],
		[
			'Enter adds a row below',
			enter,
			T + '| 1‸ | 2 |\n| 3 | 4 |',
			T + '| 1 | 2 |\n| ‸ |  |\n| 3 | 4 |'
		],
		[
			'below the header: the first row',
			enter,
			'| a‸ | b |\n|---|---|\n| 1 | 2 |',
			T + '| ‸ |  |\n| 1 | 2 |'
		],
		[
			'Enter in an empty last row leaves the table',
			enter,
			T + '| 1 | 2 |\n|  | ‸ |',
			T + '| 1 | 2 |\n\n‸'
		],
		['Enter in front of a table at the very top: a line above', enter, '‸' + T, '‸\n' + T],
		[
			'Backspace in an empty row removes it',
			backspaceRow,
			T + '| 1 | 2 |\n| ‸ |  |',
			T + '| 1 | 2‸ |'
		],
		['Tab goes to the next cell', nextCell(1), T + '| 1‸ | 2 |', T + '| 1 | 2‸ |'],
		['and to the next row', nextCell(1), '| a | b‸ |\n|---|---|\n| 1 | 2 |', T + '| 1‸ | 2 |'],
		['behind the last cell: a new row', nextCell(1), T + '| 1 | 2‸ |', T + '| 1 | 2 |\n| ‸ |  |'],
		['Shift+Tab goes back', nextCell(-1), T + '| ‸1 | 2 |', '| a | b‸ |\n|---|---|\n| 1 | 2 |'],
		['row above', insertRow(-1), T + '| 1 | 2‸ |', T + '|  | ‸ |\n| 1 | 2 |'],
		[
			'column left',
			insertColumn(-1),
			T + '| 1 | 2‸ |',
			'| a |  | b |\n|---| --- |---|\n| 1 | ‸ | 2 |'
		],
		[
			'column right',
			insertColumn(1),
			T + '| 1‸ | 2 |\n| 3',
			'| a |  | b |\n|---| --- |---|\n| 1 | ‸ | 2 |\n| 3|  '
		],
		['delete row', deleteRow, T + '| 1 | 2 |\n| 3 | 4‸ |', T + '| 1 | 2‸ |'],
		['the header stays', deleteRow, '| a‸ | b |\n|---|---|', '| a‸ | b |\n|---|---|'],
		['delete column', deleteColumn, T + '| 1‸ | 2 |', '| b |\n|---|\n| 2‸ |'],
		[
			'the last column takes the table along',
			deleteColumn,
			'x\n\n| a |\n|---|\n| 1‸ |\n\ny',
			'x\n\n‸\n\ny'
		],
		['delete table', deleteTable, 'x\n\n' + T + '| 1‸ | 2 |', 'x\n\n‸'],
		['align', alignColumn('right'), T + '| 1 | 2‸ |', '| a | b |\n|---| ---: |\n| 1 | 2‸ |'],
		['outside of a table nothing happens', insertRow(1), 'text‸', 'text‸']
	])('%s', (_, cmd, src, want) => expect(run(cmd, src)).toBe(want));

	/** Where the cursor ends up when it is put at `to`, coming from `from` (offsets into `doc`). */
	const move = (doc: string, from: number, to: number) =>
		state(doc)
			.update({ selection: { anchor: from } })
			.state.update({ selection: { anchor: to } }).state.selection.main.head;

	test('the cursor only stops in the text of cells', () => {
		const doc = 'x\n\n| ab | c |\n|----|---|\n| 1  |   |\n\ny';
		const at = (s: string, off = 0) => doc.indexOf(s) + off;
		expect(move(doc, 0, at('ab'))).toBe(at('ab'));
		// arrow keys: across what is hidden, to the next cell, the next row, out of the table
		expect(move(doc, at('ab', 2), at('ab', 3))).toBe(at('c'));
		expect(move(doc, at('c'), at('c') - 1)).toBe(at('ab', 2));
		expect(move(doc, at('c', 1), at('c', 2))).toBe(at('1'));
		expect(move(doc, at('ab'), at('ab') - 1)).toBe(2); // the empty line above
		expect(move(doc, at('1', 1), at('1', 2))).toBe(at('1', 5)); // the empty cell
		expect(move(doc, at('1', 5), at('1', 6))).toBe(at('y') - 1); // the empty line below
		// from elsewhere (click, Home / End, up / down): the nearest text of that line
		expect(move(doc, 0, at('| ab'))).toBe(at('ab'));
		expect(move(doc, 0, at('c |', 3))).toBe(at('c', 1));
		expect(move(doc, 0, at('|--', 4))).toBe(at('c', 1)); // the delimiter row is hidden
	});

	test('a table that ends the note has nothing behind its last cell', () => {
		const doc = '| a | b |\n|---|---|\n| 1 | 2 |';
		const end = doc.lastIndexOf('2') + 1;
		expect(move(doc, 0, doc.length)).toBe(end);
		expect(move(doc, end, end + 1)).toBe(end);
		expect(move(doc, doc.indexOf('a'), 0)).toBe(0); // but in front of one that begins it
	});

	test('a space typed at the end of a cell keeps the cursor behind it', () => {
		const doc = '| a  | b |\n|---|---|';
		const s = EditorState.create({
			doc,
			selection: { anchor: 4 },
			extensions: extensions({ onchange() {} })
		});
		const hidden: string[] = [];
		for (let i = decorate(s, true).iter(); i.value; i.next())
			if (!i.value.spec.class) hidden.push(doc.slice(i.from, i.to));
		expect(hidden.slice(0, 2)).toEqual(['| ', ' |']); // not the space in front of the cursor
	});

	test('a cursor at the start of a cell sticks to the text of that cell', () => {
		// (it is drawn next to what it sticks to; in front of it is the pipe of the cell before)
		const doc = '|a|bc|\n|-|-|';
		const b = doc.indexOf('b');
		const s = state(doc);
		const before = (pos: number) => EditorSelection.create([EditorSelection.cursor(pos, -1)]);
		const moved = s.update({ selection: before(b) }).state;
		expect(moved.selection.main.assoc).toBe(1);
		// Backspace leaves such a cursor behind
		const deleted = s.update({ selection: { anchor: b + 1 } }).state.update({
			changes: { from: b, to: b + 1 },
			selection: before(b),
			userEvent: 'delete.backward'
		}).state;
		expect(deleted.doc.toString()).toBe('|a|c|\n|-|-|');
		expect(deleted.selection.main.head).toBe(b);
		expect(deleted.selection.main.assoc).toBe(1);
		// elsewhere it is left alone (at the end of a wrapped line it matters)
		expect(s.update({ selection: before(b + 1) }).state.selection.main.assoc).toBe(-1);
	});

	test('typing a table: the cursor is free in its delimiter row', () => {
		const doc = '| a | b |\n|-|-';
		const s = EditorState.create({
			doc,
			selection: { anchor: doc.length },
			extensions: extensions({ onchange() {} })
		});
		expect(s.update({ selection: { anchor: doc.length - 2 } }).state.selection.main.head).toBe(
			doc.length - 2
		);
	});

	test('deleting leaves pipes and rows in place', () => {
		const doc = 'x\n\n| ab | c |\n|----|---|\n| 1  | 2 |\n| 3  | 4 |\n\ny';
		const del = (from: string, to: string, userEvent = 'delete.selection') =>
			state(doc)
				.update({ changes: { from: doc.indexOf(from), to: doc.indexOf(to) }, userEvent })
				.state.doc.toString();
		expect(del(' | c', 'c |')).toBe(doc); // Backspace at the start of a cell
		expect(del('b | c', ' |\n|--')).toBe(doc.replace('ab | c', 'a | ')); // over two cells
		expect(del('2 |', '  | 4')).toBe(doc.replace('2', '').replace('3', '')); // over two rows
		expect(del('1 ', '4 |')).toBe(doc.replace('| 1  | 2 |\n| 3  | 4 |', '|   |  |\n|   | 4 |'));
		// whole lines go
		expect(del('| 1', '| 3')).toBe(doc.replace('| 1  | 2 |\n', ''));
		expect(del('x', 'y')).toBe('y');
		// what the editor itself does to a table is not held back
		expect(del(' | c', 'c |', 'undo')).toBe(doc.replace('ab | c', 'abc'));
	});
});

describe('formatting shortcuts', () => {
	const bold = toggle('**');
	const italic = toggle('*');

	test.each([
		['wraps the selection', bold, 'a ‹word› b', 'a **‹word›** b'],
		['keeps spaces outside the marks', bold, 'a‹ word ›b', 'a **‹word›** b'],
		['unwraps a selected bold', bold, 'a **‹word›** b', 'a ‹word› b'],
		['unwraps around the cursor', bold, 'a **wo|rd** b', 'a wo|rd b'],
		['unwraps when the marks are selected too', bold, 'a ‹**word**› b', 'a ‹word› b'],
		['empty pair at the cursor', bold, 'a | b', 'a **|** b'],
		['and back', bold, 'a **|** b', 'a | b'],
		['italic inside bold', italic, '**a ‹b› c**', '**a *‹b›* c**'],
		['italic does not take bold apart', italic, '**‹word›**', '***‹word›***'],
		['removes italic from bold italic', italic, '***‹word›***', '**‹word›**'],
		['underscore marks count', bold, '__wo|rd__', 'wo|rd'],
		['code', toggle('`'), 'a ‹x› b', 'a `‹x›` b'],
		['code off', toggle('`'), 'a `x|` b', 'a x| b']
	])('%s', (_, cmd, src, want) => expect(run(cmd, src)).toBe(want));
});

describe('pictures', () => {
	test('options are the parts at the end of the alt text', () => {
		expect(imageOptions('a cat')).toEqual({ alt: 'a cat' });
		expect(imageOptions('a cat|300')).toEqual({ alt: 'a cat', width: 300, height: undefined });
		expect(imageOptions('a|b|center|300x200')).toEqual({
			alt: 'a|b',
			align: 'center',
			width: 300,
			height: 200
		});
		expect(imageOptions('|right')).toEqual({ alt: '', align: 'right' });
		expect(imageOptions('cat|left')).toEqual({ alt: 'cat' });
		expect(imageOptions('300')).toEqual({ alt: '300' }); // an alt text, not a size
	});

	test('options are set in the markdown of the picture', () => {
		const set = (doc: string, change: Parameters<typeof setImage>[1]) => {
			let s = state(doc);
			setImage(doc.indexOf('!') + 3, change)({ state: s, dispatch: (tr) => (s = tr.state) });
			return s.doc.toString();
		};
		expect(set('x ![cat](/files/a) y', { align: 'center' })).toBe('x ![cat|center](/files/a) y');
		expect(set('![cat|center](a.png)', { width: 300 })).toBe('![cat|center|300](a.png)');
		expect(set('![cat|center|300x200](a.png)', { align: undefined })).toBe('![cat|300x200](a.png)');
		expect(set('![cat|right|300](a.png)', { width: undefined, height: undefined })).toBe(
			'![cat|right](a.png)'
		);
		expect(set('![](a.png)', { align: 'right' })).toBe('![|right](a.png)');
		expect(setImage(1, { align: 'right' })({ state: state('no picture'), dispatch() {} })).toBe(
			false
		);
	});
});

describe('folding', () => {
	const doc = `# One

text
more text

- item
  - nested
- single

| a | b |
|---|---|
| 1 | 2 |

\`\`\`js
code
\`\`\`

## Two
end`;
	const fold = (text: string) => {
		const s = state(doc);
		const line = s.doc.lineAt(doc.indexOf(text));
		const range = foldable(s, line.from, line.to);
		return range && doc.slice(range.from, range.to);
	};

	test('a heading folds its section, a list item what is below it', () => {
		expect(fold('# One')).toBe(doc.slice(doc.indexOf('\n\ntext'))); // with its subsection
		expect(fold('## Two')).toBe('\nend');
		expect(fold('- item')).toBe('\n  - nested');
	});

	test('nothing else folds', () => {
		for (const text of ['text', '- single', '| a', '```js']) expect(fold(text)).toBeNull();
	});
});

describe('formula popup', () => {
	const at = (src: string) => {
		const s = EditorState.create({
			doc: src.replace('‸', ''),
			selection: { anchor: src.indexOf('‸') },
			extensions: extensions({ onchange() {} })
		});
		return [inlineMath(s), s.field(mathPopup)?.pos] as const;
	};

	test('shows the formula the cursor is in', () => {
		expect(at('a $x^‸2$ b')).toEqual([{ pos: 2, src: 'x^2' }, 2]);
		expect(at('a $x^2$‸ b')).toEqual([{ pos: 2, src: 'x^2' }, 2]);
	});

	test('not outside of formulas, and not for one that is drawn below its markdown', () => {
		expect(at('a $x^2$ b‸')).toEqual([null, undefined]);
		expect(at('a $$x^‸2$$ b')).toEqual([null, undefined]);
	});
});
