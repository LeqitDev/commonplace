// Mail triage with a decision model running on the user's own PC (LM Studio's `/v1/decisions`).
// The server describes a mail (the "state"), a browser tab that has the model asks it the questions
// of `triage-questions.json` in up to three rounds, and the server stores the answers. This module
// is shared by the server (summary, buckets), the browser (requests, markers) and the eval script.
import RAW from './triage-questions.json' with { type: 'json' };

// ---------------------------------------------------------------- the question set

export type QType = 'predicate' | 'choice' | 'score';
export interface Question {
	type: QType;
	name: string;
	instructions: string;
	/** Options of a choice, levels of a score from lowest to highest (`v` value, `d` description). */
	items: { v: string; d: string }[];
}
export const QUESTIONS = RAW as Question[];
export const BY_NAME: Record<string, Question> = Object.fromEntries(
	QUESTIONS.map((q) => [q.name, q])
);

/** FNV-1a: short, stable, the same in the browser and on the server. */
function hash(s: string) {
	let h = 0x811c9dc5;
	for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
	return (h >>> 0).toString(16).padStart(8, '0');
}
/** Changes with the question set: mail of the triage window is asked again. */
export const VERSION = hash(JSON.stringify(QUESTIONS));

/** Thresholds (to be calibrated with labels: `scripts/triage-eval.ts`). */
export const T = {
	/** Stop after the first round. */
	stopPhishing: 0.5,
	stopSpam: 0.5,
	stopBulk: 0.5,
	/** Ask the questions that depend on a branch (Transaction type, One-time code). */
	branch: 0.4,
	action: 0.5,
	calendar: 0.5,
	/** Warning in the reader. */
	warnPhishing: 0.3,
	/** "Other" instead of "Needs you". */
	otherPhishing: 0.5,
	otherSpam: 0.8,
	otherBulk: 0.5,
	/** Expected relevance level below this (Irrelevant 0 … Highly relevant 4) and no action: Other. */
	otherRelevance: 1.5,
	code: 0.5,
	followUp: 0.5
};

// ---------------------------------------------------------------- requests

export interface Vars {
	weekday: string;
	today: string;
	received: string;
}
export type ApiQuestion =
	| { type: 'predicate'; name: string; instructions: string }
	| {
			type: 'choice';
			name: string;
			instructions: string;
			choices: { value: string; description?: string }[];
	  }
	| {
			type: 'score';
			name: string;
			instructions: string;
			levels: { label: string; description?: string }[];
	  };

const fill = (s: string, v: Vars) =>
	s.replace(/\{\{(\w+)\}\}/g, (all, k: string) => (k in v ? v[k as keyof Vars] : all));

/** The questions as `/v1/decisions` takes them. `shuffle` reorders a choice's options (eval). */
export function toRequest(
	qs: Question[],
	vars: Vars,
	shuffle?: <X>(items: X[]) => X[]
): ApiQuestion[] {
	return qs.map((q): ApiQuestion => {
		const base = { name: q.name, instructions: fill(q.instructions, vars) };
		const described = (d: string) => (d ? { description: d } : {});
		if (q.type === 'predicate') return { type: 'predicate', ...base };
		if (q.type === 'score')
			return {
				type: 'score',
				...base,
				levels: q.items.map(({ v, d }) => ({ label: v, ...described(d) }))
			};
		const choices = q.items.map(({ v, d }) => ({ value: v, ...described(d) }));
		return { type: 'choice', ...base, choices: shuffle ? shuffle(choices) : choices };
	});
}

// ---------------------------------------------------------------- answers

/** Compact answer: P(true) of a predicate, P per option of a choice, P per level (index) of a score. */
export type Answer = number | Record<string, number> | number[];
export type Answers = Record<string, Answer>;

type ApiAnswer = {
	type?: string;
	name?: string | null;
	probability?: number;
	probabilities?: { value: string | number; label?: string; probability: number }[];
};

const round = (p: unknown) =>
	Math.round(Math.min(1, Math.max(0, Number(p) || 0)) * 10_000) / 10_000;

function normalise(x: ApiAnswer, q: Question): Answer {
	if (q.type === 'predicate') return round(x.probability);
	const ps = x.probabilities ?? [];
	if (q.type === 'score')
		return q.items.map((it, i) =>
			round(ps.find((p) => p.value === i || p.label === it.v || p.value === it.v)?.probability)
		);
	return Object.fromEntries(
		q.items.map((it) => [it.v, round(ps.find((p) => p.value === it.v)?.probability)])
	);
}

