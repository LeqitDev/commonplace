// Mail on the client: unread counts, sync state, the server-sent events that drive them, and the
// triage actions. Messages aren't in `db`: the mail page fetches them per view (`/api/mail`).
import { toast } from 'svelte-sonner';
import { untrack } from 'svelte';
import { api, create, db, remove, update } from '#lib/data.svelte.ts';
import {
	baseSubject,
	mailPlain,
	mailVisible,
	replyDraft,
	senderMatches,
	threadProject,
	type MailCtx
} from './mail.ts';
import { goto } from '$app/navigation';
import { firstDate, type FoundDate } from './dates.ts';
import { summary } from './triage/triage.ts';
import { localIso } from '#lib/tasks.ts';
import { notify } from '#lib/notify.ts';
import { ui } from '#lib/ui.svelte.ts';
import type {
	MailAccount,
	MailDraft,
	MailLink,
	MailMessage,
	MailThread,
	MailThreadRow
} from '#lib/types.ts';

export const mail = $state({
	/** Unread conversations in the inbox per account (those that show with the focused project). */
	counts: {} as Record<string, number>,
	syncing: {} as Record<string, boolean>,
	/** Bumped when messages changed (server, own action, a later time passed): the page reloads. */
	version: 0,
	lastSync: 0
});

/** Enabled accounts, the default one first. */
export const accounts = (): MailAccount[] =>
	db.mail_accounts.all
		.filter((a) => a.enabled !== false)
		.sort(
			(a, b) => +!!b.default - +!!a.default || (a.createdAt ?? '').localeCompare(b.createdAt ?? '')
		);

export const unread = (account?: string | null) =>
	account
		? (mail.counts[account] ?? 0)
		: accounts().reduce((n, a) => n + (mail.counts[a.id] ?? 0), 0);

export async function loadCounts() {
	mail.counts = await api<Record<string, number>>(
		`/api/mail/counts${ui.project ? `?project=${ui.project}` : ''}`
	);
}

/** What decides projects and focus, from the loaded docs. */
export const ctx = (): MailCtx => ({
	threads: db.mail_threads.items,
	accounts: db.mail_accounts.items,
	projects: db.projects.all
});
export const projectOf = (t: Pick<MailThreadRow, 'thread' | 'account' | 'senders'>) =>
	threadProject(t, ctx());

/** Ask the server to sync (it returns at once; progress comes as events). */
export function syncMail(id?: string) {
	mail.lastSync = Date.now();
	if (id) mail.syncing[id] = true;
	return api(`/api/mail/sync${id ? `?id=${id}` : ''}`, { method: 'POST' });
}

const changed = () => {
	mail.version++;
	void loadCounts().catch(() => {});
};

// ---------------------------------------------------------------- actions

/** Read / flag / archive on the server (the cache changes at once). */
export async function act(
	thread: string,
	p: { seen?: boolean; flagged?: boolean; archived?: boolean }
) {
	await api(`/api/mail/${encodeURIComponent(thread)}`, {
		method: 'PATCH',
		body: JSON.stringify(p)
	});
	changed();
}

/** Archive with an "Undo" in the toast (moving it back isn't part of the global undo). */
export async function archive(thread: string) {
	await act(thread, { archived: true });
	toast('Archived', {
		action: { label: 'Undo', onClick: () => void act(thread, { archived: false }) }
	});
}

/** Planner-only state of a thread (later, project): a `mail_threads` doc, so it is undoable. */
async function setState(t: MailThreadRow, p: Partial<MailThread>) {
	const info = {
		subject: t.subject,
		from: t.fromName || t.fromAddr,
		fromAddr: t.fromAddr,
		account: t.account
	};
	if (db.mail_threads.items[t.thread]) await update('mail_threads', t.thread, { ...info, ...p });
	else await create('mail_threads', { id: t.thread, ...info, ...p });
	changed();
}
export const setLater = (t: MailThreadRow, later: Date | null) =>
	setState(t, { later: later ? later.toISOString() : null });
export const setThreadProject = (t: MailThreadRow, projectId: string | null) =>
	setState(t, { projectId });

/** "Always for this sender": a sender rule on the project. */
export async function alwaysForSender(projectId: string, addr: string) {
	const p = db.projects.items[projectId];
	if (!p || p.senders?.some((r) => senderMatches(r, addr))) return;
	await update('projects', projectId, { senders: [...(p.senders ?? []), addr.toLowerCase()] });
	changed();
}

// ---------------------------------------------------------------- events, notifications

type Fresh = { thread: string; account: string; from: string; senders: string[]; subject: string };

function announce(fresh: Fresh[]) {
	if (ui.focus) return; // focus mode mutes, as for reminders
	const shown = fresh.filter((f) => mailVisible(f, ctx(), ui.project));
	if (shown.length === 1) notify(`Mail from ${shown[0].from}`, shown[0].subject);
	else if (shown.length > 1)
		notify(`${shown.length} new mails`, shown.map((f) => f.from).join(', '));
}

