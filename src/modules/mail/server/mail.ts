// Mail: IMAP sync into the cache (mailstore.ts), parsed messages for the reading pane, change events.
// The IMAP server is the truth, as the CalDAV server is for events.
import {
	ImapFlow,
	type FetchMessageObject,
	type FetchOptions,
	type FetchQueryObject,
	type ImapFlowOptions,
	type MessageStructureObject
} from 'imapflow';
import PostalMime, { type Email } from 'postal-mime';
import { readFile, writeFile } from 'node:fs/promises';
import nodemailer from 'nodemailer';
import { marked } from 'marked';
import { convert, type FormatCallback } from 'html-to-text';
import { parseDocument, DomUtils } from 'htmlparser2';
import { join } from 'node:path';
import ICAL from 'ical.js';
import { FILES_DIR, featureOn, get, list, patch, put, remove, type Doc } from '#lib/server/db.ts';
import { changed, importEvent, setPartstat } from '#lib/server/dav.ts';
import * as store from './mailstore.ts';
import { addrOf, servers, type MailCtx } from '../mail.ts';
import type {
	CalEvent,
	InviteInfo,
	MailAccount,
	MailAttachment,
	MailDraft,
	MailMessage
} from '#lib/types.ts';

const DAY = 86_400_000;
const WINDOW = 90 * DAY; // complete messages are kept for this long, older ones as headers + snippet
const CHUNK = 500; // UIDs per header fetch
const BODY_CHUNK = 25;
const SNIPPET_BYTES = 2048;

// ---------------------------------------------------------------- events (server-sent to the browser)

export interface MailEvent {
	account: string;
	/** Messages were added, changed or removed: the client reloads counts and the list. */
	changed: boolean;
	syncing: boolean;
	error?: string | null;
	/** New unread mail in an inbox (not on the first sync): the browser notifies. */
	fresh?: { thread: string; account: string; from: string; senders: string[]; subject: string }[];
	/** Only triage answers changed (no sync ran). */
	triaged?: boolean;
}
const listeners = new Set<(e: MailEvent) => void>();
export function onMail(fn: (e: MailEvent) => void) {
	listeners.add(fn);
	return () => void listeners.delete(fn);
}
const emit = (e: MailEvent) => listeners.forEach((fn) => fn(e));
/** Triage answers came in: the lists reload (no sync happened). */
export const triaged = () => emit({ account: '', changed: true, syncing: false, triaged: true });

// ---------------------------------------------------------------- accounts

const account = (id: string) => get('mail_accounts', id) as MailAccount | null;
/** Accounts to sync and watch: none while mail is switched off. */
export const enabledAccounts = () =>
	(featureOn('mail') ? list('mail_accounts') : [])
		.filter((a) => a.enabled !== false)
		.map((a) => a.id as string);

function connect(a: MailAccount, extra: Partial<ImapFlowOptions> = {}) {
	const { imap } = servers(a);
	if (!imap?.host) throw new Error('No IMAP server set');
	if (!a.password) throw new Error('No password set');
	const c = new ImapFlow({
		host: imap.host,
		port: imap.port,
		secure: imap.port !== 143, // 143: plain, upgraded with STARTTLS
		auth: { user: a.username || a.address, pass: a.password },
		logger: false,
		connectionTimeout: 30_000,
		greetingTimeout: 15_000,
		// self-signed certificates (own server, tests)
		...(process.env.MAIL_TLS_INSECURE === 'true' && { tls: { rejectUnauthorized: false } }),
		...extra
	});
	c.on('error', () => {}); // surfaced by the failing command; without a listener it would crash the process
	return c;
}

/** A readable message for a failed connection or command. */
function describe(e: unknown) {
	const err = e as { authenticationFailed?: boolean; responseText?: string; code?: string };
	if (err.authenticationFailed)
		return `Sign-in refused${err.responseText ? `: ${err.responseText}` : ''}`;
	return err.responseText || (e as Error).message || String(e);
}

type Box = { path: string; special: string | null };

async function folders(c: ImapFlow, a: MailAccount) {
	const boxes = await c.list();
	const box = (path?: string): Box | undefined =>
		path ? { path, special: boxes.find((b) => b.path === path)?.specialUse ?? null } : undefined;
	const use = (u: string) => boxes.find((b) => b.specialUse === u)?.path;
	return {
		inbox: box('INBOX')!,
		sent: box(a.folders?.sent || use('\\Sent')),
		// Gmail has no \Archive: archived mail is what is in All Mail but not in the inbox
		archive: box(a.folders?.archive || use('\\Archive') || use('\\All'))
	} satisfies Record<store.Folder, Box | undefined>;
}

// ---------------------------------------------------------------- parsing

const ids = (s?: string | null) => s?.match(/<[^>]+>/g) ?? [];

/** The part whose text makes the snippet of a message whose body isn't downloaded. */
export function textPart(s?: MessageStructureObject): string | null {
	if (!s) return null;
	const all: MessageStructureObject[] = [];
	const walk = (n: MessageStructureObject) => {
		if (n.childNodes) n.childNodes.forEach(walk);
		else if (n.disposition !== 'attachment') all.push(n);
	};
	walk(s);
	const p = all.find((n) => n.type === 'text/plain') ?? all.find((n) => n.type === 'text/html');
	if (!p) return null;
	return JSON.stringify({
		key: p.part ?? '1',
		type: p.type,
		charset: p.parameters?.charset ?? 'utf-8',
		encoding: p.encoding ?? '7bit'
	});
}

/** An invitation's calendar part (Outlook and nodemailer add an application/ics copy). */
const isCalendar = (type?: string) => type === 'text/calendar' || type === 'application/ics';

export function structureFlags(s?: MessageStructureObject) {
	let attach = false;
	let invite = false;
	const walk = (n: MessageStructureObject) => {
		if (n.childNodes) return n.childNodes.forEach(walk);
		if (isCalendar(n.type)) invite = true;
		else if (
			n.disposition === 'attachment' ||
			(!n.type.startsWith('text/') && n.disposition !== 'inline')
		)
			attach = true;
	};
	if (s) walk(s);
	return { attach, invite };
}