/** Answers of a `/v1/decisions` response, by question name (by position if a name is missing). */
export function readResponse(res: unknown, asked: Question[]): Answers {
	const r = res as { answers?: ApiAnswer[]; error?: unknown } | null;
	if (!r || !Array.isArray(r.answers)) throw new Error(errorText(r?.error) || 'No answers');
	const out: Answers = {};
	r.answers.forEach((x, i) => {
		const q = (x.name && asked.find((a) => a.name === x.name)) || asked[i];
		if (q) out[q.name] = normalise(x, q);
	});
	return out;
}
const errorText = (e: unknown) =>
	typeof e === 'string' ? e : (e as { message?: string } | undefined)?.message;

/** P(true) of a predicate; null if it wasn't asked. */
export const yes = (a: Answers, name: string): number | null =>
	typeof a[name] === 'number' ? (a[name] as number) : null;

/** Probabilities by option (a score's by level name). */
export function probs(a: Answers, name: string): Record<string, number> | null {
	const x = a[name];
	if (x == null || typeof x === 'number') return null;
	if (Array.isArray(x))
		return Object.fromEntries((BY_NAME[name]?.items ?? []).map((it, i) => [it.v, x[i] ?? 0]));
	return x;
}

/** P of any of these options (options that lead to the same handling count together). */
export const pOf = (a: Answers, name: string, ...values: string[]) => {
	const p = probs(a, name);
	return p ? values.reduce((s, v) => s + (p[v] ?? 0), 0) : 0;
};

/** The most likely option, its probability and the runner-up. */
export function top(a: Answers, name: string) {
	const p = probs(a, name);
	if (!p) return null;
	const [first, second] = Object.entries(p).sort((x, y) => y[1] - x[1]);
	if (!first) return null;
	return {
		value: first[0],
		p: first[1],
		second: second && { value: second[0], p: second[1] },
		margin: first[1] - (second?.[1] ?? 0)
	};
}

/** Expected level of a score (Σ index × p); null if it wasn't asked. */
export function expected(a: Answers, name: string): number | null {
	const x = a[name];
	return Array.isArray(x) ? x.reduce((s, p, i) => s + i * p, 0) : null;
}

// ---------------------------------------------------------------- facts (from the headers)

/** What code knows for sure about a mail; computed by the server, told to the model and used to
 *  override its answers. */
export interface Facts {
	/** List-Unsubscribe / List-Id / Precedence: bulk|list. */
	list?: boolean;
	/** Auto-Submitted, or a no-reply address. */
	auto?: boolean;
	/** METHOD of an attached calendar part. */
	invite?: string;
	/** Authentication-Results: spf/dkim/dmarc → pass, fail, softfail, none … */
	auth?: Record<string, string>;
	/** The sender writes from the domain of our own account (not a freemail one). */
	ownDomain?: boolean;
	/** We wrote to this address before. */
	known?: boolean;
	/** Where we are among the recipients. */
	role?: 'to' | 'cc' | 'none';
	recipients?: number;
	/** Links whose text names another site than they lead to: "paypal.com → evil.example". */
	mismatch?: string[];
	/** Messages in the conversation, and whether the one before was ours. */
	thread?: { count: number; lastOurs: boolean };
}

const FAILED = /^(fail|softfail|permerror)$/i;
export const authFailed = (f: Facts) => Object.values(f.auth ?? {}).some((v) => FAILED.test(v));

/** The facts as lines for the model (and for the phishing box in the reader). */
export function factLines(f: Facts): string[] {
	const out: string[] = [];
	if (f.list) out.push('mailing-list headers (List-Unsubscribe / List-Id / Precedence)');
	if (f.auto) out.push('automated sender (Auto-Submitted header or a no-reply address)');
	if (f.invite) out.push(`calendar invitation attached (METHOD:${f.invite})`);
	const auth = Object.entries(f.auth ?? {});
	if (auth.length)
		out.push(`authentication: ${auth.map(([k, v]) => `${k.toUpperCase()} ${v}`).join(', ')}`);
	if (f.ownDomain) out.push('sender domain = your own domain');
	if (f.known != null)
		out.push(f.known ? 'known contact (you wrote to them before)' : 'not a known contact');
	if (f.role === 'cc') out.push('you are in CC');
	if (f.role === 'none') out.push('you are not in To or CC (BCC or a list)');
	for (const m of f.mismatch ?? [])
		out.push(`a link's text shows ${m.replace(' → ', ' but it leads to ')}`);
	return out;
}

