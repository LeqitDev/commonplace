import { enabledAccounts, laterState, mailCtx } from '#modules/mail/server/mail.ts';
import { unreadInbox } from '#modules/mail/server/mailstore.ts';
import { mailVisible } from '#modules/mail/mail.ts';
import type { RequestHandler } from './$types';

// Unread conversations in the inbox per account (sidebar, "N to triage"), without the ones put
// off until later and, with ?project=, only those that show with that project.
export const GET: RequestHandler = ({ url }) => {
	const project = url.searchParams.get('project');
	const ctx = mailCtx();
	const counts: Record<string, number> = {};
	for (const t of unreadInbox(enabledAccounts(), laterState().off))
		if (mailVisible(t, ctx, project)) counts[t.account] = (counts[t.account] ?? 0) + 1;
	return Response.json(counts);
};
