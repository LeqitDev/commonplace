// Markdown note editor on CodeMirror 6. The document is the markdown text itself: nothing is
// parsed-and-reserialised, so the stored note is exactly what was typed.
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { commonmarkLanguage, deleteMarkupBackward, markdown } from '@codemirror/lang-markdown';
import { foldGutter, foldKeymap, foldNodeProp, indentUnit, syntaxTree } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import type { EditorState, Extension } from '@codemirror/state';
import { drawSelection, dropCursor, EditorView, keymap, ViewPlugin } from '@codemirror/view';
import { GFM, type MarkdownConfig } from '@lezer/markdown';
import { enter, toggle, typing } from './commands.ts';
import { moveItem, nest } from './lists.ts';
import { mathSyntax } from './math.ts';
import { backspaceRow, insertColumn, keepPipes, nextCell, stayInCells } from './tables.ts';
import { mathPopup, preview } from './preview.ts';
import { theme } from './theme.ts';

export interface EditorOptions {
	value: string;
	onchange: (md: string) => void;
	/** Ctrl/Cmd+click on a link. */
	onlink?: (href: string) => void;
	/** Store a pasted or dropped file; resolves to its URL. */
	onupload?: (file: File) => Promise<string>;
	/** Smaller padding (canvas embeds). */
	compact?: boolean;
}

/** Target of the link, image or bare URL at `pos`, if there is one. */
export function linkAt(state: EditorState, pos: number): string | null {
	for (const side of [-1, 1] as const) {
		for (let n = syntaxTree(state).resolveInner(pos, side); n.parent; n = n.parent) {
			const url =
				n.name === 'URL' ? n : /^(Link|Image|Autolink)$/.test(n.name) && n.getChild('URL');
			if (url) return state.sliceDoc(url.from, url.to);
		}
	}
	return null;
}

/** The uploaded file (`/files/<id>`) that the link or image at `pos` shows: where the whole
 *  `[name](url)` is, and the name in it. */
export function fileAt(state: EditorState, pos: number) {
	for (const side of [-1, 1] as const)
		for (let n = syntaxTree(state).resolveInner(pos, side); n.parent; n = n.parent) {
			if (!/^(Link|Image)$/.test(n.name)) continue;
			const url = n.getChild('URL');
			const [open, close] = n.getChildren('LinkMark');
			const id = url && /\/files\/([\w-]+)>?$/.exec(state.sliceDoc(url.from, url.to))?.[1];
			if (id && close)
				return { id, from: n.from, to: n.to, name: { from: open.to, to: close.from } };
		}
	return null;
}

/** A click in the margin beside the text (the padding of the scroller) goes to that line. */
const margin = ViewPlugin.define((view) => {
	const dom = view.scrollDOM;
	const down = (e: MouseEvent) => {
		if (e.target !== dom || e.button || e.offsetX >= dom.clientWidth) return; // not its scrollbar
		const box = view.contentDOM.getBoundingClientRect();
		const x = Math.min(Math.max(e.clientX, box.left + 1), box.right - 1);
		e.preventDefault();
		view.dispatch({ selection: { anchor: view.posAtCoords({ x, y: e.clientY }, false) } });
		view.focus();
	};
	dom.addEventListener('mousedown', down);
	return { destroy: () => dom.removeEventListener('mousedown', down) };
});

/** What can be folded: sections (lang-markdown folds them below their heading) and list items
 *  with further lines. Other blocks can't: the editor draws them itself (tables, formulas, code). */
const folding: MarkdownConfig = {
	props: [
		foldNodeProp.add((type) =>
			type.is('Block') && type.name !== 'ListItem' ? () => null : undefined
		)
	]
};

function foldMarker(open: boolean) {
	const el = document.createElement('span');
	el.className = open ? 'md-fold' : 'md-fold md-folded';
	el.textContent = '›';
	return el;
}

/** Upload files and put them at the cursor: images as images, anything else as a link. */
async function attach(view: EditorView, files: File[], upload: (file: File) => Promise<string>) {
	for (const [i, file] of files.entries()) {
		const url = await upload(file);
		const md = `${file.type.startsWith('image/') ? '!' : ''}[${file.name.replace(/[[\]]/g, '')}](${url})`;
		view.dispatch(view.state.replaceSelection(md + (i < files.length - 1 ? '\n' : '')), {
			scrollIntoView: true,
			userEvent: 'input.paste'
		});
	}
}

export const extensions = (o: Omit<EditorOptions, 'value'>): Extension => [
	history(),
	drawSelection(),
	EditorView.lineWrapping,
	EditorView.contentAttributes.of({ spellcheck: 'true' }),
	dropCursor(),
	// languages of code blocks are loaded when a block names them
	markdown({ extensions: [GFM, mathSyntax, folding], addKeymap: false, codeLanguages: languages }),
	indentUnit.of('    '), // Tab outside of lists (inside: `nest`)
	commonmarkLanguage.data.of({ closeBrackets: { brackets: ['(', '[', '{', '`'] } }),
	typing,
	closeBrackets(),
	preview,
	mathPopup,
	foldGutter({ markerDOM: foldMarker }),
	stayInCells,
	keepPipes,
	keymap.of([
		{ key: 'Mod-b', run: toggle('**'), stopPropagation: true }, // else the sidebar toggles too
		{ key: 'Mod-i', run: toggle('*') },
		{ key: 'Mod-e', run: toggle('`') },
		{ key: 'Mod-Shift-x', run: toggle('~~') },
		{ key: 'Enter', run: enter },
		{ key: 'Tab', run: nextCell(1), shift: nextCell(-1) },
		{ key: 'Tab', run: nest(1), shift: nest(-1) },
		{ key: 'Mod-Shift-ArrowUp', run: moveItem(-1) },
		{ key: 'Mod-Shift-ArrowDown', run: moveItem(1) },
		{ key: 'Shift-Alt-ArrowLeft', run: insertColumn(-1) },
		{ key: 'Shift-Alt-ArrowRight', run: insertColumn(1) },
		...closeBracketsKeymap,
		{ key: 'Backspace', run: backspaceRow },
		{ key: 'Backspace', run: deleteMarkupBackward },
		...defaultKeymap,
		...historyKeymap,
		...foldKeymap,
		indentWithTab
	]),
	theme(o.compact),
	margin,
	EditorView.updateListener.of((u) => {
		if (u.docChanged) o.onchange(u.state.doc.toString());
	}),
	EditorView.domEventHandlers({
		click(e, view) {
			if (!(e.ctrlKey || e.metaKey) || !o.onlink) return false;
			const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
			const href = pos === null ? null : linkAt(view.state, pos);
			if (!href) return false;
			e.preventDefault();
			o.onlink(href);
			return true;
		},
		// files only: a copied table or web page comes with a picture of itself next to its text
		paste(e, view) {
			const files = [...(e.clipboardData?.files ?? [])];
			if (!o.onupload || !files.length || e.clipboardData!.getData('text/plain')) return false;
			e.preventDefault();
			attach(view, files, o.onupload);
			return true;
		},
		drop(e, view) {
			const files = [...(e.dataTransfer?.files ?? [])];
			if (!o.onupload || !files.length) return false;
			e.preventDefault();
			const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
			if (pos !== null) view.dispatch({ selection: { anchor: pos } });
			view.focus();
			attach(view, files, o.onupload);
			return true;
		}
	})
];

export const createEditor = (parent: HTMLElement, { value, ...o }: EditorOptions) =>
	new EditorView({ parent, doc: value, extensions: extensions(o) });
