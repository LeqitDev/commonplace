// Mail triage on the server: what the model is told about a message (the "state", built from the
// cached .eml as in the triage notes), which messages are waiting, the answers a browser sends back,
// and the answers corrected by hand (labels, in planner.db so they are in the backups). The model
// runs on the user's PC and never sees the server: see `src/lib/triage.ts`, `src/lib/triage.svelte.ts`.
import { error } from '@sveltejs/kit';
import { format } from 'date-fns';
import { convert } from 'html-to-text';
import { DomUtils, parseDocument } from 'htmlparser2';
import type { Email } from 'postal-mime';
import { db, get, list } from '#lib/server/db.ts';
import * as store from './mailstore.ts';
import { enabledAccounts, inviteOf, isPicture, mdTable, parseMessage, triaged } from './mail.ts';
import {
	BY_NAME,
	VERSION,
	factLines,
	summary,
	type Answers,
	type Facts,
	type Item
} from '#modules/mail/triage/triage.ts';
import type { MailAccount, Settings } from '#lib/types.ts';

/** Inbox mail of the last two weeks is triaged. */
export const WINDOW_DAYS = 14;
export const since = (now = Date.now()) => new Date(now - WINDOW_DAYS * 86_400_000).toISOString();
/** ≈ 1,500 tokens of body (counted in characters: the model's tokenizer isn't here). */
const BODY_MAX = 6000;
const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

// ---------------------------------------------------------------- the body as text (notes, section 3)

type El = ReturnType<typeof DomUtils.findAll>[number];
type Node = El['children'][number];

const HIDDEN =
	/(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden|mso-hide\s*:\s*all|(?:font-size|max-height|max-width)\s*:\s*0(?:px|pt|em|rem|%)?|opacity\s*:\s*0(?:\.0+)?)\s*(?:!important)?\s*(?:;|$)/i;
/** Quoted history: Apple/Thunderbird, Gmail, Yahoo; Outlook's header and what follows it. */
const isQuote = (e: El) =>
	(e.name === 'blockquote' && e.attribs.type === 'cite') ||
	/\b(gmail_quote|yahoo_quoted|moz-cite-prefix)/.test(e.attribs.class ?? '');
const OUTLOOK = new Set([
	'divRplyFwdMsg',
	'appendonsend',
	'mail-editor-reference-message-container'
]);

