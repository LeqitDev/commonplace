import { clear, ofThread, pending, save, status } from '#modules/mail/server/triage.ts';
import type { RequestHandler } from './$types';

// Mail triage: the browser that has the model (on its own PC) takes mail from here and sends the
// answers back.
// GET ?limit=10 → { items (states to ask about), waiting, done, labels }; GET ?thread=<id> → the
// conversation's triage with its labels (the reader). POST { msgid, model, version, answers }.
// DELETE: "run again" on the window.
export const GET: RequestHandler = async ({ url }) => {
	const thread = url.searchParams.get('thread');
	if (thread) return Response.json(ofThread(thread));
	const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 0, 0), 50);
	const items = await pending(limit);
	return Response.json({ items, ...status() });
};

export const POST: RequestHandler = async ({ request }) =>
	Response.json(await save(await request.json()));

export const DELETE: RequestHandler = () => {
	clear();
	return Response.json(status());
};
