import { syncAll, syncFeed } from '#modules/calendar/server/feeds.ts';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ url }) => {
	const id = url.searchParams.get('id');
	await (id ? syncFeed(id) : syncAll());
	return new Response(null, { status: 204 });
};