/** Row of the cache from what FETCH returned (envelope, flags, structure, References header). */
export function toRow(a: string, folder: store.Folder, m: FetchMessageObject): store.NewMsg {
	const env = m.envelope ?? {};
	const msgid = env.messageId || `<${folder}.${m.uid}.${a}@planner.invalid>`;
	const refs = ids(m.headers?.toString().replace(/\r?\n\s+/g, ' '));
	const from = env.from?.[0];
	const date = new Date(m.internalDate ?? env.date ?? 0);
	return {
		account: a,
		folder,
		uid: m.uid,
		msgid,
		// the conversation of a message it answers that we have already, else by the References rule
		thread:
			[ids(env.inReplyTo)[0], ...refs.toReversed()]
				.map((p) => p && store.threadOfMsgid(p))
				.find(Boolean) ?? store.threadId(msgid, refs, ids(env.inReplyTo)[0]),
		date: (isNaN(+date) ? new Date(0) : date).toISOString(),
		from_name: from?.name ?? '',
		from_addr: from?.address ?? '',
		to_json: JSON.stringify(
			[...(env.to ?? []), ...(env.cc ?? [])].map((x) => ({
				name: x.name ?? '',
				address: x.address ?? ''
			}))
		),
		subject: env.subject ?? '',
		snippet: null,
		seen: !!m.flags?.has('\\Seen'),
		flagged: !!m.flags?.has('\\Flagged'),
		...structureFlags(m.bodyStructure),
		tpart: textPart(m.bodyStructure)
	};
}

type El = ReturnType<typeof DomUtils.findAll>[number];
const tags = (name: string, e: El) => DomUtils.getElementsByTagName(name, e.children, true);
const cellsOf = (tr: El) =>
	tr.children.filter((c): c is El => c.type === 'tag' && /^t[dh]$/.test((c as El).name));
