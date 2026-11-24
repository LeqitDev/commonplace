import { defineServerModule } from '#lib/server/modules.ts';
import { syncAll } from './server/feeds.ts';

export default defineServerModule({
	id: 'calendar',
	init() {
		syncAll(); // checks the switch itself
		setInterval(syncAll, 3_600_000);
	}
});
