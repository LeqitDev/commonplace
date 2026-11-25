// The triage on synthetic mails (`tests/fixtures/triage-mails.ts`), for rounds of changes to the
// facts, the wording and the thresholds: which tab each mail lands in, P(phishing) and whether the
// reader would warn, the code and the DHL numbers found; with `--summary <model>` also the one-line
// summaries of the small model and how long they took.
//
//   bun scripts/triage-fixtures.ts [--summary qwen3-4b-instruct-2507] [--only id,id]
// Env: TRIAGE_URL (default LM Studio on 127.0.0.1:1234), TRIAGE_MODEL.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import nodemailer from 'nodemailer';
import PostalMime from 'postal-mime';
import { ABOUT, FIXTURES, ME } from '../tests/fixtures/triage-mails.ts';

// the server code opens DATA_DIR: never the real one
process.env.DATA_DIR = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'triage-fixtures-'));
const t = await import('../src/modules/mail/triage/triage.ts');
const tri = await import('../src/modules/mail/server/triage.ts');

const argv = process.argv.slice(2);
const opt = (k: string) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : undefined);
const only = opt('--only')?.split(',');
const summaryModel = opt('--summary');
const url = process.env.TRIAGE_URL ?? t.DEFAULT_URL;
const call = t.localModel({ url, model: process.env.TRIAGE_MODEL ?? t.DEFAULT_MODEL });
const now = new Date();
const tr = nodemailer.createTransport({ streamTransport: true, buffer: true });

const pct = (x: number) => `${Math.round(x * 100)}%`.padStart(4);
type Row = { id: string; tab: string; want: string; p: number; warn: boolean; phish: boolean };
const rows: Row[] = [];
let codeOk = 0,
	codeN = 0,
	parcelOk = 0,
	parcelN = 0;

for (const fx of FIXTURES.filter((f) => !only || only.includes(f.id))) {
	const date = new Date(now.getTime() - 2 * 3_600_000);
	const info = await tr.sendMail({ to: ME, date, ...fx.mail });
	const p = await PostalMime.parse(info.message as Buffer);
	const from = p.from ?? { name: '', address: '' };
	const prep = tri.prepare(
		p,
		{
			msgid: p.messageId ?? fx.id,
			date: date.toISOString(),
			from_name: from.name ?? '',
			from_addr: from.address ?? '',
			subject: fx.mail.subject
		},
		{
			now,
			account: { name: 'Uni', address: ME },
			me: new Set([ME]),
			about: ABOUT,
			history: fx.history
		}
	);
	const t0 = performance.now();
	const a = await t.decide(prep.item, call);
	const ms = performance.now() - t0;
	const s = t.summary(a, prep.item.facts, now.toISOString());
	const tab = s.tab;
	const p1 = s.phishing;
	const warn = s.warn;
	rows.push({ id: fx.id, tab, want: fx.expect.tab, p: p1, warn, phish: fx.expect.phishing });
	const code = s.code ? prep.code : null;
	if (fx.expect.code !== undefined || code) {
		codeN++;
		if (code === (fx.expect.code ?? null)) codeOk++;
	}
	if (fx.expect.parcels || prep.parcels.length) {
		parcelN++;
		if (JSON.stringify(prep.parcels) === JSON.stringify(fx.expect.parcels ?? [])) parcelOk++;
	}
	const flags = [
		tab === fx.expect.tab ? '' : `TAB ${tab}≠${fx.expect.tab}`,
		warn === fx.expect.phishing ? '' : warn ? 'FALSE ALARM' : 'MISSED',
		code ? `code ${code}` : '',
		prep.parcels.length ? `dhl ${prep.parcels.join(',')}` : ''
	].filter(Boolean);
	const sig = t.signals(prep.item.facts);
	console.log(
		`${fx.id.padEnd(24)} ${tab.padEnd(8)} phish ${pct(p1)} ${warn ? 'warn' : '    '}  ${(ms / 1000).toFixed(1)}s  ${flags.join('  ')}${sig.length ? `  [${sig.join('; ')}]` : ''}`
	);
	if (summaryModel && (tab === 'personal' || tab === 'orders')) {
		const t1 = performance.now();
		const line = await t.summarise(prep.item, { url, model: summaryModel });
		console.log(`    → ${line}  (${((performance.now() - t1) / 1000).toFixed(1)}s)`);
	}
}

const legit = rows.filter((r) => !r.phish);
const bad = rows.filter((r) => r.phish);
console.log(
	`\ntabs right ${rows.filter((r) => r.tab === r.want).length}/${rows.length} · false alarms ${legit.filter((r) => r.warn).length}/${legit.length} · phishing warned ${bad.filter((r) => r.warn).length}/${bad.length} · codes ${codeOk}/${codeN} · DHL ${parcelOk}/${parcelN}`
);
console.log(
	`mean P(phishing): legitimate ${pct(legit.reduce((s, r) => s + r.p, 0) / (legit.length || 1))}, phishing ${pct(bad.reduce((s, r) => s + r.p, 0) / (bad.length || 1))}`
);
