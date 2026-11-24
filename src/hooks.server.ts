import type { Handle, ServerInit } from '@sveltejs/kit/hooks';
import modules from 'virtual:modules/server';
import { built } from '#modules/registry.ts';
import { backup } from '#lib/server/db.ts';
import { migrate, sync } from '#lib/server/dav.ts';

const HOUR = 3_600_000;

export const init: ServerInit = () => {
	// events and tasks on the CalDAV server (core: the docs are there whichever module shows them)
	if (built('calendar') || built('tasks')) {
		migrate(); // events and tasks from before they were iCalendar resources
		sync();
		setInterval(sync, HOUR / 12);
	}
	for (const m of modules) m.init?.();
	let lastBackup = '';
	setInterval(() => {
		const day = new Date().toISOString().slice(0, 10);
		if (day !== lastBackup && new Date().getHours() >= 3) {
			lastBackup = day;
			backup();
		}
	}, HOUR);
};

// Authentication is done by Authelia in front of the app (forward auth via Nginx Proxy Manager).
// REQUIRE_AUTH_HEADER=true rejects requests that did not pass through the proxy.
export const handle: Handle = ({ event, resolve }) => {
	const user = event.request.headers.get('remote-user');
	if (process.env.REQUIRE_AUTH_HEADER === 'true' && !user)
		return new Response('Unauthorized', { status: 401 });
	return resolve(event);
};
