import { error } from '@sveltejs/kit';
import { part } from '#modules/mail/server/mail.ts';
import type { RequestHandler } from './$types';

// An attachment or inline image of a message; ?download forces a download.
export const GET: RequestHandler = async ({ params, url }) => {
	const p = await part(Number(params.msg), Number(params.n));
	if (!p) error(404, 'Not found');
	const name = encodeURIComponent(p.filename);
	return new Response(p.content as BodyInit, {
		headers: {
			'content-type': p.mime,
			'content-disposition': `${url.searchParams.has('download') ? 'attachment' : 'inline'}; filename*=UTF-8''${name}`,
			// a mail's HTML/SVG attachment must not run as the app: own origin, no scripts
			'content-security-policy': 'sandbox',
			'x-content-type-options': 'nosniff',
			'cache-control': 'private, max-age=3600'
		}
	});
};
