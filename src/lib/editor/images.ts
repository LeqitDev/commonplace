// Pictures in notes. Their options live in the alt text, the way Obsidian writes them:
// `![alt|center|300](src)`, `![alt|300x200](src)`.
import { syntaxTree } from '@codemirror/language';
import type { EditorState, StateCommand } from '@codemirror/state';

export interface ImageOptions {
	alt: string;
	/** Where it stands in a row of its own; without it the picture is part of the text. */
	align?: 'center' | 'right';
	/** Pixels. A width alone keeps the proportions. */
	width?: number;
	height?: number;
}

/** Splits what is between `![` and `]`: options are the `|` parts at its end. */
export function imageOptions(text: string): ImageOptions {
	const parts = text.split('|');
	const o: ImageOptions = { alt: '' };
	for (; parts.length > 1; parts.pop()) {
		const part = parts.at(-1)!.trim();
		const size = /^(\d+)(?:x(\d+))?$/.exec(part);
		if (size) {
			o.width = +size[1];
			o.height = size[2] ? +size[2] : undefined;
		} else if (part === 'center' || part === 'right') o.align = part;
		else if (part !== 'left') break; // part of the alt text
	}
	o.alt = parts.join('|');
	return o;
}

const altText = ({ alt, align, width, height }: ImageOptions) =>
	[alt, align, width && (height ? `${width}x${height}` : `${width}`)]
		.filter((part, i) => !i || part)
		.join('|');

/** The picture (`![alt](src)`) at `pos`: where it is, and where its alt text is. */
export function imageAt(state: EditorState, pos: number) {
	for (const side of [-1, 1] as const)
		for (let n = syntaxTree(state).resolveInner(pos, side); n.parent; n = n.parent) {
			if (n.name !== 'Image') continue;
			const [open, close] = n.getChildren('LinkMark');
			if (close) return { from: n.from, to: n.to, alt: { from: open.to, to: close.from } };
		}
	return null;
}

/** Changes options of the picture at `pos` (`undefined` takes one away). */
export const setImage =
	(pos: number, change: Partial<Omit<ImageOptions, 'alt'>>): StateCommand =>
	({ state, dispatch }) => {
		const img = imageAt(state, pos);
		if (!img) return false;
		const options = { ...imageOptions(state.sliceDoc(img.alt.from, img.alt.to)), ...change };
		dispatch(
			state.update({ changes: { ...img.alt, insert: altText(options) }, userEvent: 'input' })
		);
		return true;
	};

/** Shows a picture as large as the window allows; a click or Escape closes it. */
export function zoom(src: string) {
	const box = document.createElement('div');
	box.className = 'md-zoom';
	box.appendChild(document.createElement('img')).src = src;
	const close = (e: Event) => {
		if (e instanceof KeyboardEvent && e.key !== 'Escape') return;
		e.stopPropagation(); // Escape is not for what lies below (a sheet, the editor)
		box.remove();
		removeEventListener('keydown', close, true);
	};
	box.addEventListener('click', close);
	addEventListener('keydown', close, true);
	document.body.append(box);
}