const BG = /background(-image)?\s*:[^;}]*url\(/i;

/** A picture that counts: no tracking pixel (a side up to 2px, hidden), no icon (up to 48px). */
export function isPicture(e: El) {
	const style = e.attribs.style ?? '';
	if (/display\s*:\s*none/i.test(style)) return false;
	const known = (['width', 'height'] as const)
		.map(
			(k) => e.attribs[k] ?? new RegExp(`(?:^|;)\\s*${k}\\s*:\\s*(\\d+)px`, 'i').exec(style)?.[1]
		)
		.filter((v): v is string => !!v && /^\d+$/.test(v.trim()))
		.map(Number);
	return !(known.some((n) => n <= 2) || (known.length > 0 && known.every((n) => n <= 48)));
}

/** A table of data (a row with two filled cells, short cells, nothing nested), not one for layout. */
function dataTable(t: El) {
	if (tags('table', t).length || tags('img', t).some(isPicture)) return false;
	const rows = tags('tr', t).map((r) => cellsOf(r).map((c) => DomUtils.textContent(c).trim()));
	return (
		rows.some((r) => r.filter(Boolean).length >= 2) &&
		rows.every((r) => r.every((c) => c.length <= 300))
	);
}

/** Data tables as markdown tables (the reader and the notes draw them); layout tables as blocks. */
export const mdTable: FormatCallback = (node, walk, builder) => {
	const t = node as unknown as El;
	if (!dataTable(t)) {
		builder.openBlock({ leadingLineBreaks: 2 });
		walk(node.children, builder);
		return builder.closeBlock({ trailingLineBreaks: 2 });
	}
	builder.openTable();
	for (const tr of tags('tr', t)) {
		builder.openTableRow();
		for (const c of cellsOf(tr)) {
			builder.openTableCell();
			walk(c.children as never, builder);
			builder.closeTableCell({ colspan: +c.attribs.colspan || 1 });
		}
		builder.closeTableRow();
	}
	builder.closeTable({
		tableToString: (rows) => {
			const cells = rows
				.map((r) =>
					r.flatMap((c) => [
						c.text.replace(/\s*\n\s*/g, ' ').replace(/\|/g, '\\|'),
						...Array<string>((c.colspan || 1) - 1).fill('')
					])
				)
				.filter((r) => r.some(Boolean));
			const n = Math.max(0, ...cells.map((r) => r.length));
			const lines = cells.map(
				(r) => `| ${[...r, ...Array<string>(n - r.length).fill('')].join(' | ')} |`
			);
			lines.splice(1, 0, `|${' --- |'.repeat(n)}`);
			return lines.join('\n');
		}
	});
};

// Marks of the markdown output: private-use characters, so that what the mail itself contains
// can be escaped before they become markup.
const [B0, B1, I0, I1, L0, L1, L2, H] = '\ue000\ue001\ue002\ue003\ue004\ue005\ue006\ue007';
const mdLink: FormatCallback = (node, walk, builder) => {
	const href = ((node as unknown as El).attribs.href ?? '').trim();
	if (!/^(https?:|mailto:)/i.test(href)) return walk(node.children, builder);
	const url = href.replace(/[\s()]/g, (c) => `%${c.charCodeAt(0).toString(16).padStart(2, '0')}`);
	builder.addLiteral(L0);
	walk(node.children, builder);
	builder.addLiteral(L1 + url + L2);
};
const mdHeading: FormatCallback = (node, walk, builder) => {
	builder.openBlock({ leadingLineBreaks: 2 });
	builder.addLiteral(H.repeat(Math.min(3, +(node as unknown as El).name[1] || 1)) + ' ');
	walk(node.children, builder);
	builder.closeBlock({ trailingLineBreaks: 2 });
};
/** What a line starts with that isn't its text: indentation, quote bars, list markers. */
const LEAD = /^(?:\s|>|[-*] |\d+\. |\ue007+ )*/;
/** `open`…`close` → the markdown `mark` around the text, line by line and hugging it. */
const surround = (s: string, open: string, close: string, mark: string) =>
	s.replace(new RegExp(`${open}([^${open}${close}]*)${close}`, 'g'), (_, inner: string) =>
		inner
			.split('\n')
			.map((line) => {
				const lead = LEAD.exec(line)![0];
				const text = line.slice(lead.length).trimEnd();
				return text ? lead + mark + text + mark + line.slice(lead.length + text.length) : line;
			})
			.join('\n')
	);
/** The marks as markdown; `*`, `_`, `\`, `](` and `#` of the mail itself are escaped. */
function markdown(s: string) {
	s = s
		.replace(
			/\ue005[^\ue006]*\ue006|\\(?!\|)|\*|(?<![\p{L}\p{N}])_|_(?![\p{L}\p{N}])|\](?=\()/gu,
			(m) => (m.length > 1 ? m : `\\${m}`)
		)
		.replace(/^((?:\s|>)*)(#{1,6} )/gm, '$1\\$2');
	s = surround(surround(s, I0, I1, '_'), B0, B1, '**');
	return s
		.replace(
			/\ue004([^\ue004-\ue006]*)\ue005([^\ue006]*)\ue006/g,
			(_, text: string, href: string) => {
				const t = text.replace(/\s*\n\s*/g, ' ').trim();
				const plain = t.replace(/\\(.)/g, '$1');
				if (!t || plain === href || `mailto:${plain}` === href) return t || href;
				return `[${t.replace(/(?<!\\)[[\]]/g, '\\$&')}](${href})`;
			}
		)
		.replace(/\ue007/g, '#')
		.replace(/[\ue000-\ue007]/g, '');
}

/**
 * HTML as text: quotes with "> ", list items with "- ", markdown tables, links as "text [url]".
 * With `md` as markdown: links as "[text](url)", `**bold**`, `_italic_`, "# " headings, and the
 * special characters of the mail's own text escaped (the reader draws it: `mailInline()`).
 */
export const htmlText = (h: string, md = false) => {
	const text = convert(h, {
		wordwrap: false,
		formatters: { mdTable, mdLink, mdHeading },
		selectors: [
			md
				? { selector: 'a', format: 'mdLink' }
				: { selector: 'a', options: { hideLinkHrefIfSameAsText: true } },
			{ selector: 'img', format: 'skip' },
			{ selector: 'table', format: 'mdTable' },
			...['tr', 'td', 'th'].map((selector) => ({ selector, format: 'block' })),
			...['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].map((selector) =>
				md ? { selector, format: 'mdHeading' } : { selector, options: { uppercase: false } }
			),
			{ selector: 'ul', options: { itemPrefix: '- ' } },
			...(md
				? [
						...['b', 'strong'].map((selector) => ({
							selector,
							format: 'inlineSurround',
							options: { prefix: B0, suffix: B1 }
						})),
						...['i', 'em'].map((selector) => ({
							selector,
							format: 'inlineSurround',
							options: { prefix: I0, suffix: I1 }
						}))
					]
				: [])
		]
	});
	return (md ? markdown(text) : text)
		.replace(/[ \t ]+$/gm, '')
		.replace(/\n{4,}/g, '\n\n\n')
		.trim();
};

/**
 * Is this HTML text in fact? Then it is shown as text instead of in the frame. Tracking pixels and
 * icons don't count, up to 3 other pictures are left out (`pictures`; those of the message itself
 * in `cids`), tables must be tables of data. Forms, media, backgrounds and layout tables: no.
 */
export function classify(html: string) {
	const all = DomUtils.findAll(() => true, parseDocument(html).children);
	const pics = all.filter((e) => e.name === 'img' && isPicture(e));
	const simple =
		pics.length <= 3 &&
		!all.some(
			(e) =>
				/^(form|input|button|select|textarea|video|audio|iframe|object|embed|picture)$/.test(
					e.name
				) ||
				e.attribs.background != null ||
				BG.test(e.attribs.style ?? '') ||
				(e.name === 'style' && BG.test(DomUtils.textContent(e))) ||
				(e.name === 'table' && !dataTable(e))
		);
	const cids = pics.map((e) => /^cid:(.+)/i.exec(e.attribs.src ?? '')?.[1]).filter((c) => !!c);
	return { simple, pictures: pics.length, cids: cids as string[] };
}
export const isSimpleHtml = (h: string) => classify(h).simple;

/** Plain text of a parsed message: its text part, else its HTML without tags. */
export const plainText = (p: Pick<Email, 'text' | 'html'>) =>
	p.text ?? (p.html ? htmlText(p.html) : '');

/** Snippet: the first words of the text, without quoted lines and signatures. */
export function snippet(text: string, max = 200) {
	const lines = text.split(/\r?\n/);
	const sig = lines.findIndex((l) => l === '-- ');
	return (sig < 0 ? lines : lines.slice(0, sig))
		.filter((l) => !l.startsWith('>'))
		.join(' ')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, max);
}

/** Snippet from the first bytes of a text part (fetched partially, still transfer-encoded). */
export async function partSnippet(tpart: string, raw: Buffer) {
	const t = JSON.parse(tpart) as { type: string; charset: string; encoding: string };
	let body = raw.toString('latin1');
	if (t.encoding.toLowerCase() === 'base64') {
		// cut off where the byte range ended, at a whole group of 4
		const b = body.replace(/[^A-Za-z0-9+/=]/g, '');
		body = b.slice(0, b.length - (b.length % 4));
	}
	const mime = `Content-Type: ${t.type}; charset="${t.charset}"\r\nContent-Transfer-Encoding: ${t.encoding}\r\n\r\n${body}`;
	const p = await PostalMime.parse(Buffer.from(mime, 'latin1'));
	return snippet(plainText(p));
}

// ---------------------------------------------------------------- sync

// Everything that talks to an account's server (sync, pending actions) runs one after another.
const chains = new Map<string, Promise<unknown>>();
function serial<T>(id: string, fn: () => Promise<T>): Promise<T> {
	const p = (chains.get(id) ?? Promise.resolve()).catch(() => {}).then(fn);
	chains.set(
		id,
		p.catch(() => {})
	);
	return p;
}

const running = new Map<string, Promise<boolean>>();

/** Sync one account. A call while one is waiting or running joins it. */
export function syncAccount(id: string): Promise<boolean> {
	let p = running.get(id);
	if (!p) {
		p = serial(id, () => runSync(id)).finally(() => running.delete(id));
		running.set(id, p);
	}
	return p;
}

export async function syncAll() {
	const r = await Promise.all(enabledAccounts().map(syncAccount));
	return r.some(Boolean);
}

async function runSync(id: string) {
	const a = account(id);
	if (!a || a.enabled === false || !featureOn('mail')) return false;
	let changed = false;
	let last = 0;
	// While a first sync is running the list fills: tell the browser every 2 s at most.
	const progress = () => {
		changed = true;
		if (Date.now() - last > 2000) {
			last = Date.now();
			emit({ account: id, changed: true, syncing: true });
		}
	};
	emit({ account: id, changed: false, syncing: true });
	let c: ImapFlow | null = null;
	let error: string | null = null;
	const fresh: number[] = [];
	try {
		c = connect(a);
		await c.connect();
		const boxes = await folders(c, a);
		await runOps(c, id, boxes); // our changes first, or the sync would read the old state back
		store.ensureDir(id);
		for (const f of ['inbox', 'sent', 'archive'] as const) {
			const box = boxes[f];
			if (box) fresh.push(...(await syncFolder(c, id, f, box, progress)));
		}
		if (await afterSync(c, id)) changed = true;
		patch('mail_accounts', id, {
			lastSync: new Date().toISOString(),
			error: null,
			errorSince: null
		});
		if (!watchers.has(id)) watch(id);
	} catch (e) {
		// a failed sign-in leaves the cache alone: mail from before is still shown
		error = describe(e);
		patch('mail_accounts', id, { error, errorSince: a.errorSince ?? new Date().toISOString() });
	} finally {
		await c?.logout().catch(() => c?.close());
		const rows = store.freshRows(fresh);
		emit({
			account: id,
			changed,
			syncing: false,
			error,
			...(rows.length && {
				fresh: rows.map((r) => ({
					thread: r.thread,
					account: r.account,
					from: r.from_name || r.from_addr,
					senders: [r.from_addr],
					subject: r.subject
				}))
			})
		});
	}
	return changed;
}

// ---------------------------------------------------------------- actions

type Boxes = Awaited<ReturnType<typeof folders>>;

/** A thread was marked read, flagged or (un)archived: the cache changes now, the server with the
 *  queued ops (right away, else with the next sync). */
export function act(thread: string, p: { seen?: boolean; flagged?: boolean; archived?: boolean }) {
	const accs = enabledAccounts();
	let n = 0;
	if (p.seen !== undefined) n += store.setSeen(thread, accs, p.seen);
	if (p.flagged !== undefined) n += store.setFlagged(thread, accs, p.flagged);
	if (p.archived !== undefined)
		n += store.setArchived(
			thread,
			accs,
			p.archived,
			(a) => store.folderState(a, 'archive')?.special === '\\All'
		);
	if (!n) return false;
	for (const a of accs) void pushOps(a);
	return true;
}

/** Send an account's pending actions to its server (no connection when there are none). */
export function pushOps(id: string) {
	if (!store.pendingOps(id).length) return Promise.resolve();
	return serial(id, async () => {
		const a = account(id);
		if (!a || a.enabled === false || !store.pendingOps(id).length) return;
		const c = connect(a);
		try {
			await c.connect();
			await runOps(c, id, await folders(c, a));
		} catch {
			/* retried with the next sync */
		} finally {
			await c.logout().catch(() => c.close());
			emit({ account: id, changed: true, syncing: false });
		}
	});
}

async function runOps(c: ImapFlow, id: string, boxes: Boxes) {
	for (const op of store.pendingOps(id)) {
		const args = JSON.parse(op.args) as {
			folder?: store.Folder;
			from?: store.Folder;
			to?: store.Folder;
			items: store.OpItem[];
			add?: string[];
			remove?: string[];
		};
		const src = (args.folder ?? args.from)!;
		const box = boxes[src];
		try {
			if (!box) throw new Error(`no ${src} folder`);
			const lock = await c.getMailboxLock(box.path);
			try {
				// the UID from the cache, else (a message moved a moment ago) looked up by Message-ID
				const uids: number[] = [];
				const msgidOf = new Map<number, string>();
				for (const it of args.items) {
					let uid = it.uid ?? store.uidOf(id, src, it.msgid);
					if (!uid && !it.msgid.endsWith('@planner.invalid>'))
						uid =
							((await c.search({ header: { 'message-id': it.msgid } }, { uid: true })) || [])[0] ??
							null;
					if (uid) {
						uids.push(uid);
						msgidOf.set(uid, it.msgid);
					}
				}
				if (uids.length && op.kind === 'flags') {
					if (args.add) await c.messageFlagsAdd(uids.join(','), args.add, { uid: true });
					if (args.remove) await c.messageFlagsRemove(uids.join(','), args.remove, { uid: true });
				} else if (uids.length && op.kind === 'move') {
					const dest = boxes[args.to!];
					if (!dest) throw new Error(`no ${args.to} folder`);
					// out of Gmail's All Mail into the inbox is a copy (All Mail keeps everything)
					const copy = args.from === 'archive' && box.special === '\\All';
					const res = copy
						? await c.messageCopy(uids.join(','), dest.path, { uid: true })
						: await c.messageMove(uids.join(','), dest.path, { uid: true });
					for (const [from, to] of (res && res.uidMap) || [])
						store.settleUid(id, args.to!, msgidOf.get(from)!, to);
				}
			} finally {
				lock.release();
			}
			store.opDone(op.id);
		} catch (e) {
			// given up after 10 tries (the next sync shows the server's state again)
			if (op.tries >= 9) store.opDone(op.id);
			else store.opFailed(op.id, describe(e));
		}
	}
}

// ---------------------------------------------------------------- IDLE

// One more connection per account sits in IDLE on the inbox; what it hears starts a sync. They live
// on globalThis: Vite reloads this module in dev and they would pile up.
type Watcher = {
	c: ImapFlow | null;
	stop: boolean;
	delay: number;
	timer?: ReturnType<typeof setTimeout>;
};
const g = globalThis as { __mailWatchers?: Map<string, Watcher> };
for (const w of g.__mailWatchers?.values() ?? []) {
	w.stop = true;
	clearTimeout(w.timer);
	w.c?.close();
}
const restart = !!g.__mailWatchers?.size;
const watchers = (g.__mailWatchers = new Map<string, Watcher>());
if (restart) queueMicrotask(() => watchAll());

/** (Re)start watching an account's inbox; stops it if the account is gone or off. */
export function watch(id: string) {
	unwatch(id);
	const a = account(id);
	if (!a || a.enabled === false || !a.password || !featureOn('mail')) return;
	const w: Watcher = { c: null, stop: false, delay: 5_000 };
	watchers.set(id, w);
	void open(id, w);
}

export function unwatch(id: string) {
	const w = watchers.get(id);
	if (!w) return;
	w.stop = true;
	clearTimeout(w.timer);
	w.c?.close();
	watchers.delete(id);
}

export function watchAll() {
	for (const id of [...watchers.keys()]) unwatch(id);
	for (const id of enabledAccounts()) watch(id);
}

async function open(id: string, w: Watcher) {
	const a = account(id);
	if (w.stop || !a) return;
	let debounce: ReturnType<typeof setTimeout> | undefined;
	const kick = () => {
		clearTimeout(debounce);
		debounce = setTimeout(() => void syncAccount(id), 1500);
	};
	let again = false;
	const reopen = () => {
		if (again || w.stop) return;
		again = true;
		w.c = null;
		w.timer = setTimeout(() => void open(id, w), w.delay);
		w.delay = Math.min(w.delay * 2, 300_000); // growing delay while the server is away
	};
	try {
		const c = connect(a, { autoIdleDelay: 1000 }); // imapflow's default waits 15 s before IDLE
		w.c = c;
		c.on('exists', kick);
		c.on('expunge', kick);
		c.on('flags', kick);
		c.on('close', reopen);
		await c.connect();
		await c.mailboxOpen('INBOX');
		w.delay = 5_000;
	} catch {
		w.c?.close();
		reopen();
	}
}

/** UIDs a server refused to FETCH (`account/folder/uid`): skipped until the next restart. */
const broken = new Set<string>();
const brokenKey = (a: string, folder: string, uid: number) => `${a}/${folder}/${uid}`;

const refused = (e: unknown) => (e as { responseStatus?: string }).responseStatus === 'NO';

/** UID FETCH that survives a server refusing some messages of the set (Gmail: "Some messages
 *  could not be FETCHed (Failure)"): the set is halved until the refused UIDs are found, which
 *  are passed to `skip` and left out. Other errors (connection, …) still throw. */
export async function fetchSafe(
	c: Pick<ImapFlow, 'fetch' | 'search'>,
	set: string | number[],
	query: FetchQueryObject,
	skip: (uid: number) => void,
	opts: FetchOptions = {}
): Promise<FetchMessageObject[]> {
	const once = async (s: string | number[]) => {
		const out: FetchMessageObject[] = [];
		const range = typeof s === 'string' ? s : s.join(',');
		for await (const m of c.fetch(range, query, { ...opts, uid: true })) out.push(m);
		return out;
	};
	const split = async (u: number[]): Promise<FetchMessageObject[]> => {
		if (u.length === 1) {
			skip(u[0]);
			return [];
		}
		const out: FetchMessageObject[] = [];
		for (const h of [u.slice(0, u.length >> 1), u.slice(u.length >> 1)])
			out.push(
				...(await once(h).catch((e) => {
					if (!refused(e)) throw e;
					return split(h);
				}))
			);
		return out;
	};
	try {
		return await once(set);
	} catch (e) {
		if (!refused(e)) throw e;
	}
	const uids = typeof set === 'string' ? (await c.search({ uid: set }, { uid: true })) || [] : set;
	return uids.length ? split(uids) : [];
}

async function syncFolder(
	c: ImapFlow,
	a: string,
	folder: store.Folder,
	{ path, special }: Box,
	progress: () => void
): Promise<number[]> {
	const fresh: number[] = [];
	const lock = await c.getMailboxLock(path, { readOnly: true });
	try {
		// c.mailbox is live (updated by every untagged response): take the values now
		const mb = c.mailbox as {
			uidValidity: bigint;
			uidNext: number;
			highestModseq?: bigint;
			exists: number;
		};
		const now = {
			path,
			uidvalidity: String(mb.uidValidity),
			uidnext: mb.uidNext,
			modseq: mb.highestModseq?.toString() ?? null,
			special
		};
		const exists = mb.exists;
		const skip = (uid: number) => broken.add(brokenKey(a, folder, uid));
		const ok = (r: { uid: number }) => !broken.has(brokenKey(a, folder, r.uid));
		let st = store.folderState(a, folder);
		if (st && (st.uidvalidity !== now.uidvalidity || st.path !== path)) {
			store.dropFolder(a, folder);
			st = null;
			progress();
		}

		// new messages, newest first so the list fills at once
		const from = st?.uidnext ?? 1;
		for (let hi = now.uidnext - 1; exists && hi >= from; hi -= CHUNK) {
			const got = await fetchSafe(
				c,
				`${Math.max(from, hi - CHUNK + 1)}:${hi}`,
				{
					uid: true,
					envelope: true,
					flags: true,
					bodyStructure: true,
					internalDate: true,
					headers: ['references']
				},
				skip
			);
			const rows = got.map((m) => toRow(a, folder, m));
			const ids = store.insert(rows);
			if (ids.length) progress();
			if (st) fresh.push(...ids); // not on the first sync of a folder
		}

		// flag changes: only what changed since the last sync where CONDSTORE is there
		if (st && exists) {
			const condstore = c.enabled.has('CONDSTORE') && st.modseq && now.modseq;
			if (!condstore || st.modseq !== now.modseq) {
				const updates: [number, boolean, boolean][] = [];
				const got = await fetchSafe(
					c,
					'1:*',
					{ uid: true, flags: true },
					skip,
					condstore ? { changedSince: BigInt(st.modseq!) } : {}
				);
				for (const m of got)
					updates.push([m.uid, !!m.flags?.has('\\Seen'), !!m.flags?.has('\\Flagged')]);
				if (store.setFlags(a, folder, updates)) progress();
			}
		}

		// removed or moved away
		if (store.count(a, folder) !== exists) {
			const uids = exists ? (await c.search({ all: true }, { uid: true })) || [] : [];
			if (store.keepOnly(a, folder, uids)) progress();
		}
		store.setFolderState(a, folder, now);

		// complete messages of the last 90 days
		const since = new Date(Date.now() - WINDOW).toISOString();
		const need = store.needBody(a, folder, since).filter(ok);
		for (let i = 0; i < need.length; i += BODY_CHUNK) {
			const part = need.slice(i, i + BODY_CHUNK);
			const got = await fetchSafe(
				c,
				part.map((r) => r.uid),
				{ uid: true, source: true },
				skip
			);
			for (const g of got) {
				const row = part.find((r) => r.uid === g.uid);
				if (row && g.source) await saveBody(a, row.msgid, g.source);
			}
			if (got.length) progress();
		}

		// older ones: a snippet from the first bytes of their text part
		const old = store.needSnippet(a, folder).filter(ok);
		for (let i = 0; i < old.length; i += 100) {
			const part = old.slice(i, i + 100);
			const byUid = new Map(part.map((r) => [r.uid, r]));
			const keys = new Set(part.map((r) => JSON.parse(r.tpart!).key as string));
			const got: { row: (typeof part)[number]; raw: Buffer }[] = [];
			for (const m of await fetchSafe(
				c,
				part.map((r) => r.uid),
				{ uid: true, bodyParts: [...keys].map((key) => ({ key, maxLength: SNIPPET_BYTES })) },
				skip
			)) {
				const row = byUid.get(m.uid);
				const key = row && JSON.parse(row.tpart!).key;
				const raw = row && (m.bodyParts?.get(key) ?? m.bodyParts?.get(key.toLowerCase()));
				if (row) got.push({ row, raw: raw ?? Buffer.alloc(0) });
			}
			for (const { row, raw } of got)
				store.setSnippet(row.id, await partSnippet(row.tpart!, raw).catch(() => ''));
			if (got.length) progress();
		}
	} finally {
		lock.release();
	}
	return fresh;
}

/** Keep a downloaded message: the .eml file, then snippet, flags and search text of its rows. */
async function saveBody(a: string, msgid: string, source: Buffer) {
	await writeFile(store.emlPath(a, msgid), source);
	const p = await PostalMime.parse(source).catch(() => null);
	const text = p ? plainText(p) : '';
	store.setBody(a, msgid, {
		snippet: snippet(text),
		text,
		attach: !!p?.attachments.some(
			(x) => !isCalendar(x.mimeType) && (x.disposition === 'attachment' || !x.contentId)
		),
		invite: !!p?.attachments.some((x) => isCalendar(x.mimeType))
	});
}

// ---------------------------------------------------------------- reading

const withTimeout = <T>(p: Promise<T>, ms: number) =>
	Promise.race([
		p,
		new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))
	]);