const hostOf = (u: string) => {
	try {
		return new URL(/^[a-z][\w+.-]*:/i.test(u) ? u : `https://${u}`).hostname
			.toLowerCase()
			.replace(/^www\./, '');
	} catch {
		return '';
	}
};
/** Link text that reads like an address ("paypal.com", "https://x.org/login"). */
const LOOKS_LIKE_URL = /^(https?:\/\/)?(www\.)?([\w-]+\.)+[a-z]{2,}(\/\S*)?$/i;
const sameSite = (a: string, b: string) => a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`);
const textNode = (s: string) =>
	parseDocument(s.replace(/[<&]/g, (c) => (c === '<' ? '&lt;' : '&amp;'))).children[0];

const MEANINGLESS_ALT = /^(image|img|logo|bild|foto|photo|picture|spacer|pixel|icon|banner)\b/i;

/** HTML → text for the model: hidden parts, pictures and quoted history gone; links as
 *  "text (→ domain)"; links whose text names another site are reported. */
export function fromHtml(html: string) {
	const doc = parseDocument(html);
	const mismatch: string[] = [];
	// still in the document (not inside something removed before)
	const attached = (e: Node) => {
		let n: Node | typeof doc = e;
		while (n.parent) n = n.parent;
		return n === doc;
	};
	for (const e of DomUtils.findAll(() => true, doc.children)) {
		if (!attached(e)) continue;
		const style = e.attribs.style ?? '';
		if (
			/^(script|style|head|title|meta|link|noscript|template|svg)$/.test(e.name) ||
			'hidden' in e.attribs ||
			HIDDEN.test(style) ||
			isQuote(e)
		) {
			DomUtils.removeElement(e);
			continue;
		}
		if (OUTLOOK.has(e.attribs.id ?? '')) {
			// the original follows Outlook's header as siblings
			let n: Node | null = e;
			while (n) {
				const next: Node | null = n.next;
				DomUtils.removeElement(n);
				n = next;
			}
			continue;
		}
		if (e.name === 'img') {
			const alt = (e.attribs.alt ?? '').trim();
			if (isPicture(e) && alt.length >= 3 && !MEANINGLESS_ALT.test(alt))
				DomUtils.replaceElement(e, textNode(`[${alt}]`));
			else DomUtils.removeElement(e);
			continue;
		}
		if (e.name === 'a') {
			const href = (e.attribs.href ?? '').trim();
			if (!/^https?:/i.test(href)) continue;
			const to = hostOf(href);
			const text = DomUtils.textContent(e).replace(/\s+/g, ' ').trim();
			const shown = LOOKS_LIKE_URL.test(text) ? hostOf(text) : '';
			if (shown && to && !sameSite(shown, to)) mismatch.push(`${shown} → ${to}`);
			if (to && shown !== to) DomUtils.appendChild(e, textNode(` (→ ${to})`));
		}
	}
	const text = convert(DomUtils.getOuterHTML(doc), {
		wordwrap: false,
		formatters: { mdTable },
		selectors: [
			{ selector: 'a', options: { ignoreHref: true } },
			{ selector: 'img', format: 'skip' },
			{ selector: 'table', format: 'mdTable' },
			...['tr', 'td', 'th'].map((selector) => ({ selector, format: 'block' })),
			...['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].map((selector) => ({
				selector,
				options: { uppercase: false }
			})),
			{ selector: 'ul', options: { itemPrefix: '- ' } },
			{ selector: 'hr', format: 'skip' }
		]
	});
	return { body: tidy(text), mismatch: [...new Set(mismatch)] };
}

/** A text part for the model: addresses of links as "(→ domain)". */
export function fromText(text: string) {
	const body = text
		.replace(/<?(https?:\/\/[^\s<>"')\]]+)>?/g, (_, u: string) => {
			const h = hostOf(u);
			return h ? `(→ ${h})` : '';
		})
		.replace(/<(mailto:)?([^\s<>@]+@[^\s<>]+)>/g, '<$2>');
	return { body: tidy(body), mismatch: [] as string[] };
}

/** Where the quoted history of a reply starts. */
const HISTORY = [
	/^(On|Am|Le|El) .{4,200}?(\n.{0,120}?)?(wrote|schrieb|a écrit|escribió)[^\n]{0,80}:\s*$/m,
	/^-{2,}\s*(Original Message|Ursprüngliche Nachricht|Forwarded message|Weitergeleitete Nachricht)\s*-{2,}/im,
	/^_{8,}\s*\n\s*(From|Von):/m,
	/^(From|Von):\s.+\n(.+\n){0,2}(Sent|Gesendet|Date|Datum):\s/m
];
/** Lines of footers: "view in browser", unsubscribe, copyright, "this mail was sent to". */
const BOILER =
	/(view|open|read) (this|it|the) (e-?mail|message|newsletter)? ?(in|on) (your|a|the) (web ?)?browser|im (web)?browser (an)?(sehen|anzeigen|öffnen)|unsubscribe|abmelden|abbestellen|manage (your )?(e-?mail )?(preferences|subscriptions?)|you('re| are) receiving this|this (e-?mail|message) was sent to|diese (e-?mail|nachricht) wurde an|©|\(c\) ?\d{4}|all rights reserved|alle rechte vorbehalten/i;

/** NFKC, invisible characters gone, quoted history cut, footers dropped, whitespace collapsed,
 *  long texts shortened to their head and tail. */
export function tidy(raw: string) {
	let s = raw
		.normalize('NFKC')
		.replace(/[\u200B-\u200F\u2060-\u2064\uFEFF\u00AD\u034F\u180E\u2028\u2029]/g, '')
		.replace(/\u00A0/g, ' ')
		.replace(/\r\n?/g, '\n');
	for (const re of HISTORY) {
		const m = re.exec(s);
		if (m && m.index > 0) s = s.slice(0, m.index);
	}
	const lines: string[] = [];
	let sig = -1;
	for (const line of s.split('\n')) {
		const l = line.replace(/[ \t]+/g, ' ').trim();
		if (l.startsWith('>')) continue;
		if (l.length < 220 && BOILER.test(l)) continue;
		if (line === '-- ' || line === '--') sig = lines.length;
		if (sig >= 0 && lines.length - sig > 6) break; // keep a short signature
		lines.push(l);
	}
	s = lines
		.join('\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
	if (s.length <= BODY_MAX) return s;
	const head = s.slice(0, BODY_MAX - 1500).replace(/\s+\S*$/, '');
	const tail = s.slice(-1300).replace(/^\S*\s+/, '');
	return `${head}\n[… omitted …]\n${tail}`;
}

/** The text part when it is real; the HTML when there is none or it is a stub ("view online"). */
export function bodyOf(p: Pick<Email, 'text' | 'html'>) {
	const html = p.html ? fromHtml(p.html) : null;
	const text = p.text?.trim() ? fromText(p.text) : null;
	if (html && (!text || text.body.length < html.body.length * 0.3)) return html;
	return text ?? html ?? { body: '', mismatch: [] };
}

// ---------------------------------------------------------------- facts and state (notes, section 2)

const FREEMAIL =
	/^(gmail|googlemail|outlook|hotmail|live|msn|icloud|me|mac|yahoo|gmx|web|t-online|posteo|mailbox|protonmail|proton|aol|freenet|arcor)\.[a-z.]+$/i;
const NOREPLY =
	/^(no-?reply|do-?not-?reply|donotreply|mailer-daemon|postmaster|bounces?|notifications?|notify|alerts?|automated)([+._-]|$)/i;
const domainOf = (addr: string) => addr.split('@')[1]?.toLowerCase() ?? '';
const headers = (p: Pick<Email, 'headers'>, key: string) =>
	(p.headers ?? []).filter((h) => h.key === key).map((h) => h.value);

const knownQ = store.mdb.query<{ n: number }, [string]>(
	`SELECT EXISTS (SELECT 1 FROM msg, json_each(msg.to_json) AS j WHERE msg.folder = 'sent'
		AND lower(json_extract(j.value, '$.address')) = ?) AS n`
);

type Person = { name?: string; address?: string };
const who = (x: Person) => (x.name ? `${x.name} <${x.address ?? ''}>` : (x.address ?? ''));
/** "you <me@x> + 4 others", "Anna <a@x>, Ben <b@x> + 1 other", "none". */
function people(list: Person[], me: Set<string>) {
	if (!list.length) return 'none';
	const mine = list.find((x) => me.has((x.address ?? '').toLowerCase()));
	const head = mine ? `you <${mine.address}>` : list.slice(0, 2).map(who).join(', ');
	const more = list.length - (mine ? 1 : Math.min(2, list.length));
	return more > 0 ? `${head} + ${more} other${more > 1 ? 's' : ''}` : head;
}
const stamp = (d: Date) => format(d, 'EEE yyyy-MM-dd HH:mm');
const ago = (ms: number) =>
	ms < 3_600_000
		? `${Math.max(1, Math.round(ms / 60_000))} min ago`
		: ms < 48 * 3_600_000
			? `${Math.round(ms / 3_600_000)} h ago`
			: `${Math.round(ms / 86_400_000)} days ago`;

/** What code knows for sure about a message. */
export function factsOf(
	p: Pick<Email, 'headers' | 'to' | 'cc' | 'attachments'> & Partial<Pick<Email, 'text' | 'html'>>,
	from: string,
	account: string,
	me: Set<string>,
	mismatch: string[] = []
): Facts {
	const f: Facts = {};
	if (
		headers(p, 'list-unsubscribe').length ||
		headers(p, 'list-id').length ||
		headers(p, 'precedence').some((v) => /^(bulk|list|junk)$/i.test(v.trim()))
	)
		f.list = true;
	if (
		headers(p, 'auto-submitted').some((v) => !/^no\b/i.test(v.trim())) ||
		NOREPLY.test(from.split('@')[0] ?? '')
	)
		f.auto = true;
	const inv = inviteOf(p as Email);
	if (inv) f.invite = inv.info.method;
	const results = headers(p, 'authentication-results').find((v) => /\b(spf|dkim|dmarc)=/i.test(v));
	if (results) {
		f.auth = {};
		for (const [, k, v] of results.matchAll(/\b(spf|dkim|dmarc)=([a-z]+)/gi))
			f.auth[k.toLowerCase()] ??= v.toLowerCase();
	}
	const d = domainOf(from);
	if (d && d === domainOf(account) && !FREEMAIL.test(d)) f.ownDomain = true;
	f.known = !!knownQ.get(from.toLowerCase())?.n;
	const has = (l?: Person[]) => (l ?? []).some((x) => me.has((x.address ?? '').toLowerCase()));
	f.role = has(p.to) ? 'to' : has(p.cc) ? 'cc' : 'none';
	f.recipients = (p.to?.length ?? 0) + (p.cc?.length ?? 0);
	if (mismatch.length) f.mismatch = mismatch;
	return f;
}

/** Everything the model gets about one message. */
export async function itemOf(row: store.MsgRow, now = new Date()): Promise<Item> {
	const p = await parseMessage(row);
	const accounts = list('mail_accounts') as unknown as MailAccount[];
	const acc = accounts.find((a) => a.id === row.account);
	const me = new Set(accounts.map((a) => a.address.toLowerCase()));
	const body = bodyOf(p);
	const facts = factsOf(p, row.from_addr, acc?.address ?? '', me, body.mismatch);
	// the conversation: how long, and whether the message before this one was ours
	const rows = store.threadRows(row.thread, enabledAccounts());
	const msgs = [...new Map(rows.map((r) => [r.msgid, r])).values()];
	const i = msgs.findIndex((r) => r.msgid === row.msgid);
	const before = i > 0 ? msgs[i - 1] : null;
	facts.thread = {
		count: msgs.length,
		lastOurs: !!before && me.has(before.from_addr.toLowerCase())
	};
	const received = new Date(row.date);
	const vars = {
		weekday: format(now, 'EEEE'),
		today: format(now, 'yyyy-MM-dd'),
		received: `${stamp(received)} (${ago(now.getTime() - received.getTime())})`
	};
	const about = (get('settings', 'settings') as Settings | null)?.triage?.about?.trim();
	const state = {
		now: `${stamp(now)} ${TZ}`,
		recipient: [about, acc && `this mail came to their account "${acc.name}" <${acc.address}>`]
			.filter(Boolean)
			.join('; '),
		email: {
			received: vars.received,
			from: who({ name: row.from_name, address: row.from_addr }),
			to: people(p.to ?? [], me),
			cc: people(p.cc ?? [], me),
			subject: row.subject || '(no subject)',
			thread:
				msgs.length > 1
					? `${msgs.length} messages; the previous one was ${facts.thread.lastOurs ? 'yours' : `from ${before ? who({ name: before.from_name, address: before.from_addr }) : 'someone else'}`}`
					: 'first message',
			attachments: p.attachments
				.filter(
					(a) =>
						!/^(text\/calendar|application\/ics)/i.test(a.mimeType) &&
						(a.disposition === 'attachment' || !a.contentId)
				)
				.map((a) => a.filename || a.mimeType),
			facts: factLines(facts),
			body: body.body
		}
	};
	return { msgid: row.msgid, state: JSON.stringify(state), vars, facts };
}

// ---------------------------------------------------------------- waiting, answers

/** Messages handed to a browser are skipped by the next ones for a while (two devices with a model). */
const LEASE = 120_000;
const leases = new Map<string, { until: number; item: Item }>();

const ownAddresses = () =>
	JSON.stringify(
		(list('mail_accounts') as unknown as MailAccount[]).map((a) => a.address.toLowerCase())
	);
const PENDING = `FROM msg WHERE folder = 'inbox' AND cached = 1 AND date >= $since
	AND account IN (SELECT value FROM json_each($accounts))
	AND lower(from_addr) NOT IN (SELECT value FROM json_each($own))
	AND msgid NOT IN (SELECT msgid FROM triage WHERE version = $version)`;
const pendingArgs = () => ({
	$since: since(),
	$accounts: JSON.stringify(enabledAccounts()),
	$own: ownAddresses(),
	$version: VERSION
});

/** Inbox messages of the window that have no answers for this question set yet, newest first. */
export async function pending(limit: number): Promise<Item[]> {
	const now = Date.now();
	for (const [k, l] of leases) if (l.until < now) leases.delete(k);
	if (limit <= 0) return [];
	const rows = store.mdb
		.query<store.MsgRow, Record<string, string | number>>(
			`SELECT * ${PENDING} GROUP BY msgid ORDER BY date DESC LIMIT $limit`
		)
		.all({ ...pendingArgs(), $limit: limit + leases.size })
		.filter((r) => !leases.has(r.msgid))
		.slice(0, limit);
	const out: Item[] = [];
	for (const r of rows) {
		const item = await itemOf(r).catch(() => null);
		if (!item) continue;
		leases.set(r.msgid, { until: now + LEASE, item });
		out.push(item);
	}
	return out;
}

export function status() {
	const n = (sql: string, args: Record<string, string>) =>
		store.mdb.query<{ n: number }, Record<string, string>>(sql).get(args)?.n ?? 0;
	return {
		waiting: n(`SELECT count(DISTINCT msgid) AS n ${PENDING}`, pendingArgs()),
		done: n('SELECT count(*) AS n FROM triage WHERE version = $version AND date >= $since', {
			$version: VERSION,
			$since: since()
		}),
		labels: db.query<{ n: number }, []>('SELECT count(*) AS n FROM triage_labels').get()?.n ?? 0
	};
}

const rowOf = (msgid: string) =>
	store.mdb
		.query<store.MsgRow, [string]>(
			"SELECT * FROM msg WHERE msgid = ? ORDER BY folder = 'inbox' DESC, cached DESC LIMIT 1"
		)
		.get(msgid);

/** Answers must name questions of the set and be probabilities. */
function checkAnswers(a: unknown): Answers {
	if (!a || typeof a !== 'object' || Array.isArray(a)) error(400, 'answers must be an object');
	const ok = (p: unknown) => typeof p === 'number' && p >= 0 && p <= 1;
	for (const [k, v] of Object.entries(a)) {
		const q = BY_NAME[k];
		if (!q) error(400, `Unknown question: ${k}`);
		const good =
			q.type === 'predicate'
				? ok(v)
				: q.type === 'score'
					? Array.isArray(v) && v.length === q.items.length && v.every(ok)
					: !!v &&
						typeof v === 'object' &&
						Object.entries(v).every(([o, p]) => q.items.some((i) => i.v === o) && ok(p));
		if (!good) error(400, `Bad answer to ${k}`);
	}
	return a as Answers;
}

let tell: ReturnType<typeof setTimeout> | undefined;
/** Lists reload at most every 2 s while answers come in. */
const announce = () => {
	tell ??= setTimeout(() => {
		tell = undefined;
		triaged();
	}, 2000);
};

/** A browser sends what the model said about a message. */
export async function save(b: {
	msgid?: unknown;
	model?: unknown;
	version?: unknown;
	answers?: unknown;
}) {
	if (typeof b.msgid !== 'string') error(400, 'msgid missing');
	if (b.version !== VERSION) error(409, 'The question set changed: reload the page');
	const answers = checkAnswers(b.answers);
	const row = rowOf(b.msgid);
	if (!row) error(404, 'No such message');
	const item = leases.get(b.msgid)?.item ?? (await itemOf(row));
	const at = new Date().toISOString();
	const s = summary(answers, item.facts, at);
	store.mdb
		.query(
			`INSERT OR REPLACE INTO triage (msgid, thread, date, version, model, at, state, facts, answers, bucket, due, importance)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
		)
		.run(
			b.msgid,
			row.thread,
			row.date,
			VERSION,
			String(b.model ?? ''),
			at,
			item.state,
			JSON.stringify(item.facts),
			JSON.stringify(answers),
			s.bucket,
			s.due,
			s.importance
		);
	leases.delete(b.msgid);
	announce();
	return s;
}