// ---------------------------------------------------------------- what to ask

const STAGE1 = ['Phishing', 'Spam', 'Category', 'Sender', 'Recipient role', 'Relevance'];
const STAGE2 = ['Action needed?', 'Attention', 'Importance', 'Follow-up', 'Calendar'];
const ACTION = ['Primary action', 'Urgency driver', 'Reply effort'];
const asked = (a: Answers, names: string[]) => names.every((n) => n in a);

/** Phishing, spam and bulk mail get only the first round (notes: "skipping saves real compute"). */
const stops = (a: Answers) =>
	(yes(a, 'Phishing') ?? 0) >= T.stopPhishing ||
	(yes(a, 'Spam') ?? 0) >= T.stopSpam ||
	pOf(a, 'Category', 'Newsletter/News', 'Advertisement') >= T.stopBulk;

/** Every question that should be asked, given what is known so far. */
function wanted(a: Answers, f: Facts): string[] {
	const w = STAGE1.filter((n) => BY_NAME[n]);
	if (!asked(a, w) || stops(a)) return w;
	w.push(...STAGE2);
	if (pOf(a, 'Category', 'Transactions/Orders') >= T.branch) w.push('Transaction type');
	if (pOf(a, 'Category', 'Notification/Account') >= T.branch) w.push('One-time code');
	if (!asked(a, STAGE2)) return w.filter((n) => BY_NAME[n]);
	if ((yes(a, 'Action needed?') ?? 0) >= T.action) w.push(...ACTION);
	if ((yes(a, 'Calendar') ?? 0) >= T.calendar || f.invite) w.push('Event type');
	return w.filter((n) => BY_NAME[n]);
}

/** The questions of the next round; empty when done. */
export const nextQuestions = (a: Answers, f: Facts) => wanted(a, f).filter((n) => !(n in a));

// ---------------------------------------------------------------- running it

export interface Item {
	msgid: string;
	/** The state as JSON text (`/v1/decisions` takes a string). */
	state: string;
	vars: Vars;
	facts: Facts;
}
export type Call = (body: { input: string; questions: ApiQuestion[] }) => Promise<unknown>;

/** Ask the model about one mail, round by round. `all`: every question at once (eval). */
export async function decide(
	item: Pick<Item, 'state' | 'vars' | 'facts'>,
	call: Call,
	o: { all?: boolean; shuffle?: <X>(items: X[]) => X[] } = {}
): Promise<Answers> {
	const a: Answers = {};
	for (let round = 0; round < 4; round++) {
		const names = o.all ? QUESTIONS.map((q) => q.name) : nextQuestions(a, item.facts);
		if (!names.length) break;
		const qs = names.map((n) => BY_NAME[n]);
		const res = await call({ input: item.state, questions: toRequest(qs, item.vars, o.shuffle) });
		Object.assign(a, readResponse(res, qs));
		if (o.all) break;
	}
	return a;
}

export const DEFAULT_URL = 'http://127.0.0.1:1234/v1/decisions';
export const DEFAULT_MODEL = 'fastino_glide-9b';

/** A `Call` against a local server; errors carry the server's message. */
export function localModel(o: {
	url: string;
	model: string;
	key?: string;
	timeout?: number;
}): Call {
	return async (body) => {
		const res = await fetch(o.url, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				...(o.key && { authorization: `Bearer ${o.key}` })
			},
			body: JSON.stringify({ model: o.model, ...body }),
			signal: AbortSignal.timeout(o.timeout ?? 120_000)
		});
		const json = await res.json().catch(() => null);
		if (!res.ok) throw new Error(errorText(json?.error) || `${res.status} ${res.statusText}`);
		return json;
	};
}

// ---------------------------------------------------------------- reading the answers

