// What a module plugs into on the server: src/modules/<id>/module.server.ts does
// `export default defineServerModule({ … })`. The built ones come from `virtual:modules/server`.
// Everything here runs for every *built* module, also while it is switched off in Settings, so a
// hook checks `featureOn()` itself where that matters (mail stops IDLE when it is switched off).
import type { ModuleId } from '#modules/registry.ts';
import type { SearchHit } from '../types.ts';
import type { Coll, Doc } from './db.ts';

export interface ServerModule {
	id: ModuleId;
	/** Once at server start (sync timers, IDLE connections). */
	init?: () => void;
	/** After a PATCH of a doc through the generic API. */
	onPatch?: (coll: Coll, id: string, patch: Record<string, unknown>, doc: Doc) => void;
	/** After a DELETE through the generic API. */
	onDelete?: (coll: Coll, id: string) => void;
	/** Extra hits for /api/search (only asked while the module is on). */
	search?: (q: string) => SearchHit[];
}

export const defineServerModule = (m: ServerModule) => m;
