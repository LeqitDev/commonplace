import type { ClientModule } from '#lib/modules.ts';
import type { Note } from '#lib/types.ts';
import PenTool from '@lucide/svelte/icons/pen-tool';
import CanvasNote from './CanvasNote.svelte';

/** A markdown note as a canvas: its text in one box. */
async function fromMarkdown(note: Note): Promise<Partial<Note>> {
	const x = await import('@excalidraw/excalidraw');
	const elements = x.convertToExcalidrawElements([
		{
			type: 'rectangle',
			x: 0,
			y: 0,
			width: 640,
			height: 120,
			backgroundColor: '#f1f3f5',
			fillStyle: 'solid',
			// system sans (fontFamily 2) measures correctly before Excalidraw's own fonts load
			label: {
				text: note.content || ' ',
				textAlign: 'left',
				verticalAlign: 'top',
				fontFamily: 2,
				fontSize: 16
			}
		}
	]);
	return {
		type: 'canvas',
		scene: { elements: elements as unknown as NonNullable<Note['scene']>['elements'] },
		content: undefined
	};
}

export default {
	id: 'canvas',
	noteTypes: [{ type: 'canvas', label: 'Canvas', icon: PenTool, editor: CanvasNote, fromMarkdown }]
} satisfies ClientModule;
