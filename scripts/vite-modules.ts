// Build-time module selection (see src/modules/registry.ts). MODULES=all (default) or a comma list.
// - `__MODULES__` = the built module ids
// - `virtual:modules` / `virtual:modules/server` = the built modules' manifests
//   (src/modules/<id>/module.ts, module.server.ts), so code of other modules is never imported
// - route files of modules that aren't built are replaced by stubs (pages empty, endpoints 404):
//   SvelteKit scans src/routes itself, so they can't simply be left out
import { existsSync } from 'node:fs';
import { basename, join, resolve, sep } from 'node:path';
import type { Plugin } from 'vite';
import { MODULE_IDS, resolveModules, routesOf } from '../src/modules/registry.ts';

const CLIENT = 'virtual:modules';
const SERVER = 'virtual:modules/server';

const STUB_SERVER = `export const fallback = () => new Response('Not found', { status: 404 });\n`;
const STUB_LOAD = `import { error } from '@sveltejs/kit';\nexport const load = () => error(404, 'Not found');\n`;
const STUB_LAYOUT = `<script>let { children } = $props();</script>\n{@render children?.()}\n`;

export function modules(): Plugin {
	const list = resolveModules(process.env.MODULES);
	const root = resolve('src');
	const off = MODULE_IDS.filter((id) => !list.includes(id))
		.flatMap(routesOf)
		.map((r) => join(root, 'routes', r) + sep);

	const manifests = (file: string) => {
		const found = list.filter((id) => existsSync(join(root, 'modules', id, file)));
		return (
			found
				.map((id, i) => `import m${i} from ${JSON.stringify(join(root, 'modules', id, file))};`)
				.join('\n') + `\nexport default [${found.map((_, i) => `m${i}`).join(', ')}];\n`
		);
	};

	return {
		name: 'commonplace-modules',
		enforce: 'pre',
		config: () => ({ define: { __MODULES__: JSON.stringify(list) } }),
		configResolved(c) {
			if (list.length < MODULE_IDS.length) c.logger.info(`modules: ${list.join(', ') || '(none)'}`);
		},
		resolveId(id) {
			if (id === CLIENT || id === SERVER) return `\0${id}`;
		},
		load(id) {
			if (id === `\0${CLIENT}`) return manifests('module.ts');
			if (id === `\0${SERVER}`) return manifests('module.server.ts');
			const file = id.split('?')[0];
			if (!off.some((d) => file.startsWith(d))) return;
			const name = basename(file);
			if (/^\+server\.[jt]s$/.test(name)) return STUB_SERVER;
			if (/^\+(page|layout)(\.server)?\.[jt]s$/.test(name)) return STUB_LOAD;
			if (name === '+layout.svelte') return STUB_LAYOUT;
			if (name === '+page.svelte') return '';
		}
	};
}
