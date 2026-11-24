import { error } from '@sveltejs/kit';
import { answerInvite } from '#modules/mail/server/mail.ts';
import type { RequestHandler } from './$types';

// POST { answer: 'accept' | 'maybe' | 'decline' } for the invitation in message <msg>.
export const POST: RequestHandler = async ({ params, request }) => {
	const { answer } = (await request.json()) as { answer?: string };
	if (answer !== 'accept' && answer !== 'maybe' && answer !== 'decline')
		error(400, 'Unknown answer');
	return Response.json(await answerInvite(Number(params.msg), answer));
};