/** Download messages that aren't cached yet (older than the window). Stops after 20 s. */
async function fetchMissing(rows: store.MsgRow[]) {
	const byBox = Map.groupBy(
		rows.filter((r) => !r.cached),
		(r) => `${r.account}\n${r.folder}`
	);
	for (const [key, part] of byBox) {
		const [a, folder] = key.split('\n') as [string, store.Folder];
		const acc = account(a);
		const path = acc && store.folderState(a, folder)?.path;
		if (!acc || !path) continue;
		const c = connect(acc);
		try {
			await withTimeout(
				(async () => {
					await c.connect();
					const lock = await c.getMailboxLock(path, { readOnly: true });
					try {
						const got = (
							await fetchSafe(
								c,
								part.map((r) => r.uid),
								{ uid: true, source: true },
								(uid) => broken.add(brokenKey(a, folder, uid))
							)
						).filter((m) => m.source);
						store.ensureDir(a);
						for (const g of got) {
							const row = part.find((r) => r.uid === g.uid)!;
							await saveBody(a, row.msgid, g.source!);
							row.cached = 1;
						}
					} finally {
						lock.release();
					}
				})(),
				20_000
			);
		} catch {
			/* shown as "couldn't be loaded" */
		} finally {
			await c.logout().catch(() => c.close());
		}
	}
}

