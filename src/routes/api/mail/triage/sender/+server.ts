import { setRule } from '#modules/mail/server/triage.ts';
import type { RequestHandler } from './$types';

// POST { address, tab }: mail of this sender goes to this inbox tab ("Move sender to …"); tab null
// lets the model decide again. → { moved, tab }
export const POST: RequestHandler = async ({ request }) =>
	Response.json(setRule(await request.json()));