/** The model's answers with what code knows for sure laid over them (notes, section 2). */
export function effective(a: Answers, f: Facts): Answers {
	const out = { ...a };
	const one = (name: string, value: string) =>
		BY_NAME[name] &&
		(out[name] = Object.fromEntries(BY_NAME[name].items.map((i) => [i.v, i.v === value ? 1 : 0])));
	if (f.list) one('Recipient role', 'Mass mailing');
	if (f.auto) one('Sender', 'Automated system');
	if (f.invite) out.Calendar = 1;
	if (f.invite === 'CANCEL') one('Event type', 'Cancellation');
	return out;
}

/** Short labels of the main thing to do. */
const ACTIONS: Record<string, string> = {
	Reply: 'Reply',
	Review: 'Review',
	'Decide/Approve': 'Decide',
	'Complete a task': 'Task',
	'Make a payment': 'Pay',
	'Attend/RSVP': 'RSVP',
	'Forward/Share': 'Forward',
	'Verify/Log in': 'Verify'
};

const endOfDay = (d: Date) => {
	const x = new Date(d);
	x.setHours(23, 59, 0, 0);
	return x;
};
/** The end of the n-th business day (Mon–Fri) after `d`. */
function businessDays(d: Date, n: number) {
	const x = new Date(d);
	while (n > 0) {
		x.setDate(x.getDate() + 1);
		if (x.getDay() !== 0 && x.getDay() !== 6) n--;
	}
	return endOfDay(x);
}

/** When it has to be dealt with, from "Attention" (asked relative to the time of triage). */
export function dueOf(a: Answers, at: Date): { due: Date | null; late: boolean } {
	const v = top(a, 'Attention')?.value;
	switch (v) {
		case 'Immediately':
			return { due: new Date(at.getTime() + 3_600_000), late: false };
		case 'By the end of today':
			return { due: endOfDay(at), late: false };
		case 'By the next business day':
			return { due: businessDays(at, 1), late: false };
		case 'Within 2-3 business days':
			return { due: businessDays(at, 3), late: false };
		case 'Within a week':
			return { due: endOfDay(new Date(at.getTime() + 7 * 86_400_000)), late: false };
		case 'Already too late':
			return { due: null, late: true };
		default:
			return { due: null, late: false };
	}
}

export interface Summary {
	bucket: 'needs' | 'other';
	due: string | null;
	late: boolean;
	/** Expected importance level (0 Negligible … 4 Critical). */
	importance: number;
	/** Short label of what to do ("Reply", "Pay"), if anything. */
	action: string | null;
	phishing: number;
	spam: number;
	code: boolean;
	followUp: boolean;
}

/** What the list, the reader and the inbox split make of the answers. */
export function summary(raw: Answers, f: Facts, at: string): Summary {
	const a = effective(raw, f);
	const phishing = yes(a, 'Phishing') ?? 0;
	const spam = yes(a, 'Spam') ?? 0;
	const act = yes(a, 'Action needed?') ?? 0;
	const bulk = pOf(a, 'Category', 'Newsletter/News', 'Advertisement', 'Notification/Account');
	const relevance = expected(a, 'Relevance');
	const other =
		spam >= T.otherSpam ||
		phishing >= T.otherPhishing ||
		(act < T.action &&
			(bulk >= T.otherBulk || (relevance != null && relevance < T.otherRelevance)));
	const primary = act >= T.action ? top(a, 'Primary action')?.value : undefined;
	const { due, late } =
		act >= T.action || !other ? dueOf(a, new Date(at)) : { due: null, late: false };
	return {
		bucket: other ? 'other' : 'needs',
		due: due?.toISOString() ?? null,
		late,
		importance: Math.round((expected(a, 'Importance') ?? 0) * 100) / 100,
		action: (primary && ACTIONS[primary]) || null,
		phishing,
		spam,
		code: (yes(a, 'One-time code') ?? 0) >= T.code,
		followUp: (yes(a, 'Follow-up') ?? 0) >= T.followUp
	};
}

/** "now", "today", "tomorrow", "Mon", "3 Dec"; "overdue" once it has passed. */
export function dueLabel(due: string, now = new Date()) {
	const d = new Date(due);
	if (d < now) return 'overdue';
	if (d.getTime() - now.getTime() <= 3_600_000) return 'now';
	const days = Math.round((endOfDay(d).getTime() - endOfDay(now).getTime()) / 86_400_000);
	if (days === 0) return 'today';
	if (days === 1) return 'tomorrow';
	if (days < 7) return d.toLocaleDateString('en-GB', { weekday: 'short' });
	return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}
