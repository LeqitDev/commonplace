// Shared classes and helpers of the settings panel's tabs.
import { format } from 'date-fns';

export const input =
	'h-8.5 min-w-0 rounded-lg border border-line2 bg-transparent px-2.5 outline-none focus-visible:border-foreground';
export const card = 'flex flex-col rounded-xl border';
export const tabPanel = 'flex flex-col gap-4 px-6 pt-5.5 pb-6';
export const h2 = 'm-0 text-[17px] font-semibold tracking-[-0.01em]';
export const h3 = 'm-0 text-[13px] font-semibold';
/** Secondary button in a card (Sync now, Retry). */
export const soft = 'h-7.5 rounded-md bg-muted px-2.5 font-medium disabled:opacity-50';
/** Text button for Remove and the like. */
export const quiet =
	'flex h-7.5 items-center gap-1.5 rounded-md px-2 text-muted-foreground hover:text-foreground [&_svg]:size-4';
/** Last row of a card: "+ Add …". */
export const addRow =
	'flex h-12 items-center gap-2.5 rounded-b-xl border-t px-4 first:rounded-t-xl first:border-t-0 text-muted-foreground hover:text-foreground [&_svg]:size-4';

/** "09:14" today, else "3 Nov 09:14". */
export const when = (iso: string) =>
	format(
		new Date(iso),
		new Date(iso).toDateString() === new Date().toDateString() ? 'HH:mm' : 'd MMM HH:mm'
	);

/** A template text area (monospace). */
export const area =
	'resize-y rounded-lg border border-line2 bg-transparent px-3 py-2.5 font-mono text-[12.5px] leading-[1.6] outline-none focus-visible:border-foreground';
