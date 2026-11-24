import { act, readThread } from '#modules/mail/server/mail.ts';
import type { RequestHandler } from './$types';

// The messages of a conversation with parsed bodies (uncached ones are fetched from IMAP first).
export const GET: RequestHandler = async ({ params }) =>
	Response.json(await readThread(params.thread));

// { seen?, flagged?, archived? }: changes the cache now and the server right after.
export const PATCH: RequestHandler = async ({ params, request }) => {
	const p = (await request.json()) as { seen?: boolean; flagged?: boolean; archived?: boolean };
	return Response.json({ changed: act(params.thread, p) });
};