const NOTIFIED = 'mail:later-notified';
/** Threads whose later time has come: back in the inbox (reload) and a notification, once. */
function laterDue() {
	const now = new Date().toISOString();
	const day = new Date(Date.now() - 86_400_000).toISOString();
	let done: string[] = [];
	try {
		done = JSON.parse(localStorage.getItem(NOTIFIED) ?? '[]');
	} catch {
		/* storage unavailable */
	}
	const due = db.mail_threads.all.filter(
		(t) => t.later && t.later <= now && t.later > day && !done.includes(`${t.id}@${t.later}`)
	);
	if (!due.length) return;
	changed();
	if (!ui.focus)
		for (const t of due) notify(`Back in the inbox: ${t.subject || '(no subject)'}`, t.from);
	done = [...done, ...due.map((t) => `${t.id}@${t.later}`)].slice(-200);
	try {
		localStorage.setItem(NOTIFIED, JSON.stringify(done));
	} catch {
		/* storage unavailable */
	}
}

/** Called after new mail arrived (triage asks the local model about it). */
const mailHooks = new Set<() => void>();
export const onMailChange = (fn: () => void) => {
	mailHooks.add(fn);
	return () => void mailHooks.delete(fn);
};

/** Listen to the server's mail events for the whole app; sync when the tab gets the focus. */
export function startMail() {
	void loadCounts().catch(() => {});
	const es = new EventSource('/api/mail/events');
	let timer: ReturnType<typeof setTimeout> | undefined;
	let triageTimer: ReturnType<typeof setTimeout> | undefined;
	let changedNow = false;
	let done = false;
	es.onmessage = (m) => {
		const e = JSON.parse(m.data) as {
			account: string;
			changed: boolean;
			syncing: boolean;
			fresh?: Fresh[];
			triaged?: boolean;
		};
		// triage answers came in: only the list reloads
		if (e.triaged) {
			clearTimeout(triageTimer);
			triageTimer = setTimeout(() => mail.version++, 300);
			return;
		}
		if (e.changed) mailHooks.forEach((fn) => fn());
		mail.syncing[e.account] = e.syncing;
		if (e.fresh) announce(e.fresh);
		changedNow ||= e.changed;
		done ||= !e.syncing;
		if (!changedNow && !done) return;
		clearTimeout(timer);
		timer = setTimeout(() => {
			void loadCounts().catch(() => {});
			if (changedNow) mail.version++;
			// lastSync and errors; drafts sent by a retry; Waiting cleared by an answer
			if (done)
				void Promise.all([
					db.mail_accounts.load(),
					db.mail_drafts.load(),
					db.mail_threads.load()
				]).catch(() => {});
			changedNow = done = false;
		}, 300);
	};
	const onFocus = () => {
		if (db.mail_accounts.all.length && Date.now() - mail.lastSync > 60_000)
			void syncMail().catch(() => {});
	};
	window.addEventListener('focus', onFocus);
	laterDue();
	const tick = setInterval(laterDue, 30_000);
	return () => {
		es.close();
		clearTimeout(timer);
		clearTimeout(triageTimer);
		clearInterval(tick);
		window.removeEventListener('focus', onFocus);
	};
}

/** The mail module while it is on: the server's events, and counts that follow the focused
 *  project, later times and sender rules (also through undo). */
export function startModule() {
	const stop = startMail();
	const root = $effect.root(() => {
		$effect(() => {
			void [
				ui.project,
				db.mail_threads.all.map((t) => [t.later, t.projectId]),
				db.projects.all.map((p) => p.senders)
			];
			untrack(() => void loadCounts().catch(() => {}));
		});
	});
	return () => {
		stop();
		root();
	};
}

// ---------------------------------------------------------------- writing

/** Drafts are saved as you type (no undo steps). */
export const saveDraft = (id: string, p: Partial<MailDraft>) => update('mail_drafts', id, p, false);
export const discardDraft = async (id: string) => {
	if (ui.compose === id) ui.compose = null;
	await remove('mail_drafts', id, false);
};

/** "Write": reopen the new message that was closed unsent, else start one. */
export async function writeNew(account?: string | null) {
	const open = db.mail_drafts.all.find(
		(d) => !d.thread && !d.inReplyTo && !d.forward && !d.queued && !d.quick
	);
	if (open) return void (ui.compose = open.id);
	const acc =
		(account && db.mail_accounts.items[account]?.enabled !== false && account) || accounts()[0]?.id;
	if (!acc) return void toast('No mail account yet', { description: 'Add one in Settings.' });
	const d = await create('mail_drafts', { account: acc, to: [], subject: '', body: '' }, false);
	ui.compose = d.id;
}

/** The draft of a reply in this conversation (quick reply or compose), if there is one. */
export const replyOf = (thread: string) =>
	db.mail_drafts.all.find((d) => d.thread === thread && !d.forward && !d.queued);

/** Reply / reply all / forward: a draft from the conversation's newest message. `quick`: for the
 *  textarea under the conversation instead of the compose panel. */
