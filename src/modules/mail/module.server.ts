import { defineServerModule } from '#lib/server/modules.ts';
import {
	enabledAccounts,
	forget,
	mailCtx,
	syncAccount,
	syncAll,
	unwatch,
	watch,
	watchAll
} from './server/mail.ts';
import { searchMail, threadInfo } from './server/mailstore.ts';
import { startParcels } from './server/parcels.ts';
import { threadProject } from './mail.ts';

/** What makes a changed account sign in again (the sync is the connection test, and sends what is queued). */
const LOGIN = ['password', 'username', 'address', 'type', 'imap', 'smtp', 'enabled', 'folders'];

export default defineServerModule({
	id: 'mail',
	init() {
		const sync = () => void syncAll().catch(() => {});
		sync();
		setInterval(sync, 300_000); // the safety net: new inbox mail comes through IDLE
		watchAll();
		startParcels(); // DHL tracking of parcels the triage found (only with DHL_API_KEY)
	},
	onPatch(coll, id, patch, doc) {
		if (coll === 'mail_accounts' && LOGIN.some((k) => k in patch)) {
			if (doc.enabled === false) unwatch(id);
			else void syncAccount(id).then(() => watch(id)); // IDLE with the new login
		}
		// switched on or off: start or stop syncing and IDLE
		if (coll === 'settings' && 'features' in patch) {
			watchAll();
			void syncAll().catch(() => {});
		}
	},
	onDelete(coll, id) {
		if (coll === 'mail_accounts') forget(id);
	},
	// a mail hit carries its project, so the palette filters it like the rest
	search(q) {
		const ctx = mailCtx();
		return searchMail(q, enabledAccounts()).map((h) => {
			const t = threadInfo(h.id);
			return { ...h, project: t ? threadProject(t, ctx) : null };
		});
	}
});
