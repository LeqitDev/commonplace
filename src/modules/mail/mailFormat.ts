// Display helpers for mail rows and messages.
import { format, isThisWeek, isThisYear, isToday, isYesterday } from 'date-fns';

/** "09:12", "Sat", "12 Nov", "12 Nov 2024". */
export function shortDate(iso: string) {
	const d = new Date(iso);
	if (isToday(d)) return format(d, 'HH:mm');
	if (isThisWeek(d, { weekStartsOn: 1 })) return format(d, 'EEE');
	return format(d, isThisYear(d) ? 'd MMM' : 'd MMM yyyy');
}

/** "Today, 09:12", "Sat 14 Nov, 18:30". */
export function longDate(iso: string) {
	const d = new Date(iso);
	if (isToday(d)) return `Today, ${format(d, 'HH:mm')}`;
	if (isYesterday(d)) return `Yesterday, ${format(d, 'HH:mm')}`;
	return format(d, isThisYear(d) ? 'EEE d MMM, HH:mm' : 'EEE d MMM yyyy, HH:mm');
}

export const dayGroup = (iso: string) => {
	const d = new Date(iso);
	return isToday(d) ? 'Today' : isYesterday(d) ? 'Yesterday' : 'Earlier';
};

export const initials = (name: string, address = '') => {
	const words = (name || address.split('@')[0]).split(/[\s._-]+/).filter(Boolean);
	return ((words[0]?.[0] ?? '?') + (words.length > 1 ? words.at(-1)![0] : '')).toUpperCase();
};

export const sizeLabel = (n: number) =>
	n < 1024
		? `${n} B`
		: n < 1024 ** 2
			? `${Math.round(n / 1024)} KB`
			: `${(n / 1024 ** 2).toFixed(1)} MB`;
