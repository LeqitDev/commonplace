// Typst fonts for flashcards, self-hosted: fetched once from the pinned typst-assets release and
// cached in DATA_DIR/typst-fonts, so browsers never talk to a CDN.
import { error } from '@sveltejs/kit';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from '#lib/server/db.ts';
import { TYPST_FONTS } from '#lib/typst-fonts.ts';
import type { RequestHandler } from './$types';

const SOURCE = 'https://cdn.jsdelivr.net/gh/typst/typst-assets@v0.13.1/files/fonts/';
const DIR = join(DATA_DIR, 'typst-fonts');

export const GET: RequestHandler = async ({ params }) => {
	if (!TYPST_FONTS.includes(params.file)) error(404, 'Unknown font');
	const path = join(DIR, params.file);
	if (!existsSync(path)) {
		const res = await fetch(SOURCE + params.file);
		if (!res.ok) error(502, `Font download failed (${res.status})`);
		mkdirSync(DIR, { recursive: true });
		await Bun.write(path, await res.arrayBuffer());
	}
	return new Response(Bun.file(path), {
		headers: { 'content-type': 'font/otf', 'cache-control': 'public, max-age=31536000, immutable' }
	});
};
