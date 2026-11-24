// Mail helpers shared by the server and the client.
import type { MailAccount, MailDraft, MailMessage, MailThread, Project } from '#lib/types.ts';

/** Servers of the account types; "imap" asks for them. Outlook needs OAuth2 (later milestone). */
export const PRESETS: Record<
	'gmail' | 'icloud' | 'imap',
	{ label: string; imap?: { host: string; port: number }; smtp?: { host: string; port: number } }
> = {
	gmail: {
		label: 'Gmail',
		imap: { host: 'imap.gmail.com', port: 993 },
		smtp: { host: 'smtp.gmail.com', port: 465 }
	},
	icloud: {
		label: 'iCloud',
		imap: { host: 'imap.mail.me.com', port: 993 },
		smtp: { host: 'smtp.mail.me.com', port: 587 }
	},
	imap: { label: 'Other (IMAP)' }
};

/** IMAP/SMTP servers of an account: its own fields, else those of its preset. */
export function servers(a: Pick<MailAccount, 'type' | 'imap' | 'smtp'>) {
	const p = PRESETS[a.type as keyof typeof PRESETS];
	const imap = a.imap?.host ? a.imap : p?.imap;
	const smtp = a.smtp?.host ? a.smtp : p?.smtp;
	return {
		imap: imap && { host: imap.host, port: imap.port || 993 },
		smtp: smtp && { host: smtp.host, port: smtp.port || 587 }
	};
}

export const markerLetter = (a: Pick<MailAccount, 'letter' | 'name' | 'address'>) =>
	(a.letter || a.name || a.address || '?').trim().charAt(0) || '?';

/** Subject without reply/forward prefixes (also German and repeated ones). */
export const baseSubject = (s: string) =>
	s.replace(/^(\s*(re|fwd?|aw|wg|sv|vs)(\[\d+\])?\s*:\s*)+/i, '').trim();

export type MailView = 'inbox' | 'later' | 'waiting' | 'flagged' | 'sent' | 'archive';
export const VIEWS: { id: MailView; label: string }[] = [
	{ id: 'inbox', label: 'Inbox' },
	{ id: 'later', label: 'Later' },
	{ id: 'waiting', label: 'Waiting' },
	{ id: 'flagged', label: 'Flagged' },
	{ id: 'sent', label: 'Sent' },
	{ id: 'archive', label: 'Archive' }
];

// ---------------------------------------------------------------- projects and focus

export interface MailCtx {
	threads: Record<string, Pick<MailThread, 'projectId'> | undefined>;
	accounts: Record<
		string,
		Pick<MailAccount, 'assign' | 'group' | 'projectId' | 'show'> | undefined
	>;
	projects: Pick<Project, 'id' | 'group' | 'archived' | 'senders'>[];
}
type ThreadLike = { thread: string; account: string; senders: string[] };

/** Does a sender rule (address or `@domain`) match an address? */
export const senderMatches = (rule: string, addr: string) => {
	const r = rule.trim().toLowerCase();
	const a = addr.toLowerCase();
	// @domain also matches its subdomains (@lists.domain)
	return !!r && (r.startsWith('@') ? a.endsWith(r) || a.endsWith(`.${r.slice(1)}`) : a === r);
};

/** The project of a conversation: set by hand, else the account's, else a sender rule. */
export function threadProject(t: ThreadLike, ctx: MailCtx): string | null {
	const own = ctx.threads[t.thread]?.projectId;
	if (own) return own;
	const acc = ctx.accounts[t.account];
	if (acc?.assign === 'project' && acc.projectId) return acc.projectId;
	const p = ctx.projects.find(
		(p) => !p.archived && p.senders?.some((r) => t.senders.some((s) => senderMatches(r, s)))
	);
	return p?.id ?? null;
}

/** Whether a conversation shows with the focused project (null = "All projects"). */
export function mailVisible(t: ThreadLike, ctx: MailCtx, focused: string | null) {
	const proj = threadProject(t, ctx);
	const project = (id: string | null) => (id ? ctx.projects.find((p) => p.id === id) : undefined);
	if (!focused) return !project(proj)?.archived;
	const acc = ctx.accounts[t.account];
	if (acc?.show === 'always') return true;
	if (acc?.show === 'all') return false;
	if (proj) return proj === focused;
	// "all mail goes to group …": every project of that group
	return acc?.assign === 'group' && !!acc.group && project(focused)?.group === acc.group;
}

// ---------------------------------------------------------------- later

