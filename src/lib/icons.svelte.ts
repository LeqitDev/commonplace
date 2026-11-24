// Full lucide icon set for project icons, loaded lazily as one chunk (vanilla `lucide` = plain
// icon-node data; rendered with @lucide/svelte's generic <Icon>). Names are PascalCase.
import type { LucideIconNode } from '@lucide/svelte';

type IconNode = LucideIconNode[];

let set = $state.raw<Record<string, IconNode> | null>(null);
let names: string[] = [];
let loading = false;

/** The icon map, or null while it loads (reactive: components re-render once it's there). */
export function icons() {
	if (!set && !loading) {
		loading = true;
		import('lucide').then(({ icons }) => {
			// aliases share the node object with their canonical icon: list each icon once
			const seen = new Set<IconNode>();
			names = Object.keys(icons).filter((n) => {
				const node = (icons as unknown as Record<string, IconNode>)[n];
				return !seen.has(node) && !!seen.add(node);
			});
			set = icons as unknown as Record<string, IconNode>;
		});
	}
	return set;
}

/** Icon names matching a search ("arrow up" matches ArrowUp, ArrowUpDown, …). */
export function searchIcons(q: string, limit = 160) {
	const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
	const out: string[] = [];
	for (const n of names) {
		const l = n.toLowerCase();
		if (terms.every((t) => l.includes(t)) && out.push(n) >= limit) break;
	}
	return out;
}
