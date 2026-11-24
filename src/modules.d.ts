// Ambient declarations for scripts/vite-modules.ts (no top-level imports: this must stay a script).

/** The ids of the modules in this build (vite `define`). */
declare const __MODULES__: string[];

declare module 'virtual:modules' {
	const modules: import('#lib/modules.ts').ClientModule[];
	export default modules;
}

declare module 'virtual:modules/server' {
	const modules: import('#lib/server/modules.ts').ServerModule[];
	export default modules;
}
