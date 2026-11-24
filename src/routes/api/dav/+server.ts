import { status, sync } from '#lib/server/dav.ts';
import type { RequestHandler } from './$types';

// State of the CalDAV sync of events and tasks.
export const GET: RequestHandler = () => Response.json(status());

// Sync now; `changed` = events or tasks were changed by it, so the client reloads them.
export const POST: RequestHandler = async () => {
	const changed = await sync();
	return Response.json({ ...status(), changed });
};
