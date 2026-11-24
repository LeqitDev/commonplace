import { error } from '@sveltejs/kit';
import { join } from 'node:path';
import { FILES_DIR, get } from '#lib/server/db.ts';
import type { RequestHandler } from './$types';

// ?download = save as attachment instead of showing inline
export const GET: RequestHandler = ({ params, url }) => {
	const meta = get('files', params.id) ?? error(404, 'Not found');
	const disposition = url.searchParams.has('download') ? 'attachment' : 'inline';
	return new Response(Bun.file(join(FILES_DIR, params.id)), {
		headers: {
			'content-type': meta.mime || 'application/octet-stream',
			'content-disposition': `${disposition}; filename*=UTF-8''${encodeURIComponent(meta.name)}`,
			// blobs never change; tree files can be renamed (filename above), so those revalidate
			'cache-control': meta.tree ? 'private, no-cache' : 'private, max-age=31536000, immutable'
		}
	});
};