/** "Run again": the window's answers go; the browser asks the model anew. */
export function clear() {
	store.mdb.query('DELETE FROM triage WHERE date >= ?').run(since());
	leases.clear();
	triaged();
}

/** The triage of a conversation's newest triaged message, with its labels (the reader). */
export function ofThread(thread: string) {
	const r = store.mdb
		.query<{ msgid: string; at: string; model: string; facts: string; answers: string }, [string]>(
			'SELECT msgid, at, model, facts, answers FROM triage WHERE thread = ? ORDER BY date DESC LIMIT 1'
		)
		.get(thread);
	if (!r) return null;
	return {
		msgid: r.msgid,
		at: r.at,
		model: r.model,
		facts: JSON.parse(r.facts) as Facts,
		answers: JSON.parse(r.answers) as Answers,
		labels: labelsOf(r.msgid)
	};
}

// ---------------------------------------------------------------- labels (planner.db)

db.run(`CREATE TABLE IF NOT EXISTS triage_labels (
	msgid TEXT PRIMARY KEY, at TEXT NOT NULL, version TEXT NOT NULL, model TEXT NOT NULL,
	state TEXT NOT NULL, facts TEXT NOT NULL, answers TEXT NOT NULL, labels TEXT NOT NULL)`);

export type Labels = Record<string, string | boolean>;
export const labelsOf = (msgid: string): Labels =>
	JSON.parse(
		db
			.query<{ labels: string }, [string]>('SELECT labels FROM triage_labels WHERE msgid = ?')
			.get(msgid)?.labels ?? '{}'
	);

