// Mail triage on the server: what the model is told about a message (the "state", built from the
// cached .eml as in the triage notes), which messages are waiting, the answers a browser sends back,
// the answers corrected by hand and the sender rules (in commonplace.db, so they are in the
// backups), one-time codes and DHL numbers found in the text. The model runs on the user's PC and
// never sees the server: see `src/modules/mail/triage/triage.ts` and `triage.svelte.ts`.
import { error } from '@sveltejs/kit';
import { format } from 'date-fns';
import { convert } from 'html-to-text';
import { DomUtils, parseDocument } from 'htmlparser2';
import type { Email } from 'postal-mime';
import { db, get, list } from '#lib/server/db.ts';
import * as store from './mailstore.ts';
import { enabledAccounts, inviteOf, isPicture, mdTable, parseMessage, triaged } from './mail.ts';
import { parcelsOf, track } from './parcels.ts';
import {
	BY_NAME,
	VERSION,
	factLines,
	isTab,
	summary,
	type Answers,
	type Facts,
	type History,
	type Item,
	type Labels,
	type Tab
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
/** The registrable part of a host, roughly: "mail.paypal.de" → "paypal.de", "x.co.uk" → "x.co.uk". */
const baseOf = (h: string) => {
	const l = h.split('.');
	const n = l.length > 2 && /^(co|com|org|net|ac|gov|edu)$/.test(l.at(-2) ?? '') ? 3 : 2;
	return l.slice(-n).join('.');
};
const textNode = (s: string) =>
	parseDocument(s.replace(/[<&]/g, (c) => (c === '<' ? '&lt;' : '&amp;'))).children[0];

const MEANINGLESS_ALT = /^(image|img|logo|bild|foto|photo|picture|spacer|pixel|icon|banner)\b/i;

/** HTML → text for the model: hidden parts, pictures and quoted history gone; links as
 *  "text (→ domain)"; links whose text names another site are reported. */
export function fromHtml(html: string) {
	const doc = parseDocument(html);
	const mismatch: string[] = [];
	const links = new Set<string>();
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
			links.add(href);
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
	return { body: tidy(text), mismatch: [...new Set(mismatch)], links: [...links] };
}

/** A text part for the model: addresses of links as "(→ domain)". */
export function fromText(text: string) {
	const links = [...new Set(text.match(/https?:\/\/[^\s<>"')\]]+/g) ?? [])];
	const body = text
		.replace(/<?(https?:\/\/[^\s<>"')\]]+)>?/g, (_, u: string) => {
			const h = hostOf(u);
			return h ? `(→ ${h})` : '';
		})
		.replace(/<(mailto:)?([^\s<>@]+@[^\s<>]+)>/g, '<$2>');
	return { body: tidy(body), mismatch: [] as string[], links };
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
	return text ?? html ?? { body: '', mismatch: [] as string[], links: [] as string[] };
}

// ---------------------------------------------------------------- facts and state (notes, section 2)

const FREEMAIL =
	/^(gmail|googlemail|outlook|hotmail|live|msn|icloud|me|mac|yahoo|gmx|web|t-online|posteo|mailbox|protonmail|proton|aol|freenet|arcor)\.[a-z.]+$/i;
const NOREPLY =
	/^(no-?reply|do-?not-?reply|donotreply|mailer-daemon|postmaster|bounces?|notifications?|notify|alerts?|automated)([+._-]|$)/i;
const domainOf = (addr: string) => addr.split('@')[1]?.toLowerCase() ?? '';
const headers = (p: Pick<Email, 'headers'>, key: string) =>
	(p.headers ?? []).filter((h) => h.key === key).map((h) => h.value);

/** Brands phishing likes to name, with the words their real domains contain. */
const BRANDS: Record<string, string[]> = {
	paypal: ['paypal'],
	amazon: ['amazon', 'primevideo', 'audible', 'a2z'],
	apple: ['apple', 'icloud'],
	icloud: ['apple', 'icloud'],
	microsoft: ['microsoft', 'outlook', 'office', 'live', 'hotmail', 'skype'],
	outlook: ['microsoft', 'outlook', 'office', 'live', 'hotmail'],
	google: ['google', 'gmail', 'youtube'],
	netflix: ['netflix'],
	spotify: ['spotify'],
	ebay: ['ebay'],
	dhl: ['dhl', 'deutschepost'],
	'deutsche post': ['deutschepost', 'dhl'],
	dpd: ['dpd'],
	fedex: ['fedex'],
	sparkasse: ['sparkasse'],
	volksbank: ['volksbank', 'vr'],
	commerzbank: ['commerzbank'],
	postbank: ['postbank'],
	'deutsche bank': ['db', 'deutsche-bank', 'deutschebank'],
	dkb: ['dkb'],
	n26: ['n26'],
	telekom: ['telekom', 't-online'],
	vodafone: ['vodafone'],
	facebook: ['facebook', 'facebookmail', 'meta'],
	instagram: ['instagram', 'facebookmail', 'meta'],
	whatsapp: ['whatsapp'],
	steam: ['steampowered', 'steam'],
	dropbox: ['dropbox'],
	elster: ['elster'],
	finanzamt: ['elster', 'finanzamt'],
	klarna: ['klarna']
};
const BRAND = new RegExp(`\\b(${Object.keys(BRANDS).join('|')})\\b`, 'i');
const NAME_DOMAIN = /\b((?:[a-z0-9-]+\.)+[a-z]{2,})\b/i;

/** The display name names a brand or a site the address doesn't belong to ("PayPal" from
 *  secure-mail.top, "paypal.com" from evil.example). */
export function spoofOf(name: string, addr: string) {
	const d = domainOf(addr);
	if (!d || !name) return undefined;
	const site = NAME_DOMAIN.exec(name.replace(/\S+@\S+/g, (a) => domainOf(a)))?.[1]?.toLowerCase();
	if (site && !sameSite(site.replace(/^www\./, ''), d)) return site;
	const brand = BRAND.exec(name)?.[1];
	if (brand && !BRANDS[brand.toLowerCase()].some((w) => d.split('.').some((l) => l.includes(w))))
		return brand;
	return undefined;
}

const historyQ = store.mdb.query<
	{ sent: number; fromAddr: number; fromDomain: number; since: string | null },
	Record<string, string>
>(
	`SELECT
		(SELECT count(DISTINCT msgid) FROM msg, json_each(msg.to_json) AS j WHERE folder = 'sent'
			AND date < $date AND lower(json_extract(j.value, '$.address')) = $addr) AS sent,
		(SELECT count(DISTINCT msgid) FROM msg WHERE folder != 'sent' AND date < $date
			AND lower(from_addr) = $addr) AS fromAddr,
		(SELECT count(DISTINCT msgid) FROM msg WHERE folder != 'sent' AND date < $date
			AND lower(from_addr) LIKE $like ESCAPE '\\') AS fromDomain,
		(SELECT min(date) FROM msg WHERE folder != 'sent' AND date < $date
			AND lower(from_addr) LIKE $like ESCAPE '\\') AS since`
);
/** Earlier mail with this sender in the cache. */
export function historyOf(from: string, date: string): History {
	const addr = from.toLowerCase();
	const d = domainOf(addr).replace(/[\\%_]/g, (c) => `\\${c}`);
	const r = historyQ.get({ $addr: addr, $date: date, $like: `%@${d}` });
	return {
		sent: r?.sent ?? 0,
		fromAddr: r?.fromAddr ?? 0,
		fromDomain: r?.fromDomain ?? 0,
		...(r?.since && { since: r.since })
	};
}

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

type Parsed = Pick<Email, 'headers' | 'to' | 'cc' | 'attachments'> &
	Partial<Pick<Email, 'text' | 'html' | 'replyTo'>>;

/** What code knows for sure about a message. `history` defaults to the mail cache's. */
export function factsOf(
	p: Parsed,
	from: { name?: string; address: string; date?: string },
	account: string,
	me: Set<string>,
	o: { mismatch?: string[]; links?: string[]; history?: History } = {}
): Facts {
	const f: Facts = {};
	const addr = from.address;
	if (
		headers(p, 'list-unsubscribe').length ||
		headers(p, 'list-id').length ||
		headers(p, 'precedence').some((v) => /^(bulk|list|junk)$/i.test(v.trim()))
	)
		f.list = true;
	if (
		headers(p, 'auto-submitted').some((v) => !/^no\b/i.test(v.trim())) ||
		NOREPLY.test(addr.split('@')[0] ?? '')
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
	const d = domainOf(addr);
	if (d && d === domainOf(account) && !FREEMAIL.test(d)) f.ownDomain = true;
	f.history = o.history ?? historyOf(addr, from.date ?? new Date().toISOString());
	const has = (l?: Person[]) => (l ?? []).some((x) => me.has((x.address ?? '').toLowerCase()));
	f.role = has(p.to) ? 'to' : has(p.cc) ? 'cc' : 'none';
	f.recipients = (p.to?.length ?? 0) + (p.cc?.length ?? 0);
	if (o.mismatch?.length) f.mismatch = o.mismatch;
	const spoof = spoofOf(from.name ?? '', addr);
	if (spoof) f.spoof = spoof;
	const rt = domainOf(p.replyTo?.find((x) => x.address)?.address ?? '');
	if (rt && d && !f.list && !sameSite(rt, d))
		f.replyTo = { domain: rt, free: FREEMAIL.test(rt) && !FREEMAIL.test(d) };
	const foreign = [
		...new Set((o.links ?? []).map(hostOf).filter((h) => h && d && baseOf(h) !== baseOf(d)))
	];
	if (foreign.length && !f.list) f.foreign = foreign.slice(0, 5);
	const puny = [d, ...(o.links ?? []).map(hostOf)].filter((h) => /(^|\.)xn--/.test(h));
	if (puny.length) f.punycode = [...new Set(puny)];
	return f;
}

// ---------------------------------------------------------------- codes and parcels in the text

const CODE_WORD =
	/(code|pin|tan|otp|passcode|kennwort|passwort|password|token|verification|verifizierung|bestätigung|anmeldung|login|sign[- ]?in)/i;
/** "123456", "G-123456", "123-456", "AB12CD" (with a digit). */
const CODE =
	/(?<![\w€$.,-])([A-Z]-\d{4,8}|\d{3}[- ]\d{3}|(?=[A-Z0-9]*\d)[A-Z0-9]{4,8})(?![\w€$%]|[.,]\d)/g;

/** The one-time code of a mail: next to a word like "code" (same line or the line after), not a
 *  year, price, time or date. */
export function codeOf(text: string): string | null {
	const lines = text.split('\n');
	for (let i = 0; i < lines.length; i++) {
		if (!CODE_WORD.test(lines[i])) continue;
		for (const line of [lines[i], lines[i + 1] ?? '']) {
			for (const m of line.matchAll(CODE)) {
				const c = m[1];
				if (/^(19|20)\d\d$/.test(c)) continue; // a year
				if (/^\d+$/.test(c) && c.length < 4) continue;
				if (/^[A-Z]+\d{1,2}$/.test(c) && c.length <= 4) continue; // "A4", "MP3"
				return c;
			}
		}
	}
	return null;
}

const DHL_LINK =
	/[?&](?:piececode|idc|tracking-id|trackingnumber|sendungsnummer)=([A-Z0-9]{8,35})/i;
const DHL_NUMBER = /\b(JJD\d{10,24}|00340\d{15}|JVGL\d{10,24})\b/g;
const DHL_NEAR =
	/(sendungsnummer|sendungs-nr\.?|trackingnummer|tracking-nummer|tracking number|tracking id|paketnummer|sendungsverfolgung)[^0-9\n]{0,40}(\d{12}|\d{20})\b/gi;

/** DHL tracking numbers of a mail that mentions DHL (sender, text or links). */
export function trackingOf(text: string, from: string, links: string[] = []): string[] {
	const dhlLinks = links.filter((l) => /(^|\.)dhl\.(de|com)$/.test(hostOf(l)));
	if (!/dhl/i.test(domainOf(from)) && !/\bDHL\b/.test(text) && !dhlLinks.length) return [];
	const out = new Set<string>();
	for (const l of dhlLinks) {
		const m = DHL_LINK.exec(l);
		if (m) out.add(m[1].toUpperCase());
	}
	for (const m of text.matchAll(DHL_NUMBER)) out.add(m[1]);
	for (const m of text.matchAll(DHL_NEAR)) out.add(m[2]);
	return [...out].slice(0, 5);
}

// ---------------------------------------------------------------- the state

/** What `prepare()` needs besides the message. */
export interface Context {
	now: Date;
	account?: { name: string; address: string };
	/** Our own addresses. */
	me: Set<string>;
	/** Settings › Mail › Triage › About you. */
	about?: string;
	/** The conversation: how many messages, and the one before this one. */
	thread?: { count: number; before: (Person & { ours: boolean }) | null };
	/** Earlier mail with the sender (default: the mail cache's). */
	history?: History;
}
export interface Prepared {
	item: Item;
	/** A one-time code found in the text (kept if the model says it is a code mail). */
	code: string | null;
	/** DHL tracking numbers found in it. */
	parcels: string[];
}
type Head = { msgid: string; date: string; from_name: string; from_addr: string; subject: string };

/** Everything the model gets about one message, and what code found in it. */
export function prepare(p: Parsed, row: Head, c: Context): Prepared {
	const body = bodyOf(p);
	const facts = factsOf(
		p,
		{ name: row.from_name, address: row.from_addr, date: row.date },
		c.account?.address ?? '',
		c.me,
		{ mismatch: body.mismatch, links: body.links, history: c.history }
	);
	const before = c.thread?.before ?? null;
	facts.thread = { count: c.thread?.count ?? 1, lastOurs: !!before?.ours };
	const received = new Date(row.date);
	const vars = {
		weekday: format(c.now, 'EEEE'),
		today: format(c.now, 'yyyy-MM-dd'),
		received: `${stamp(received)} (${ago(c.now.getTime() - received.getTime())})`
	};
	const count = facts.thread.count;
	const state = {
		now: `${stamp(c.now)} ${TZ}`,
		recipient: [
			c.about,
			c.account && `this mail came to their account "${c.account.name}" <${c.account.address}>`
		]
			.filter(Boolean)
			.join('; '),
		email: {
			received: vars.received,
			from: who({ name: row.from_name, address: row.from_addr }),
			to: people(p.to ?? [], c.me),
			cc: people(p.cc ?? [], c.me),
			subject: row.subject || '(no subject)',
			thread:
				count > 1
					? `${count} messages; the previous one was ${before?.ours ? 'yours' : `from ${before ? who(before) : 'someone else'}`}`
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
	const text = `${row.subject}\n${body.body}`;
	return {
		item: { msgid: row.msgid, state: JSON.stringify(state), vars, facts },
		code: codeOf(text),
		parcels: trackingOf(text, row.from_addr, body.links)
	};
}

/** A message of the cache, prepared with what the cache knows (accounts, thread, history). */
export async function prepareRow(row: store.MsgRow, now = new Date()): Promise<Prepared> {
	const p = await parseMessage(row);
	const accounts = list('mail_accounts') as unknown as MailAccount[];
	const acc = accounts.find((a) => a.id === row.account);
	const me = new Set(accounts.map((a) => a.address.toLowerCase()));
	const rows = store.threadRows(row.thread, enabledAccounts());
	const msgs = [...new Map(rows.map((r) => [r.msgid, r])).values()];
	const i = msgs.findIndex((r) => r.msgid === row.msgid);
	const b = i > 0 ? msgs[i - 1] : null;
	return prepare(p, row, {
		now,
		account: acc && { name: acc.name, address: acc.address },
		me,
		about: (get('settings', 'settings') as Settings | null)?.triage?.about?.trim(),
		thread: {
			count: msgs.length,
			before: b && {
				name: b.from_name,
				address: b.from_addr,
				ours: me.has(b.from_addr.toLowerCase())
			}
		}
	});
}

/** Everything the model gets about one message. */
export const itemOf = async (row: store.MsgRow, now = new Date()) =>
	(await prepareRow(row, now)).item;

// ---------------------------------------------------------------- waiting, answers

/** Messages handed to a browser are skipped by the next ones for a while (two devices with a model). */
const LEASE = 120_000;
const leases = new Map<string, { until: number; prep: Prepared }>();

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
		const prep = await prepareRow(r).catch(() => null);
		if (!prep) continue;
		leases.set(r.msgid, { until: now + LEASE, prep });
		out.push(prep.item);
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

/** A browser sends what the model said about a message. The answer is the summary (with the tab),
 *  so the browser knows whether to ask the summary model too. */
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
	const prep = leases.get(b.msgid)?.prep ?? (await prepareRow(row));
	const { item } = prep;
	const at = new Date().toISOString();
	const labels = labelsOf(b.msgid);
	const s = summary(answers, item.facts, at, { labels, rule: ruleOf(row.from_addr) });
	store.mdb
		.query(
			`INSERT OR REPLACE INTO triage (msgid, thread, date, version, model, at, state, facts, answers, bucket, due, importance, code, labels)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
			s.tab,
			s.due,
			s.importance,
			s.code ? prep.code : null,
			Object.keys(labels).length ? JSON.stringify(labels) : null
		);
	if (s.tab === 'orders' && prep.parcels.length) track(prep.parcels, row.thread, b.msgid);
	leases.delete(b.msgid);
	announce();
	return s;
}

/** The sentence of the summary model about a triaged message (`''` takes it back). */
export function saveSummary(b: { msgid?: unknown; summary?: unknown }) {
	if (typeof b.msgid !== 'string' || typeof b.summary !== 'string')
		error(400, 'msgid and summary needed');
	const text = b.summary.replace(/\s+/g, ' ').trim().slice(0, 300);
	const r = store.mdb
		.query('UPDATE triage SET summary = ? WHERE msgid = ?')
		.run(text || null, b.msgid);
	if (!r.changes) error(404, 'This message has no triage');
	announce();
	return { ok: true };
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
		.query<
			{
				msgid: string;
				date: string;
				at: string;
				model: string;
				facts: string;
				answers: string;
				bucket: string;
				code: string | null;
				summary: string | null;
			},
			[string]
		>(
			'SELECT msgid, date, at, model, facts, answers, bucket, code, summary FROM triage WHERE thread = ? ORDER BY date DESC LIMIT 1'
		)
		.get(thread);
	if (!r) return null;
	const from = rowOf(r.msgid)?.from_addr.toLowerCase() ?? '';
	return {
		msgid: r.msgid,
		received: r.date,
		at: r.at,
		model: r.model,
		facts: JSON.parse(r.facts) as Facts,
		answers: JSON.parse(r.answers) as Answers,
		labels: labelsOf(r.msgid),
		tab: r.bucket,
		code: r.code,
		summary: r.summary,
		from,
		rule: ruleOf(from),
		parcels: parcelsOf(thread)
	};
}

/** The tab again after a label or a sender rule changed (rows of this question set only: older
 *  ones are asked again anyway). */
function rebucket(msgids: string[]) {
	const get = store.mdb.query<
		{ facts: string; answers: string; at: string; msgid: string },
		[string, string]
	>('SELECT msgid, facts, answers, at FROM triage WHERE msgid = ? AND version = ?');
	const set = store.mdb.query('UPDATE triage SET bucket = ?, labels = ? WHERE msgid = ?');
	for (const id of msgids) {
		const r = get.get(id, VERSION);
		if (!r) continue;
		const labels = labelsOf(id);
		const from = rowOf(id)?.from_addr ?? '';
		const s = summary(JSON.parse(r.answers), JSON.parse(r.facts), r.at, {
			labels,
			rule: ruleOf(from)
		});
		set.run(s.tab, Object.keys(labels).length ? JSON.stringify(labels) : null, id);
	}
	announce();
}

// ---------------------------------------------------------------- sender rules (commonplace.db)

db.run(`CREATE TABLE IF NOT EXISTS triage_senders (
	addr TEXT PRIMARY KEY, tab TEXT NOT NULL, at TEXT NOT NULL)`);

/** The tab the user put a sender in ("Move sender to …"). */
export const ruleOf = (addr: string): Tab | null => {
	const t = db
		.query<{ tab: string }, [string]>('SELECT tab FROM triage_senders WHERE addr = ?')
		.get(addr.toLowerCase())?.tab;
	return isTab(t) ? t : null;
};

/** Mail of this sender goes to this tab from now on, and the triaged ones move (`null` lets the
 *  model decide again). Returns how many messages moved. */
export function setRule(b: { address?: unknown; tab?: unknown }) {
	if (typeof b.address !== 'string' || !b.address.includes('@')) error(400, 'address needed');
	if (b.tab !== null && !isTab(b.tab)) error(400, 'Unknown tab');
	const addr = b.address.toLowerCase();
	if (b.tab === null) db.query('DELETE FROM triage_senders WHERE addr = ?').run(addr);
	else
		db.query('INSERT OR REPLACE INTO triage_senders (addr, tab, at) VALUES (?, ?, ?)').run(
			addr,
			b.tab,
			new Date().toISOString()
		);
	const ids = store.mdb
		.query<{ msgid: string }, [string]>(
			'SELECT DISTINCT t.msgid FROM triage t JOIN msg m ON m.msgid = t.msgid WHERE lower(m.from_addr) = ?'
		)
		.all(addr)
		.map((r) => r.msgid);
	rebucket(ids);
	return { moved: ids.length, tab: b.tab };
}

// ---------------------------------------------------------------- labels (commonplace.db)

db.run(`CREATE TABLE IF NOT EXISTS triage_labels (
	msgid TEXT PRIMARY KEY, at TEXT NOT NULL, version TEXT NOT NULL, model TEXT NOT NULL,
	state TEXT NOT NULL, facts TEXT NOT NULL, answers TEXT NOT NULL, labels TEXT NOT NULL)`);

export const labelsOf = (msgid: string): Labels =>
	JSON.parse(
		db
			.query<{ labels: string }, [string]>('SELECT labels FROM triage_labels WHERE msgid = ?')
			.get(msgid)?.labels ?? '{}'
	);

/** The right answer to one question, by hand (`null` takes it back); it counts at once ("Not
 *  phishing" takes the warning away). The state and the model's answers are copied with the first
 *  label, so the eval works after the mail cache is gone. */
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
	} else {
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
	}
	rebucket([b.msgid]);
	return labels;
}