/** "Bring back" presets: label and time (null = not offered now). */
export function laterPresets(now = new Date()) {
	const at = (days: number, h: number) => {
		const d = new Date(now);
		d.setDate(d.getDate() + days);
		d.setHours(h, 0, 0, 0);
		return d;
	};
	const monday = (8 - now.getDay()) % 7 || 7; // next Monday, a week ahead on Mondays
	return [
		{ label: 'This afternoon', at: now.getHours() < 14 ? at(0, 15) : null },
		{ label: 'This evening', at: now.getHours() < 18 ? at(0, 19) : null },
		{ label: 'Tomorrow morning', at: at(1, 8) },
		{ label: 'Next week', at: at(monday, 8) }
	].filter((p): p is { label: string; at: Date } => !!p.at);
}

// ---------------------------------------------------------------- writing

type Addr = { name: string; address: string };
/** "Anna Keller <anna@uni.example>", or the bare address. */
export const formatAddr = (a: Addr) =>
	a.name && a.name !== a.address ? `${a.name.replace(/[<>"]/g, '')} <${a.address}>` : a.address;
/** The address part of "Name <addr>". */
export const addrOf = (s: string) => (s.match(/<([^>]+)>/)?.[1] ?? s).trim().toLowerCase();

const quoteDate = (iso: string) =>
	new Date(iso).toLocaleString('en-GB', {
		weekday: 'short',
		day: 'numeric',
		month: 'short',
		year: 'numeric',
		hour: '2-digit',
		minute: '2-digit'
	});

/** Reply, reply all or forward to the newest message of a conversation. `own` = our address per
 *  account id. */
export function replyDraft(
	kind: 'reply' | 'all' | 'forward',
	msgs: MailMessage[],
	own: Record<string, string>
): Partial<MailDraft> & { account: string } {
	const mine = new Set(Object.values(own).map((a) => a.toLowerCase()));
	const isMine = (a: string) => mine.has(a.toLowerCase());
	// forward: the newest message someone else wrote (ours just quotes it)
	const last = (kind === 'forward' && msgs.findLast((m) => !isMine(m.fromAddr))) || msgs.at(-1)!;
	const from: Addr = { name: last.fromName, address: last.fromAddr };
	const text = (last.text ?? last.snippet).trim();
	if (kind === 'forward')
		return {
			account: last.account,
			to: [],
			subject: `Fwd: ${baseSubject(last.subject)}`,
			quote: [
				'---------- Forwarded message ----------',
				`From: ${formatAddr(from)}`,
				`Date: ${quoteDate(last.date)}`,
				`Subject: ${last.subject}`,
				`To: ${last.to.map(formatAddr).join(', ')}`,
				'',
				text
			].join('\n'),
			forward: last.id
		};
	// written from this account (a follow-up): to its recipients again. Mail from another of our
	// accounts is answered like anyone's: from this account to that one.
	const followUp = last.fromAddr.toLowerCase() === own[last.account]?.toLowerCase();
	const to = followUp ? last.to : [from];
	const others =
		kind === 'all'
			? [...last.to, ...last.cc].filter(
					(a) =>
						!isMine(a.address) &&
						!to.some((t) => t.address.toLowerCase() === a.address.toLowerCase())
				)
			: [];
	const seen = new Set<string>();
	const uniq = (l: Addr[]) =>
		l.filter(
			(a) => a.address && !seen.has(a.address.toLowerCase()) && seen.add(a.address.toLowerCase())
		);
	return {
		account: last.account,
		to: uniq(to).map(formatAddr),
		cc: uniq(others).map(formatAddr),
		subject: `Re: ${baseSubject(last.subject)}`,
		quote: `On ${quoteDate(last.date)}, ${last.fromName || last.fromAddr} wrote:\n${text
			.split(/\r?\n/)
			.map((l) => `> ${l}`)
			.join('\n')}`,
		inReplyTo: last.msgid,
		references: [...last.references, last.msgid].slice(-20),
		thread: undefined // set by the caller (the thread id of the conversation)
	};
}

// ---------------------------------------------------------------- the text of a message, drawn

