import { changed } from '#lib/server/dav.ts';
import { coll, list, pub, put } from '#lib/server/db.ts';
import type { RequestHandler } from './$types';

// GET /api/tasks?omit=content&start=…&end=…&projectId=…
export const GET: RequestHandler = ({ params, url }) => {
	const { omit, start, end, ...where } = Object.fromEntries(url.searchParams);
	return Response.json(list(coll(params.coll), { omit: omit?.split(','), start, end, where }));
};

export const POST: RequestHandler = async ({ params, request }) => {
	const c = coll(params.coll, true);
	const doc = put(c, await request.json());
	changed(c, doc.id);
	return Response.json(pub(c, doc));
};
