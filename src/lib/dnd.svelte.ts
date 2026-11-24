// Pointer-based drag & drop (used by the notes tree). Native HTML5 drag images are browser
// snapshots that can't be styled and render huge on some Linux/Wayland setups; here the ghost is
// our own element (DragGhost.svelte) and targets are found with elementFromPoint.
import type { Attachment } from 'svelte/attachments';

export type DragItem = { kind: 'note' | 'folder' | 'file'; id: string; label: string };
type Target = { accept: (i: DragItem) => boolean; drop: (i: DragItem) => void };

export const dnd = $state({
	item: null as DragItem | null,
	x: 0,
	y: 0,
	/** Key of the accepting drop target under the pointer. */
	over: null as string | null
});
const targets = new Map<string, Target>();

export function draggable(item: () => DragItem): Attachment<HTMLElement> {
	return (node) => {
		function down(e: PointerEvent) {
			if (e.button !== 0 || (e.target as HTMLElement).closest('input')) return;
			const [sx, sy] = [e.clientX, e.clientY];
			let dragging = false;
			const move = (m: PointerEvent) => {
				if (!dragging && Math.hypot(m.clientX - sx, m.clientY - sy) < 5) return;
				if (!dragging) {
					dragging = true;
					dnd.item = item();
					document.body.style.userSelect = 'none';
				}
				Object.assign(dnd, { x: m.clientX, y: m.clientY });
				const el = document.elementFromPoint(m.clientX, m.clientY);
				const key = el?.closest<HTMLElement>('[data-drop]')?.dataset.drop ?? null;
				dnd.over = key && targets.get(key)?.accept(dnd.item!) ? key : null;
			};
			const end = (drop: boolean) => {
				removeEventListener('pointermove', move);
				removeEventListener('pointerup', up);
				removeEventListener('keydown', key);
				document.body.style.userSelect = '';
				if (dragging) {
					// swallow the click that follows the drag (e.g. on a note link)
					const swallow = (c: MouseEvent) => (c.preventDefault(), c.stopPropagation());
					addEventListener('click', swallow, { capture: true, once: true });
					setTimeout(() => removeEventListener('click', swallow, { capture: true }));
					if (drop && dnd.over) targets.get(dnd.over)?.drop(dnd.item!);
				}
				Object.assign(dnd, { item: null, over: null });
			};
			const up = () => end(true);
			const key = (k: KeyboardEvent) => k.key === 'Escape' && end(false);
			addEventListener('pointermove', move);
			addEventListener('pointerup', up);
			addEventListener('keydown', key);
		}
		node.addEventListener('pointerdown', down);
		return () => node.removeEventListener('pointerdown', down);
	};
}

export function droppable(
	key: string,
	accept: (i: DragItem) => boolean,
	drop: (i: DragItem) => void
): Attachment<HTMLElement> {
	return (node) => {
		const t = { accept, drop };
		node.dataset.drop = key;
		targets.set(key, t);
		return () => {
			if (targets.get(key) === t) targets.delete(key);
		};
	};
}
