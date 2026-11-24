import { error } from '@sveltejs/kit';
import { send } from '#modules/mail/server/mail.ts';
import type { RequestHandler } from './$types';

// POST { id }: send that draft. { ok } — or { ok: false, error }: the draft stays, queued, and is
// tried again with every sync ("waiting to be sent").
export const POST: RequestHandler = async ({ request }) => {
	const { id } = (await request.json()) as { id?: string };
	if (!id) error(400, 'id missing');
	return Response.json(await send(id));
};
