// Look of the markdown editor: shadcn tokens (monochrome) and the metrics of the rest of the app;
// only code in code blocks has colours, muted ones.
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import { tags as t } from '@lezer/highlight';

const mono = 'ui-monospace, SFMono-Regular, Menlo, monospace';
// rem, not em: lines differ in font size (code, fences), their indentation must not
const indent = 'calc(var(--md-depth) * 1.6rem)';
/** A code colour by hue. Its lightness is set on code block lines (per light / dark mode), so
 *  outside of them the declaration is invalid and the text keeps its colour. */
const hue = (h: number) => ({ color: `oklch(var(--md-code-l) 0.11 ${h})` });
/** Background of a code block line inside a list: the box starts at the text of the item, so its
 *  left corners can't come from `border-radius` and are painted (a strip with quarter circles). */
const fill = 'linear-gradient(var(--muted), var(--muted))';
const radius = '6px';
const corner = (y: 0 | 100) =>
	`radial-gradient(circle at 100% ${100 - y}%, var(--muted) calc(${radius} - 0.5px), transparent ${radius}) ${indent} ${y}% / ${radius} ${radius} no-repeat`;
const indented = (top: boolean, bottom: boolean) =>
	[
		`${fill} calc(${indent} + ${radius}) 0 / 100% 100% no-repeat`,
		`${fill} ${indent} ${top ? radius : '0'} / ${radius} calc(100% - ${+top + +bottom} * ${radius}) no-repeat`,
		...(top ? [corner(0)] : []),
		...(bottom ? [corner(100)] : [])
	].join(', ');
/** Font sizes of the headings of level 1, 2, 3 (em); further levels are as large as the text. */
export const headingSizes = [1.6, 1.35, 1.15];
const heading = (level: number) => ({
	fontSize: `${headingSizes[level - 1] ?? 1}em`,
	fontWeight: '600',
	lineHeight: '1.3'
});

const highlight = HighlightStyle.define([
	{ tag: t.heading1, ...heading(1) },
	{ tag: t.heading2, ...heading(2) },
	{ tag: t.heading3, ...heading(3) },
	{ tag: [t.heading4, t.heading5, t.heading6], ...heading(4) },
	{ tag: t.strong, fontWeight: '600' },
	{ tag: t.emphasis, fontStyle: 'italic' },
	{ tag: t.strikethrough, textDecoration: 'line-through' },
	{ tag: t.monospace, fontFamily: mono },
	{ tag: t.link, textDecoration: 'underline', textUnderlineOffset: '3px' },
	{ tag: t.quote, color: 'var(--muted-foreground)' },
	// syntax characters (#, **, `, [ ] ( ), >, list markers), URLs, code-fence info
	{
		tag: [t.processingInstruction, t.url, t.labelName, t.contentSeparator],
		color: 'var(--muted-foreground)',
		fontWeight: '400',
		textDecoration: 'none'
	},
	// code in code blocks
	{ tag: [t.keyword, t.tagName], ...hue(300) },
	{ tag: [t.string, t.regexp], ...hue(150) },
	{ tag: [t.number, t.bool, t.null, t.atom, t.escape], ...hue(55) },
	{ tag: [t.function(t.variableName), t.function(t.propertyName), t.macroName], ...hue(250) },
	{ tag: [t.typeName, t.className, t.namespace, t.attributeName], ...hue(200) },
	{ tag: [t.comment, t.meta], color: 'var(--muted-foreground)', fontStyle: 'italic' }
]);

