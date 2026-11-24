import { backup } from '#lib/server/db.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
	try {
		const file = backup();
		// read eagerly: a lazy Bun.file body can be cut off by proxies / a concurrent nightly backup
		const bytes = await Bun.file(file).bytes();
		return new Response(bytes, {
			headers: {
				'content-type': 'application/octet-stream',
				'content-length': String(bytes.byteLength),
				'content-disposition': `attachment; filename="${file.split('/').pop()}"`,
				'cache-control': 'no-store'
			}
		});
	} catch (e) {
		console.error('backup failed', e);
		return new Response(`Backup failed: ${(e as Error).message}`, { status: 500 });
	}
};
