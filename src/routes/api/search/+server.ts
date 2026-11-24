import modules from 'virtual:modules/server';
import { featureOn, search } from '#lib/server/db.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ url }) => {
	const q = url.searchParams.get('q') ?? '';
	const more = modules.flatMap((m) => (m.search && featureOn(m.id) ? m.search(q) : []));
	return Response.json([...search(q), ...more]);
};