export const theme = (compact = false) => [
	EditorView.theme({
		'&': { height: '100%', fontSize: '14px', color: 'var(--foreground)' },
		'&.cm-focused': { outline: 'none' },
		// the space beside the text belongs to the scroller: a selection is as wide as the content
		'.cm-scroller': {
			fontFamily: 'inherit',
			lineHeight: '1.6',
			overflow: 'auto',
			// the left one is 1rem smaller: the fold gutter stands there
			padding: compact ? '0 1.75rem 0 0.75rem' : '0 2.5rem 0 1.5rem'
		},
		// folding: a chevron in front of headings and list items with something below them
		'.cm-gutters': {
			background: 'transparent',
			border: 'none',
			color: 'var(--muted-foreground)'
		},
		'.cm-foldGutter .cm-gutterElement': {
			display: 'flex',
			alignItems: 'center',
			justifyContent: 'center',
			width: '1rem',
			padding: '0',
			cursor: 'pointer'
		},
		// always there, faintly (a touch screen has no hover)
		'.md-fold': { opacity: '0.3', lineHeight: '1', transform: 'rotate(90deg)' },
		'.md-folded': { transform: 'none' },
		'.md-fold:hover, .md-folded': { opacity: '1' },
		'.cm-foldPlaceholder': {
			background: 'transparent',
			border: 'none',
			color: 'var(--muted-foreground)',
			margin: '0 0.25rem',
			padding: '0'
		},
		'.cm-content': {
			padding: compact ? '0.25rem 0 2rem' : '1rem 0 30vh',
			caretColor: 'var(--foreground)'
		},
		'.cm-line': { padding: '2px 0' },
		'.cm-cursor': { borderLeftColor: 'var(--foreground)' },
		'.md-code': {
			background: 'var(--muted)',
			borderRadius: '4px',
			padding: '1px 4px',
			fontSize: '0.92em'
		},
		'.md-link, .md-link span': {
			color: 'var(--foreground)',
			textDecoration: 'underline',
			textUnderlineOffset: '3px'
		},
		'.md-quote': { borderLeft: '2px solid var(--border)', paddingLeft: '0.9rem' },
		// list lines: indented by depth; what precedes the text hangs back into that indentation
		'.md-li': { paddingLeft: indent },
		'.md-quote.md-li': { paddingLeft: `calc(0.9rem + ${indent})` },
		'.md-lead': {
			display: 'inline-block',
			minWidth: indent,
			marginLeft: `calc(-1 * ${indent})`,
			textAlign: 'right',
			whiteSpace: 'pre'
		},
		// a marker that has no space behind it yet stands where it will with it
		'.md-lead-bare::after': { content: '" "' },
		// code blocks: one box made of lines; inside a list it starts at the text of the item
		'.md-pre': {
			'--md-code-l': '0.5',
			background: 'var(--muted)',
			fontFamily: mono,
			fontSize: '0.92em',
			paddingLeft: '0.9rem',
			paddingRight: '0.9rem'
		},
		'.dark & .md-pre': { '--md-code-l': '0.8' },
		'.md-li.md-pre': {
			background: indented(false, false),
			paddingLeft: `calc(${indent} + 0.9rem)`
		},
		'.md-li.md-pre-first': { background: indented(true, false) },
		'.md-li.md-pre-last': { background: indented(false, true) },
		'.md-li.md-pre-first.md-pre-last': { background: indented(true, true) },
		'.md-pre .md-lead': { marginLeft: `calc(-1 * ${indent} - 0.9rem)`, marginRight: '0.9rem' },
		'.md-pre-first': { borderTopLeftRadius: radius, borderTopRightRadius: radius },
		'.md-pre-last': { borderBottomLeftRadius: radius, borderBottomRightRadius: radius },
		'.md-fence': { fontSize: '0.75em', lineHeight: '1.3' }, // a fence that is hidden
		// tables: the lines of the rows and the cells in them are laid out as a table by the browser
		'.md-tr': { display: 'table-row' },
		'.md-tsep': { display: 'none' },
		'.md-td': {
			display: 'table-cell',
			height: '1.6em', // of an empty cell: a line of text
			padding: '0.3rem 0.75rem',
			borderBottom: '1px solid var(--border)',
			verticalAlign: 'top',
			// columns are as wide as their longest word (the editor breaks lines anywhere if it has to)
			wordBreak: 'normal',
			overflowWrap: 'break-word'
		},
		'.md-th .md-td': { fontWeight: '600', borderBottomColor: 'var(--muted-foreground)' },
		'.md-td-center': { textAlign: 'center' },
		'.md-td-right': { textAlign: 'right' },
		// formulas: Typst draws them black, and lets tall ones reach out of their line
		'.md-math svg': {
			display: 'inline-block',
			overflow: 'visible',
			pointerEvents: 'none',
			userSelect: 'none'
		},
		'.dark & .md-math svg': { filter: 'invert(1)' },
		'.md-math-row': {
			display: 'inline-block',
			width: '100%',
			padding: '0.25em 0',
			textAlign: 'center'
		},
		'.md-math-error': {
			fontFamily: mono,
			fontSize: '0.92em',
			color: 'var(--muted-foreground)',
			textDecoration: 'underline wavy'
		},
		// the popup that shows the formula being typed
		'.cm-tooltip.md-math-tip': {
			background: 'var(--popover)',
			border: '1px solid var(--border)',
			borderRadius: '6px',
			padding: '0.4rem 0.6rem',
			marginTop: '2px'
		},
		'&:not(.cm-focused) .md-math-tip': { display: 'none' },
		'.md-math-tip.md-math-error': { textDecoration: 'none' },
		'.md-math-src': { fontFamily: mono, fontSize: '0.92em' },
		'.md-pre .md-math-src': { fontSize: 'inherit' },
		'.md-gone': { display: 'none' },
		'.md-img img': {
			display: 'inline-block', // Tailwind makes images blocks
			maxWidth: '100%',
			maxHeight: '32rem',
			borderRadius: '6px',
			verticalAlign: 'bottom',
			cursor: 'zoom-in'
		},
		'.md-img-row': { display: 'inline-block', width: '100%' },
		'.md-check': {
			display: 'inline-block',
			boxSizing: 'border-box',
			width: '1.05em',
			height: '1.05em',
			verticalAlign: '-0.16em',
			border: '1px solid var(--muted-foreground)',
			borderRadius: '4px',
			cursor: 'pointer',
			position: 'relative'
		},
		'.md-check[aria-checked=true]': {
			background: 'var(--foreground)',
			borderColor: 'var(--foreground)'
		},
		// the tick: two borders of a rotated box
		'.md-check[aria-checked=true]::after': {
			content: '""',
			position: 'absolute',
			left: '32%',
			top: '10%',
			width: '30%',
			height: '60%',
			border: 'solid var(--background)',
			borderWidth: '0 1.5px 1.5px 0',
			transform: 'rotate(45deg)'
		},
		'.md-done': { textDecoration: 'line-through' },
		'.md-done, .md-done span': { color: 'var(--muted-foreground)' },
		'.md-hr': {
			display: 'inline-block',
			width: '100%',
			borderTop: '1px solid var(--border)',
			verticalAlign: 'middle'
		},
		'.cm-selectionBackground, &.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground':
			{ background: 'color-mix(in oklab, var(--foreground) 14%, transparent)' }
	}),
	syntaxHighlighting(highlight)
];
