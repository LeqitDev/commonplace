import { syncAccount, syncAll } from '#modules/mail/server/mail.ts';
import type { RequestHandler } from './$types';

// Starts a sync and returns at once: a first sync can take minutes. Progress and the result
// arrive as server-sent events (/api/mail/events).
export const POST: RequestHandler = ({ url }) => {
	const id = url.searchParams.get('id');
	void (id ? syncAccount(id) : syncAll()).catch(() => {});
	return new Response(null, { status: 202 });
};
