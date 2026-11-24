import { goto } from '$app/navigation';
import type { ClientModule } from '#lib/modules.ts';
import { db } from '#lib/data.svelte.ts';
import { startModule, syncMail } from './mail.svelte.ts';
import Compose from './components/Compose.svelte';
import MailToTask from './components/MailToTask.svelte';
import Settings from './settings/Mail.svelte';
import MailIcon from '@lucide/svelte/icons/mail';
import { mailSource } from './calendar.ts';
import ItemMail from './ItemMail.svelte';
import MailNav from './MailNav.svelte';
import ProjectSenders from './ProjectSenders.svelte';

export default {
	id: 'mail',
	nav: [{ href: '/mail', label: 'Mail', icon: MailIcon, key: 'g m', order: 30, extra: MailNav }],
	commands: [
		{ label: 'Go to Mail', run: () => goto('/mail') },
		{ label: 'Sync mail', run: () => syncMail() }
	],
	search: { mail: 'Mail' },
	keys: { 'g m': () => goto('/mail') },
	shortcuts: [
		['g m', 'Mail'],
		['Ctrl Shift F', 'Mail editor: fill the window']
	],
	panels: [Compose, MailToTask],
	start: startModule,
	settingsTabs: [
		{
			id: 'mail',
			label: 'Mail',
			icon: MailIcon,
			component: Settings,
			order: 30,
			warn: () =>
				db.mail_accounts.all.some((a) => a.enabled !== false && a.error) &&
				'An account has a sync error'
		}
	],
	projectSections: [{ order: 5, column: 'wide', component: ProjectSenders }],
	itemBadges: [ItemMail],
	calendarSources: [mailSource]
} satisfies ClientModule;
