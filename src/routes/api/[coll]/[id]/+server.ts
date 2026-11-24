import { error } from '@sveltejs/kit';
import modules from 'virtual:modules/server';
import { changed } from '#lib/server/dav.ts';
import { coll, get, patch, pub, remove } from '#lib/server/db.ts';
import type { RequestHandler } from './$types';

const found = <T>(d: T | null) => d ?? error(404, 'Not found');

export const GET: RequestHandler = ({ params }) => {
	const c = coll(params.coll);
	return Response.json(pub(c, found(get(c, params.id))));
};

// The modules hear of every write, also while switched off (mail stops its IDLE when it goes off).
export const PATCH: RequestHandler = async ({ params, request }) => {
	const c = coll(params.coll, true);
	const p = await request.json();
	const doc = found(patch(c, params.id, p));
	changed(c, params.id);
	for (const m of modules) m.onPatch?.(c, params.id, p, doc);
	return Response.json(pub(c, doc));
};

// Returns the deleted doc so the client can undo (without secrets: a restored feed or mail
// account needs its password again).
export const DELETE: RequestHandler = ({ params }) => {
	const c = coll(params.coll, true);
	const doc = remove(c, params.id);
	changed(c, params.id);
	for (const m of modules) m.onDelete?.(c, params.id);
	return Response.json(pub(c, doc));
};