/** The right answer to one question, by hand (`null` takes it back). The state and the model's
 *  answers are copied with the first label, so the eval works after the mail cache is gone. */
export function label(b: { msgid?: unknown; name?: unknown; value?: unknown }): Labels {
	if (typeof b.msgid !== 'string' || typeof b.name !== 'string')
		error(400, 'msgid and name needed');
	const q = BY_NAME[b.name];
	if (!q) error(400, `Unknown question: ${b.name}`);
	const v = b.value;
	if (
		v !== null &&
		(q.type === 'predicate' ? typeof v !== 'boolean' : !q.items.some((i) => i.v === v))
	)
		error(400, `Not an answer to ${b.name}`);
	const old = db
		.query<{ labels: string }, [string]>('SELECT labels FROM triage_labels WHERE msgid = ?')
		.get(b.msgid);
	const labels: Labels = JSON.parse(old?.labels ?? '{}');
	if (v === null) delete labels[b.name];
	else labels[b.name] = v as string | boolean;
	const now = new Date().toISOString();
	if (old) {
		db.query('UPDATE triage_labels SET labels = ?, at = ? WHERE msgid = ?').run(
			JSON.stringify(labels),
			now,
			b.msgid
		);
		return labels;
	}
	const t = store.mdb
		.query<
			{ version: string; model: string; state: string; facts: string; answers: string },
			[string]
		>('SELECT version, model, state, facts, answers FROM triage WHERE msgid = ?')
		.get(b.msgid);
	if (!t) error(404, 'This message has no triage');
	db.query(
		'INSERT INTO triage_labels (msgid, at, version, model, state, facts, answers, labels) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
	).run(b.msgid, now, t.version, t.model, t.state, t.facts, t.answers, JSON.stringify(labels));
	return labels;
}
