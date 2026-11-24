import { toast } from 'svelte-sonner';

/** Toast in the app plus a system notification when the tab is in the background. */
export function notify(title: string, body?: string) {
	toast(title, { description: body });
	if (
		typeof Notification !== 'undefined' &&
		Notification.permission === 'granted' &&
		document.hidden
	)
		new Notification(title, { body });
}

export async function askNotificationPermission() {
	if (typeof Notification !== 'undefined' && Notification.permission === 'default')
		await Notification.requestPermission();
}
