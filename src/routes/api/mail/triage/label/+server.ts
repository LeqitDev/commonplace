import { label } from '#modules/mail/server/triage.ts';
import type { RequestHandler } from './$types';

// POST { msgid, name, value }: the right answer to one question (value null takes it back).
export const POST: RequestHandler = async ({ request }) =>
	Response.json(label(await request.json()));
