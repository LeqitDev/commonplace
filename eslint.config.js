import prettier from 'eslint-config-prettier';
import path from 'node:path';
import js from '@eslint/js';
import svelte from 'eslint-plugin-svelte';
import { defineConfig, includeIgnoreFile } from 'eslint/config';
import globals from 'globals';
import ts from 'typescript-eslint';
import { MODULE_IDS, requires, routesOf } from './src/modules/registry.ts';

const gitignorePath = path.resolve(import.meta.dirname, '.gitignore');

export default defineConfig(
	includeIgnoreFile(gitignorePath),
	js.configs.recommended,
	ts.configs.recommended,
	svelte.configs.recommended,
	prettier,
	svelte.configs.prettier,
	{
		languageOptions: { globals: { ...globals.browser, ...globals.node } },
		rules: {
			// typescript-eslint strongly recommend that you do not use the no-undef lint rule on TypeScript projects.
			// see: https://typescript-eslint.io/troubleshooting/faqs/eslint/#i-get-errors-from-the-no-undef-rule-about-global-variables-not-being-defined-even-though-there-are-no-typescript-errors
			'no-undef': 'off'
		}
	},
	{
		files: ['**/*.svelte', '**/*.svelte.ts', '**/*.svelte.js'],
		languageOptions: {
			parserOptions: {
				projectService: true,
				extraFileExtensions: ['.svelte'],
				parser: ts.parser
			}
		}
	},
	{
		rules: {
			// `_`-prefixed names are intentionally unused (rest-destructuring to drop fields)
			'@typescript-eslint/no-unused-vars': [
				'error',
				{ argsIgnorePattern: '^_', varsIgnorePattern: '^_' }
			],
			// single-domain app without base path: plain hrefs/goto are fine
			'svelte/no-navigation-without-resolve': 'off',
			// local Date/Set instances are intentionally non-reactive
			'svelte/prefer-svelte-reactivity': 'off'
		}
	},
	// Module boundaries (src/lib/modules.ts): core never imports a module (it uses slots and
	// `service()`); a module imports only itself and what it requires; route dirs belong to their
	// module. Type imports are fine (they don't bundle anything).
	...boundaries()
);

/** @returns {import('eslint').Linter.Config[]} */
function boundaries() {
	/** @param {readonly string[]} allowed */
	const rule = (allowed) => ({
		'@typescript-eslint/no-restricted-imports': /** @type {import('eslint').Linter.RuleEntry} */ ([
			'error',
			{
				patterns: [
					{
						regex: `^#modules/(?!(registry\\.ts$|${allowed.map((id) => `${id}/`).join('|') || '$^'}))`,
						allowTypeImports: true,
						message: 'Reach other modules through a slot or service() (src/lib/modules.ts).'
					}
				]
			}
		])
	});
	return [
		{ files: ['src/**/*.{ts,svelte}'], rules: rule([]) },
		...MODULE_IDS.map((id) => ({
			files: [
				`src/modules/${id}/**/*.{ts,svelte}`,
				...routesOf(id).map((r) => `src/routes/${r}/**/*.{ts,svelte}`)
			],
			rules: rule([id, ...requires(id)])
		}))
	];
}