export async function startReply(
	kind: 'reply' | 'all' | 'forward',
	msgs: MailMessage[],
	thread: string,
	quick = false
) {
	const existing = kind === 'forward' ? null : replyOf(thread);
	if (existing) {
		if (!quick) {
			if (existing.quick) await saveDraft(existing.id, { quick: false });
			ui.compose = existing.id;
		}
		return existing;
	}
	const p = replyDraft(
		kind,
		msgs,
		Object.fromEntries(db.mail_accounts.all.map((a) => [a.id, a.address]))
	);
	const acc = db.mail_accounts.items[p.account]?.enabled !== false ? p.account : accounts()[0]?.id;
	const d = await create(
		'mail_drafts',
		{ ...p, account: acc, body: '', quick, ...(kind !== 'forward' && { thread }) },
		false
	);
	if (!quick) ui.compose = d.id;
	return d;
}

/** Send now; if it fails the draft stays queued and the next sync tries again. */
export async function sendDraft(id: string) {
	const r = await api<{ ok: boolean; error?: string }>('/api/mail/send', {
		method: 'POST',
		body: JSON.stringify({ id })
	});
	if (r.ok) {
		if (ui.compose === id) ui.compose = null;
		delete db.mail_drafts.items[id];
		toast('Sent');
	} else {
		await db.mail_drafts.load();
		toast.error('Not sent yet', {
			description: `${r.error}. It is kept and sent with the next sync.`
		});
	}
	await db.mail_threads.load(); // Waiting
	changed();
	return r.ok;
}

// ---------------------------------------------------------------- turn into task / event / note

export const linkOf = (
	t: Pick<MailThreadRow, 'thread' | 'subject' | 'fromName' | 'fromAddr'>
): MailLink => ({
	thread: t.thread,
	subject: t.subject || '(no subject)',
	from: t.fromName || t.fromAddr
});

/** What a conversation became (found by `mail.thread` on the items; the mail stores nothing). */
export const itemsOf = (thread: string) => ({
	tasks: db.tasks.all.filter((x) => x.mail?.thread === thread),
	events: db.events.all.filter((x) => x.mail?.thread === thread),
	notes: db.notes.all.filter((x) => x.mail?.thread === thread)
});
export const hasItems = (thread: string) => {
	const i = itemsOf(thread);
	return !!(i.tasks.length || i.events.length || i.notes.length);
};

/** Text of a message (the server converts HTML: markdown if `md`). */
export const messageText = (m: MailMessage) => m.text || m.snippet;
/** The same without markup (dates are looked for in it). */
const plain = (m: MailMessage) => mailPlain(m) || m.snippet;

/** The newest message someone else wrote (what the task, event or note is about). */
const subjectMessage = (msgs: MailMessage[]) =>
	msgs.findLast((m) => !db.mail_accounts.all.some((a) => a.address === m.fromAddr)) ?? msgs.at(-1)!;

/** "New task from mail": the panel (MailToTask) with a deadline found in the mail, or the date
 *  clicked, else the one the triage suggests. */
export const turn = $state({
	task: null as null | {
		row: MailThreadRow;
		title: string;
		deadline: string | null;
		found: boolean;
		/** The deadline comes from the triage ("Attention"). */
		suggested?: boolean;
	}
});

export function toTask(row: MailThreadRow, msgs: MailMessage[], date?: FoundDate | null) {
	const found = date ?? firstDate(plain(subjectMessage(msgs)));
	const t = row.triage;
	const due = !found && t ? summary(t.answers, t.facts, t.at).due : null;
	ui.task = null;
	ui.event = null;
	ui.draft = null;
	turn.task = {
		row,
		title: baseSubject(row.subject) || '(no subject)',
		deadline: found ? localIso(found.date, true) : due ? localIso(new Date(due), true) : null,
		found: !!found,
		suggested: !!due
	};
}

/** An event: the event editor's draft, at the date found in the mail (or the one clicked). */
export function toEvent(row: MailThreadRow, msgs: MailMessage[], date?: FoundDate | null) {
	const found = date ?? firstDate(plain(subjectMessage(msgs)));
	turn.task = null;
	ui.task = null;
	ui.event = null;
	let start: Date;
	if (found) start = found.date;
	else {
		start = new Date();
		start.setHours(start.getHours() + 1, 0, 0, 0);
	}
	const allDay = !!found && !found.time;
	const end = found?.end ?? new Date(start.getTime() + 3_600_000);
	ui.draft = {
		title: baseSubject(row.subject) || 'New event',
		start: allDay ? localIso(start, true) : start.toISOString(),
		end: allDay ? localIso(start, true) : end.toISOString(),
		allDay,
		projectId: projectOf(row),
		mail: linkOf(row)
	};
}

/** A note in the conversation's project with the mail's text. */
export async function toNote(row: MailThreadRow, msgs: MailMessage[]) {
	const m = subjectMessage(msgs);
	const when = new Date(m.date).toLocaleString('en-GB', {
		dateStyle: 'medium',
		timeStyle: 'short'
	});
	const n = await create('notes', {
		title: baseSubject(row.subject) || 'Mail',
		type: 'md',
		content: `*From ${m.fromName || m.fromAddr}, ${when}*\n\n${messageText(m)}\n`,
		projectId: projectOf(row),
		mail: linkOf(row)
	});
	goto(`/notes/${n.id}`);
}
