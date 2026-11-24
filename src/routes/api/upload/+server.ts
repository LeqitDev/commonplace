import { join } from 'node:path';
import { FILES_DIR, put } from '#lib/server/db.ts';
import type { RequestHandler } from './$types';

// multipart: file, optional id (Excalidraw passes its own file ids),
// optional projectId/folderId: the file is an item of the notes tree (`tree: true`)
export const POST: RequestHandler = async ({ request }) => {
	const form = await request.formData();
	const file = form.get('file') as File;
	const id = (form.get('id') as string) || crypto.randomUUID();
	const tree = form.has('projectId') || form.has('folderId');
	await Bun.write(join(FILES_DIR, id), file);
	return Response.json(
		put('files', {
			id,
			name: file.name,
			mime: file.type,
			size: file.size,
			...(tree && {
				tree: true,
				projectId: (form.get('projectId') as string) || null,
				folderId: (form.get('folderId') as string) || null
			})
		})
	);
};
