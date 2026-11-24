import { error } from '@sveltejs/kit';
import { join } from 'node:path';
import { FILES_DIR, put } from '#lib/server/db.ts';
import { part } from '#modules/mail/server/mail.ts';
import type { RequestHandler } from './$types';

// POST { projectId }: the attachment becomes a file of the notes tree (in that project).
export const POST: RequestHandler = async ({ params, request }) => {
	const p = await part(Number(params.msg), Number(params.n));
	if (!p) error(404, 'Not found');
	const { projectId } = (await request.json()) as { projectId?: string | null };
	const id = crypto.randomUUID();
	const content =
		typeof p.content === 'string'
			? new TextEncoder().encode(p.content)
			: new Uint8Array(p.content as ArrayBuffer);
	await Bun.write(join(FILES_DIR, id), content);
	return Response.json(
		put('files', {
			id,
			name: p.filename,
			mime: p.mime,
			size: content.byteLength,
			tree: true,
			projectId: projectId || null,
			folderId: null
		})
	);
};
