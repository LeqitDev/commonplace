import { onMail } from '#modules/mail/server/mail.ts';
import type { RequestHandler } from './$types';

// Server-sent events: one `data:` line per sync step that changed something ({ account, changed,
// syncing, error }), a comment every 30 s so proxies keep the connection.
export const GET: RequestHandler = ({ request }) => {
	let stop = () => {};
	const stream = new ReadableStream({
		start(ctl) {
			const enc = new TextEncoder();
			const send = (s: string) => {
				try {
					ctl.enqueue(enc.encode(s));
				} catch {
					stop();
				}
			};
			const off = onMail((e) => send(`data: ${JSON.stringify(e)}\n\n`));
			const keepAlive = setInterval(() => send(': keep-alive\n\n'), 30_000);
			stop = () => {
				off();
				clearInterval(keepAlive);
			};
			request.signal.addEventListener('abort', stop);
			send(': connected\n\n');
		},
		cancel: () => stop()
	});
	return new Response(stream, {
		headers: {
			'content-type': 'text/event-stream',
			'cache-control': 'no-cache',
			'x-accel-buffering': 'no' // Nginx must not buffer the stream
		}
	});
};
