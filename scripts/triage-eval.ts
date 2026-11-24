// How good is the triage model? Scores it on the answers corrected by hand in the mail reader
// (labels, table `triage_labels` in planner.db, each with the exact state the model was given):
// accuracy per question with a 95% Wilson interval, a calibration table (top probability vs. how
// often it was right) and what gets confused with what.
//
//   bun scripts/triage-eval.ts            ask the model again, every question (needs LM Studio)
//   bun scripts/triage-eval.ts --stored   score the answers stored with the labels instead
//   bun scripts/triage-eval.ts --shuffle  also ask with the options in another order and list
//                                         answers that change (weak descriptions; notes, 4.5)
// Env: DATA_DIR (default data), TRIAGE_URL (default LM Studio on 127.0.0.1:1234), TRIAGE_MODEL.
import { Database } from 'bun:sqlite';
import { join } from 'node:path';
import {
	BY_NAME,
	DEFAULT_MODEL,
	DEFAULT_URL,
	QUESTIONS,
	decide,
	localModel,
	top,
	yes,
	type Answers,
	type Facts,
	type Vars
} from '../src/modules/mail/triage/triage.ts';

const args = new Set(process.argv.slice(2));
const file = process.env.DB_PATH ?? join(process.env.DATA_DIR ?? 'data', 'planner.db');
const db = new Database(file, { readonly: true });
type Row = { msgid: string; state: string; facts: string; answers: string; labels: string };
const rows = db
	.query<Row, []>('SELECT msgid, state, facts, answers, labels FROM triage_labels')
	.all();
if (!rows.length) {
	console.log(`No corrected answers in ${file} yet: correct some in the mail reader (Details).`);
	process.exit(0);
}
const call = localModel({
	url: process.env.TRIAGE_URL ?? DEFAULT_URL,
	model: process.env.TRIAGE_MODEL ?? DEFAULT_MODEL
});

/** The placeholders of the instructions, from the state ("now" and when it was received). */
function varsOf(state: string): Vars {
	const s = JSON.parse(state) as { now?: string; email?: { received?: string } };
	const day = /\d{4}-\d{2}-\d{2}/.exec(s.now ?? '')?.[0] ?? new Date().toISOString().slice(0, 10);
	return {
		weekday: new Date(`${day}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'long' }),
		today: day,
		received: s.email?.received ?? ''
	};
}
/** The model's answer to one question, and how sure it was. */
function predicted(a: Answers, name: string): { value: string; p: number } | null {
	if (BY_NAME[name].type === 'predicate') {
		const p = yes(a, name);
		return p == null ? null : { value: String(p >= 0.5), p: Math.max(p, 1 - p) };
	}
	const t = top(a, name);
	return t && { value: t.value, p: t.p };
}
function shuffle<X>(items: X[]): X[] {
	const a = [...items];
	for (let i = a.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[a[i], a[j]] = [a[j], a[i]];
	}
	return a;
}
function wilson(k: number, n: number, z = 1.96) {
	if (!n) return [0, 0];
	const p = k / n;
	const d = 1 + (z * z) / n;
	const c = (p + (z * z) / (2 * n)) / d;
	const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
	return [Math.max(0, c - h), Math.min(1, c + h)];
}
const pct = (x: number) => `${(x * 100).toFixed(0)}%`.padStart(4);

type Score = { n: number; ok: number; notAsked: number; confusions: Map<string, number> };
const scores = new Map<string, Score>(
	QUESTIONS.map((q) => [q.name, { n: 0, ok: 0, notAsked: 0, confusions: new Map() }])
);
const bins = Array.from({ length: 10 }, () => ({ n: 0, ok: 0, conf: 0 }));
const changed = new Map<string, string[]>();

let i = 0;
for (const r of rows) {
	i++;
	const facts = JSON.parse(r.facts) as Facts;
	const labels = JSON.parse(r.labels) as Record<string, string | boolean>;
	const item = { state: r.state, vars: varsOf(r.state), facts };
	process.stderr.write(`\r${i}/${rows.length}`);
	const a = args.has('--stored')
		? (JSON.parse(r.answers) as Answers)
		: await decide(item, call, { all: true });
	for (const [name, label] of Object.entries(labels)) {
		const sc = scores.get(name);
		if (!sc) continue;
		const got = predicted(a, name);
		if (!got) {
			sc.notAsked++;
			continue;
		}
		const right = got.value === String(label);
		sc.n++;
		if (right) sc.ok++;
		else {
			const k = `${label} → ${got.value}`;
			sc.confusions.set(k, (sc.confusions.get(k) ?? 0) + 1);
		}
		const b = bins[Math.min(9, Math.floor(got.p * 10))];
		b.n++;
		b.conf += got.p;
		if (right) b.ok++;
	}
	if (args.has('--shuffle')) {
		const b = await decide(item, call, { all: true, shuffle });
		for (const q of QUESTIONS) {
			if (q.type !== 'choice') continue;
			const x = predicted(a, q.name)?.value;
			const y = predicted(b, q.name)?.value;
			if (x && y && x !== y) changed.set(q.name, [...(changed.get(q.name) ?? []), `${x} → ${y}`]);
		}
	}
}
process.stderr.write('\r');

console.log(
	`\n${rows.length} mails with corrected answers (${args.has('--stored') ? 'stored answers' : 'asked again'})\n`
);
console.log('Question              n   right   95% interval   not asked');
for (const [name, s] of scores) {
	if (!s.n && !s.notAsked) continue;
	const [lo, hi] = wilson(s.ok, s.n);
	console.log(
		`${name.padEnd(20)} ${String(s.n).padStart(3)}   ${s.n ? pct(s.ok / s.n) : '   -'}   ${s.n ? `${pct(lo)} – ${pct(hi)}` : '            '}   ${s.notAsked || ''}`
	);
}
console.log('\nCalibration (all labelled answers): top probability → how often right');
for (const [k, b] of bins.entries()) {
	if (!b.n) continue;
	console.log(
		`  ${(k / 10).toFixed(1)}–${((k + 1) / 10).toFixed(1)}   n=${String(b.n).padStart(3)}   mean p ${pct(b.conf / b.n)}   right ${pct(b.ok / b.n)}`
	);
}
const conf = [...scores].filter(([, s]) => s.confusions.size);
if (conf.length) {
	console.log('\nConfusions (label → model)');
	for (const [name, s] of conf)
		console.log(
			`  ${name}: ${[...s.confusions]
				.sort((a, b) => b[1] - a[1])
				.map(([k, n]) => `${k} (${n})`)
				.join(', ')}`
		);
}
if (args.has('--shuffle')) {
	console.log('\nAnswers that change with the option order');
	if (!changed.size) console.log('  none');
	for (const [name, list] of changed)
		console.log(`  ${name}: ${list.length} of ${rows.length} (${list.slice(0, 5).join(', ')})`);
}