const address = (x: { name?: string; address?: string }) => ({
	name: x.name ?? '',
	address: x.address ?? ''
});

export async function parseMessage(row: store.MsgRow) {
	return PostalMime.parse(await readFile(store.emlPath(row.account, row.msgid)));
}

const isInline = (x: Email['attachments'][number], html?: string) =>
	!!x.contentId && !!html?.includes(`cid:${x.contentId.replace(/^<|>$/g, '')}`);

/** The messages of a thread with parsed bodies (fetching uncached ones from IMAP). */
export async function readThread(thread: string): Promise<MailMessage[]> {
	const rows = store.threadRows(thread, enabledAccounts());
	await fetchMissing(rows);
	return Promise.all(
		rows.map(async (r): Promise<MailMessage> => {
			const base = {
				id: r.id,
				msgid: r.msgid,
				references: [] as string[],
				account: r.account,
				folder: r.folder,
				date: r.date,
				fromName: r.from_name,
				fromAddr: r.from_addr,
				to: JSON.parse(r.to_json),
				cc: [],
				subject: r.subject,
				snippet: r.snippet ?? '',
				seen: !!r.seen,
				flagged: !!r.flagged,
				attachments: []
			};
			if (!r.cached) return { ...base, missing: true };
			const p = await parseMessage(r).catch(() => null);
			if (!p) return { ...base, missing: true };
			const inv = inviteOf(p);
			const attachments: MailAttachment[] = p.attachments
				.map((x, n) => ({
					n,
					filename: x.filename || `attachment-${n + 1}`,
					mime: x.mimeType,
					size: typeof x.content === 'string' ? x.content.length : x.content.byteLength,
					inline: isInline(x, p.html)
				}))
				.filter((a, n) => !(inv && isCalendar(p.attachments[n].mimeType))); // the card shows them
			const kind = p.html ? classify(p.html) : null;
			// read as text, the pictures of the message are listed like its files
			if (kind?.simple)
				for (const a of attachments)
					if (kind.cids.includes(p.attachments[a.n].contentId?.replace(/^<|>$/g, '') ?? ''))
						a.inline = false;
			const html = p.html?.replace(/cid:([^"'\s)>]+)/gi, (all, cid: string) => {
				const n = p.attachments.findIndex((x) => x.contentId?.replace(/^<|>$/g, '') === cid);
				return n < 0 ? all : `/api/mail/part/${r.id}/${n}`;
			});
			return {
				...base,
				references: ids(p.references),
				...(inv && { invite: inv.info }),
				to: (p.to ?? []).map(address),
				cc: (p.cc ?? []).map(address),
				// simple HTML is read as text (its own conversion, not the text part: links survive)
				...(html && kind?.simple
					? {
							text: htmlText(html, true),
							md: true,
							simple: true,
							...(kind.pictures && { pictures: kind.pictures })
						}
					: p.text != null || !html
						? { text: p.text }
						: { text: htmlText(html, true), md: true }),
				html,
				attachments
			};
		})
	);
}

/** One attachment of a cached message. */
export async function part(id: number, n: number) {
	const row = store.msg(id);
	if (!row || !row.cached || !enabledAccounts().includes(row.account)) return null;
	const p = await parseMessage(row).catch(() => null);
	const x = p?.attachments[n];
	if (!x) return null;
	return {
		filename: x.filename || `attachment-${n + 1}`,
		mime: x.mimeType || 'application/octet-stream',
		content: x.content
	};
}

/** Remove an account's cache (account deleted). */
export function forget(id: string) {
	unwatch(id);
	store.dropAccount(id);
	// a sync that is still running writes on until it ends: drop again then
	void running.get(id)?.finally(() => store.dropAccount(id));
}

// ---------------------------------------------------------------- planner state (later, projects)

/** What decides a thread's project and focus, from the planner's docs. */
export function mailCtx(): MailCtx {
	return {
		threads: Object.fromEntries(list('mail_threads').map((t) => [t.id, t])) as MailCtx['threads'],
		accounts: Object.fromEntries(
			list('mail_accounts').map((a) => [a.id, a])
		) as MailCtx['accounts'],
		projects: list('projects') as MailCtx['projects']
	};
}

/** Threads put off until later (`off`), those whose time has come (`back`, sorted by it) and those
 *  waiting for an answer. */
export function laterState(now = new Date().toISOString()) {
	const off: string[] = [];
	const back: Record<string, string> = {};
	const waiting: string[] = [];
	for (const t of list('mail_threads')) {
		if (t.later) {
			if (t.later > now) off.push(t.id);
			else back[t.id] = t.later;
		}
		if (t.waiting) waiting.push(t.id);
	}
	return { off, back, waiting };
}

// ---------------------------------------------------------------- sending

/** SMTP settings of an account (465 = TLS, other ports STARTTLS). */
function smtpOptions(a: MailAccount) {
	const { smtp } = servers(a);
	if (!smtp?.host) throw new Error('No SMTP server set');
	if (!a.password) throw new Error('No password set');
	return {
		host: smtp.host,
		port: smtp.port,
		secure: smtp.port === 465,
		requireTLS: smtp.port !== 465,
		auth: { user: a.username || a.address, pass: a.password },
		connectionTimeout: 30_000,
		...(process.env.MAIL_TLS_INSECURE === 'true' && { tls: { rejectUnauthorized: false } })
	};
}

const mailDomain = (addr: string) => addr.split('@')[1] || 'planner.invalid';

/** The raw message of a draft: markdown → text part as is and HTML part with marked; pictures
 *  from the notes (`/files/<id>`) go inline as cid, files and forwarded attachments along. */
export async function compose(d: MailDraft, a: MailAccount, messageId: string) {
	const md = [d.body ?? '', d.quote ?? ''].filter((s) => s.trim()).join('\n\n');
	const inline: { cid: string; path: string; filename: string; contentType?: string }[] = [];
	const html = (await marked.parse(md, { gfm: true, breaks: true })).replace(
		/(<img[^>]*\ssrc=")\/files\/([\w-]+)"/g,
		(_, pre: string, id: string) => {
			const meta = get('files', id);
			const cid = `${id}@planner`;
			if (!inline.some((x) => x.cid === cid))
				inline.push({
					cid,
					path: join(FILES_DIR, id),
					filename: meta?.name ?? id,
					contentType: meta?.mime
				});
			return `${pre}cid:${cid}"`;
		}
	);
	const files = (d.files ?? [])
		.map((id) => get('files', id))
		.filter((f): f is Doc => !!f)
		.map((f) => ({
			filename: f.name as string,
			path: join(FILES_DIR, f.id),
			contentType: f.mime as string
		}));
	const forwarded: { filename: string; content: Buffer; contentType: string }[] = [];
	const orig = d.forward ? store.msg(d.forward) : null;
	if (orig?.cached) {
		const p = await parseMessage(orig).catch(() => null);
		for (const x of p?.attachments ?? [])
			if (x.disposition === 'attachment' || !x.contentId)
				forwarded.push({
					filename: x.filename || 'attachment',
					content: Buffer.from(x.content as ArrayBuffer),
					contentType: x.mimeType
				});
	}
	const t = nodemailer.createTransport({ streamTransport: true, buffer: true });
	const info = await t.sendMail({
		from: a.sender ? { name: a.sender, address: a.address } : a.address,
		to: d.to,
		cc: d.cc,
		bcc: d.bcc,
		subject: d.subject ?? '',
		text: md,
		html: `<div style="font-family:system-ui,sans-serif;font-size:14px;line-height:1.5">${html}</div>`,
		messageId,
		date: new Date(),
		...(d.inReplyTo && { inReplyTo: d.inReplyTo, references: d.references ?? [d.inReplyTo] }),
		...(d.ical && { icalEvent: d.ical }),
		attachments: [...inline, ...files, ...forwarded]
	});
	return info.message as Buffer;
}

/** Send a draft: SMTP, then a copy in Sent (Gmail makes its own), then the draft goes. If it fails
 *  the draft stays with `queued` + `error` and the next sync tries again. `c`: an IMAP connection
 *  of the account that is open already (inside a sync). */
export async function send(id: string, c?: ImapFlow): Promise<{ ok: boolean; error?: string }> {
	const d = get('mail_drafts', id) as MailDraft | null;
	if (!d) return { ok: false, error: 'No such draft' };
	const a = account(d.account);
	const rcpts = [...d.to, ...(d.cc ?? []), ...(d.bcc ?? [])].map(addrOf).filter(Boolean);
	try {
		if (!a) throw new Error('No such account');
		if (!rcpts.length) throw new Error('No recipient');
		const messageId = `<${crypto.randomUUID()}@${mailDomain(a.address)}>`;
		const raw = await compose(d, a, messageId);
		const smtp = nodemailer.createTransport(smtpOptions(a));
		try {
			await smtp.sendMail({ envelope: { from: a.address, to: rcpts }, raw });
		} finally {
			smtp.close();
		}
		remove('mail_drafts', id);
		// the copy in Sent (not part of the sending: a failure here doesn't send twice)
		if (a.type !== 'gmail') {
			const append = async (conn: ImapFlow) => {
				const sent = (await folders(conn, a)).sent;
				if (sent) await conn.append(sent.path, raw, ['\\Seen']);
			};
			if (c) await append(c).catch(() => {});
			else
				await serial(a.id, async () => {
					const conn = connect(a);
					try {
						await conn.connect();
						await append(conn);
					} finally {
						await conn.logout().catch(() => conn.close());
					}
				}).catch(() => {});
		}
		if (d.track) {
			const thread = d.thread ?? store.threadId(messageId, d.references ?? [], d.inReplyTo);
			const info = { waiting: new Date().toISOString(), subject: d.subject ?? '', account: a.id };
			if (get('mail_threads', thread)) patch('mail_threads', thread, info);
			else
				put('mail_threads', {
					id: thread,
					...info,
					from: d.to.join(', '),
					fromAddr: addrOf(d.to[0] ?? '')
				});
		}
		if (!c) void syncAccount(a.id); // brings the Sent copy into the list
		emit({ account: d.account, changed: true, syncing: false });
		return { ok: true };
	} catch (e) {
		const error = describe(e);
		if (get('mail_drafts', id)) patch('mail_drafts', id, { queued: true, error });
		emit({ account: d.account, changed: true, syncing: false, error });
		return { ok: false, error };
	}
}

/** Inside a sync: what is queued for sending, and the Waiting threads that got their answer. */
async function afterSync(c: ImapFlow, id: string) {
	const invites = await handleInvites(id).catch(() => false);
	for (const d of list('mail_drafts', { where: { account: id } }))
		if (d.queued) await send(d.id, c);
	const own = list('mail_accounts').map((a) => a.address as string);
	let n = 0;
	for (const t of list('mail_threads'))
		if (t.waiting && store.answered(t.id, t.waiting, own)) {
			patch('mail_threads', t.id, { waiting: null });
			n++;
		}
	return n > 0 || invites;
}

// ---------------------------------------------------------------- invitations

const addr = (v: unknown) =>
	String(v ?? '')
		.replace(/^mailto:/i, '')
		.trim();

/** The calendar part of a parsed message: its text and what the card shows. */
export function inviteOf(p: Email): { ics: string; info: InviteInfo } | null {
	const part = p.attachments.find((x) => isCalendar(x.mimeType));
	if (!part) return null;
	const ics =
		typeof part.content === 'string'
			? part.content
			: new TextDecoder().decode(part.content as ArrayBuffer);
	try {
		const cal = new ICAL.Component(ICAL.parse(ics));
		const v = cal.getAllSubcomponents('vevent').find((e) => !e.hasProperty('recurrence-id'));
		if (!v) return null;
		const ev = new ICAL.Event(v);
		const time = (t: ICAL.Time | null) =>
			t ? (t.isDate ? t.toString() : t.toJSDate().toISOString()) : undefined;
		const org = v.getFirstProperty('organizer');
		const rrule = v.getFirstPropertyValue('rrule');
		return {
			ics,
			info: {
				method: String(cal.getFirstPropertyValue('method') ?? 'PUBLISH').toUpperCase(),
				uid: ev.uid,
				summary: ev.summary || '(no title)',
				start: time(ev.startDate)!,
				end: time(ev.endDate),
				allDay: ev.startDate.isDate,
				...(rrule && { rrule: rrule.toString() }),
				...(ev.location && { location: ev.location }),
				organizer: {
					name: String(org?.getParameter('cn') ?? ''),
					address: addr(org?.getFirstValue())
				},
				attendees: v.getAllProperties('attendee').map((a) => ({
					name: String(a.getParameter('cn') ?? ''),
					address: addr(a.getFirstValue()),
					partstat: String(a.getParameter('partstat') ?? 'NEEDS-ACTION').toUpperCase()
				})),
				sequence: Number(v.getFirstPropertyValue('sequence') ?? 0)
			}
		};
	} catch {
		return null;
	}
}

/** In a sync: new invitations become tentative events, cancellations remove them. */
async function handleInvites(id: string) {
	const since = new Date(Date.now() - WINDOW).toISOString();
	let n = 0;
	for (const row of store.inviteRows(id, since)) {
		const p = await parseMessage(row).catch(() => null);
		const inv = p && inviteOf(p);
		if (!inv) continue;
		const { info } = inv;
		const seen = store.inviteSeq(info.uid);
		if (seen !== null && seen >= info.sequence && info.method !== 'CANCEL') continue;
		const ev = get('events', info.uid) as CalEvent | null;
		if (info.method === 'CANCEL') {
			if (ev?.invite && seen !== -1) {
				remove('events', info.uid);
				changed('events', info.uid);
				n++;
			}
			store.setInviteSeq(info.uid, -1); // cancelled: a REQUEST of it no longer counts
			continue;
		}
		if (info.method !== 'REQUEST' || seen === -1) continue;
		store.setInviteSeq(info.uid, info.sequence);
		const over =
			(info.end ?? info.start) < new Date().toISOString().slice(0, info.allDay ? 10 : 24);
		// over already, an event of our own with that UID, or a subscribed calendar that has it
		const feed = list('feed_event').some((f) => (f.id as string).split('|')[1] === info.uid);
		if (over || (ev && !ev.invite) || feed) continue;
		importEvent(inv.ics, {
			tentative: true,
			invite: { organizer: info.organizer.address, partstat: 'NEEDS-ACTION' },
			mail: { thread: row.thread, subject: row.subject, from: row.from_name || row.from_addr },
			...(ev?.projectId && { projectId: ev.projectId })
		});
		n++;
	}
	return n > 0;
}

const ANSWER = { accept: 'ACCEPTED', maybe: 'TENTATIVE', decline: 'DECLINED' } as const;
const ANSWER_WORD = { ACCEPTED: 'Accepted', TENTATIVE: 'Tentative', DECLINED: 'Declined' } as const;

/** The METHOD:REPLY to the organizer: the event's identity and our ATTENDEE line only. */
export function replyIcs(ics: string, me: { name?: string; address: string }, partstat: string) {
	const src = new ICAL.Component(ICAL.parse(ics));
	const v = src.getAllSubcomponents('vevent').find((e) => !e.hasProperty('recurrence-id'))!;
	const cal = new ICAL.Component('vcalendar');
	cal.addPropertyWithValue('prodid', '-//Personal Planner//Mail//EN');
	cal.addPropertyWithValue('version', '2.0');
	cal.addPropertyWithValue('method', 'REPLY');
	for (const tz of src.getAllSubcomponents('vtimezone')) cal.addSubcomponent(tz);
	const r = new ICAL.Component('vevent');
	for (const name of [
		'uid',
		'sequence',
		'dtstart',
		'dtend',
		'duration',
		'rrule',
		'summary',
		'location',
		'organizer'
	])
		for (const p of v.getAllProperties(name))
			r.addProperty(ICAL.Property.fromString(p.toICALString()));
	r.updatePropertyWithValue('dtstamp', ICAL.Time.fromJSDate(new Date(), true));
	const a = new ICAL.Property('attendee');
	a.setValue(`mailto:${me.address}`);
	a.setParameter('partstat', partstat);
	if (me.name) a.setParameter('cn', me.name);
	r.addProperty(a);
	cal.addSubcomponent(r);
	return cal.toString();
}

/** Accept / Maybe / Decline an invitation (message `id`): our PARTSTAT in the event, the REPLY to
 *  the organizer (a draft, so a failure is retried), and: accept → settled, maybe → stays
 *  tentative, decline → the event goes and the mail is archived. */
export async function answerInvite(id: number, answer: keyof typeof ANSWER) {
	const row = store.msg(id);
	const a = row && account(row.account);
	if (!row || !a) return { ok: false, error: 'No such message' };
	const p = await parseMessage(row).catch(() => null);
	const inv = p && inviteOf(p);
	if (!inv || inv.info.method !== 'REQUEST')
		return { ok: false, error: 'No invitation in this message' };
	const { info } = inv;
	const partstat = ANSWER[answer];
	// which of our addresses was invited (else the account's)
	const own = list('mail_accounts').map((x) => (x.address as string).toLowerCase());
	const me =
		info.attendees.find((x) => own.includes(x.address.toLowerCase()))?.address ?? a.address;
	let ev = get('events', info.uid) as CalEvent | null;
	if (!ev && answer !== 'decline') {
		importEvent(inv.ics, {
			tentative: true,
			invite: { organizer: info.organizer.address, partstat: 'NEEDS-ACTION' },
			mail: { thread: row.thread, subject: row.subject, from: row.from_name || row.from_addr }
		});
		ev = get('events', info.uid) as CalEvent | null;
	}
	store.setInviteSeq(info.uid, Math.max(info.sequence, store.inviteSeq(info.uid) ?? 0));
	if (ev?.invite) {
		setPartstat(info.uid, me, partstat);
		if (answer === 'decline') remove('events', info.uid);
		else
			patch('events', info.uid, {
				tentative: answer === 'maybe' ? true : null,
				invite: { ...ev.invite, partstat }
			});
		changed('events', info.uid);
	}
	// nobody to tell (an invitation without ORGANIZER): the answer stays in the calendar
	if (!info.organizer.address) {
		if (answer === 'decline') act(row.thread, { archived: true });
		emit({ account: a.id, changed: true, syncing: false });
		return { ok: true, partstat, sent: false, noOrganizer: true };
	}
	const draft = put('mail_drafts', {
		id: crypto.randomUUID(),
		account: a.id,
		to: [
			info.organizer.name
				? `${info.organizer.name} <${info.organizer.address}>`
				: info.organizer.address
		],
		subject: `${ANSWER_WORD[partstat]}: ${info.summary}`,
		body: `${a.sender || a.address} ${partstat === 'ACCEPTED' ? 'accepted' : partstat === 'DECLINED' ? 'declined' : 'tentatively accepted'} the invitation.`,
		ical: {
			method: 'REPLY',
			content: replyIcs(inv.ics, { name: a.sender, address: me }, partstat)
		},
		inReplyTo: row.msgid,
		thread: row.thread
	});
	const sent = await send(draft.id);
	if (answer === 'decline') act(row.thread, { archived: true });
	emit({ account: a.id, changed: true, syncing: false });
	return { ok: true, partstat, sent: sent.ok, ...(sent.error && { error: sent.error }) };
}
