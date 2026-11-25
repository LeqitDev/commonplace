import { error } from '@sveltejs/kit';
import { enabledAccounts, laterState, mailCtx } from '#modules/mail/server/mail.ts';
import { threads } from '#modules/mail/server/mailstore.ts';
import { mailVisible, VIEWS, type MailView } from '#modules/mail/mail.ts';
import type { MailThreadRow } from '#lib/types.ts';
import type { RequestHandler } from './$types';

// GET /api/mail?view=inbox&account=<id>&project=<focused>&before=<sort>&limit=50: conversations,
// newest first. With a focused project only the ones that show with it (pages are filled up).
// `tab=personal|orders|news|ads` (inbox): one tab of the triage.
export const GET: RequestHandler = ({ url }) => {
	const p = url.searchParams;
	const view = (p.get('view') ?? 'inbox') as MailView;
	if (!VIEWS.some((v) => v.id === view)) error(400, 'Unknown view');
	const accounts = enabledAccounts();
	const account = p.get('account');
	if (account && !accounts.includes(account)) return Response.json([]);
	const limit = Math.min(Number(p.get('limit')) || 50, 200);
	const project = p.get('project');
	const ctx = mailCtx();
	const later = laterState();
	const tab = view === 'inbox' ? p.get('tab') : null;
	const out: MailThreadRow[] = [];
	let before = p.get('before');
	for (let round = 0; out.length < limit && round < 20; round++) {
		const rows = threads({ account, view, before, limit: limit * 2, tab, ...later }, accounts);
		out.push(...rows.filter((t) => mailVisible(t, ctx, project)));
		if (rows.length < limit * 2) break;
		before = rows.at(-1)!.sort;
	}
	return Response.json(out.slice(0, limit));
};