export interface MailSeg {
	s: string;
	bold?: boolean;
	em?: boolean;
	href?: string;
}
// what the server's `htmlText(h, true)` writes: escapes, **bold**, _italic_, [text](url)
const INLINE =
	/\\([!-/:-@[-`{-~])|\*\*((?:\\.|[^\\*])+)\*\*|(?<![\p{L}\p{N}])_((?:\\.|[^\\_]|(?<=[\p{L}\p{N}])_(?=[\p{L}\p{N}]))+)_(?![\p{L}\p{N}])|\[((?:\\.|[^[\]\\])*)\]\(((?:https?:|mailto:)[^()\s]+)\)/gu;

/**
 * A text in runs of one style. Only markdown made from HTML (`md`) has markup: in the text of a
 * plain mail `_this_` and `*this*` are what was typed.
 */
export function mailInline(text: string, md = false, style: Omit<MailSeg, 's'> = {}): MailSeg[] {
	const out: MailSeg[] = [];
	const push = (s: string, st = style) => {
		const last = out.at(-1);
		if (!s) return;
		if (last && last.bold === st.bold && last.em === st.em && last.href === st.href) last.s += s;
		else out.push({ s, ...st });
	};
	if (!md) return (push(text), out);
	let at = 0;
	for (const m of text.matchAll(INLINE)) {
		push(text.slice(at, m.index));
		at = m.index + m[0].length;
		const [, esc, bold, em, label, href] = m;
		const inner =
			esc != null
				? [{ s: esc, ...style }]
				: bold != null
					? mailInline(bold, true, { ...style, bold: true })
					: em != null
						? mailInline(em, true, { ...style, em: true })
						: mailInline(label, true, { ...style, href });
		for (const g of inner) push(g.s, g);
	}
	push(text.slice(at));
	return out;
}

/** The text without its markup (for finding dates). */
export const mailPlain = (m: { text?: string; md?: boolean }) =>
	mailInline(m.text ?? '', m.md)
		.map((g) => g.s)
		.join('');

export type MailBlock =
	| { kind: 'text'; quote: boolean; text: string }
	| { kind: 'head'; level: number; text: string }
	| { kind: 'table'; rows: string[][] }
	| { kind: 'list'; items: { depth: number; marker: string; text: string }[] };

const ROW = /^\|.*\|\s*$/;
const ITEM = /^(\s*)([-*•]|\d+[.)])\s+(\S.*)$/;
const cells = (line: string) =>
	line
		.trim()
		.slice(1, -1)
		.split(/(?<!\\)\|/)
		.map((c) => c.trim().replace(/\\\|/g, '|'));

/**
 * A message text in blocks: paragraphs, quoted ones (without their first "> "), markdown tables,
 * lists (items with their depth; indented lines below an item belong to it) and, in `md`, headings.
 */
export function mailBlocks(text: string, md = false): MailBlock[] {
	type Raw =
		| { kind: 'text' | 'quote' | 'row'; lines: string[] }
		| { kind: 'head'; level: number; text: string }
		| { kind: 'list'; items: { indent: number; marker: string; text: string }[] };
	const raw: Raw[] = [];
	const add = (kind: 'text' | 'quote' | 'row', line: string) => {
		const last = raw.at(-1);
		if (last?.kind === kind) (last as { lines: string[] }).lines.push(line);
		else raw.push({ kind, lines: [line] });
	};
	for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
		const last = raw.at(-1);
		const item = ITEM.exec(line);
		const head = md ? /^(#{1,3}) (.+)$/.exec(line) : null;
		if (line.startsWith('>')) add('quote', line);
		else if (ROW.test(line)) add('row', line);
		else if (head) raw.push({ kind: 'head', level: head[1].length, text: head[2] });
		else if (item) {
			const it = { indent: item[1].length, marker: item[2], text: item[3] };
			if (last?.kind === 'list') last.items.push(it);
			else raw.push({ kind: 'list', items: [it] });
		} else if (last?.kind === 'list' && /^\s+\S/.test(line))
			last.items.at(-1)!.text += `\n${line.trim()}`;
		else add('text', line);
	}
	return raw
		.map((b): MailBlock => {
			if (b.kind === 'head') return b;
			if (b.kind === 'list') {
				const levels = [...new Set(b.items.map((i) => i.indent))].sort((x, y) => x - y);
				return {
					kind: 'list',
					items: b.items.map((i) => ({
						depth: levels.indexOf(i.indent),
						marker: /\d/.test(i.marker) ? i.marker.replace(')', '.') : '•',
						text: i.text
					}))
				};
			}
			// a table has its row of dashes; other lines between pipes are just text
			if (b.kind === 'row' && /^\|(\s*:?-+:?\s*\|)+\s*$/.test(b.lines[1] ?? ''))
				return { kind: 'table', rows: b.lines.filter((l, n) => n !== 1).map(cells) };
			const quote = b.kind === 'quote';
			// the bar shows the quote: drop one level of "> "
			const lines = quote ? b.lines.map((l) => l.replace(/^> ?/, '')) : b.lines;
			return { kind: 'text', quote, text: lines.join('\n').replace(/^\n+|\n+$/g, '') };
		})
		.filter((b) => b.kind !== 'text' || b.text);
}
