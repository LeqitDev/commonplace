// The built modules (virtual:modules, see scripts/vite-modules.ts) and what they plug in. `slot()`
// only counts the modules that are on (Settings › General), so it is reactive.
import all from 'virtual:modules';
import { featureOn } from './data.svelte.ts';
import type { ClientModule, NoteType, Services } from './modules.ts';

/** Built and switched on. */
export const active = () => all.filter((m) => featureOn(m.id));

/** The extension points that are lists. */
type Lists = {
	[
		K in keyof ClientModule as NonNullable<ClientModule[K]> extends readonly unknown[] ? K : never
	]-?: NonNullable<ClientModule[K]>;
};

/** All entries of one extension point, over the modules that are on. */
export const slot = <K extends keyof Lists>(key: K): Lists[K] =>
	active().flatMap((m) => (m[key] ?? []) as unknown[]) as Lists[K];

/** One extension point that is a map (search labels, keys), merged. */
export const merged = <K extends 'search' | 'keys'>(key: K) =>
	Object.assign({}, ...active().map((m) => m[key] ?? {})) as NonNullable<ClientModule[K]>;

/** A function another module offers, or undefined while that module is off. */
export const service = <K extends keyof Services>(name: K): Services[K] | undefined =>
	active().find((m) => m.services?.[name])?.services?.[name] as Services[K] | undefined;

/** The note type, from every *built* module: an existing canvas still opens while Canvas is
 *  switched off (only "new" menus follow the switch). */
export const noteType = (type: string | undefined): NoteType | undefined =>
	all.flatMap((m) => m.noteTypes ?? []).find((t) => t.type === type);
