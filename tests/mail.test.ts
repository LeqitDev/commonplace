// Mail: parsing, thread ids, cache views, secrets. MAIL_TEST_IMAP=<host>:<port> (implicit TLS, e.g. a
// scratch Dovecot, see CLAUDE.md) with MAIL_TEST_USER/MAIL_TEST_PASS also runs the sync against it.
import { beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import nodemailer from 'nodemailer';
import type { FetchMessageObject } from 'imapflow';

process.env.DATA_DIR ??= mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'planner-test-'));

let db: typeof import('../src/lib/server/db.ts');
let store: typeof import('../src/modules/mail/server/mailstore.ts');
let mail: typeof import('../src/modules/mail/server/mail.ts');
let shared: typeof import('../src/modules/mail/mail.ts');

beforeAll(async () => {
	db = await import('../src/lib/server/db.ts');
	store = await import('../src/modules/mail/server/mailstore.ts');
	mail = await import('../src/modules/mail/server/mail.ts');
	shared = await import('../src/modules/mail/mail.ts');
});

/** A raw message built by nodemailer. */
async function build(o: Record<string, unknown>) {
	const t = nodemailer.createTransport({ streamTransport: true, buffer: true });
	const info = await t.sendMail({ from: 'Anna <anna@example.org>', to: 'me@example.org', ...o });
	return info.message as Buffer;
}

describe('shared helpers', () => {
	test('baseSubject drops reply and forward prefixes', () => {
		expect(shared.baseSubject('Re: AW: Fwd: Chapter 2')).toBe('Chapter 2');
		expect(shared.baseSubject('RE[2]: WG: x')).toBe('x');
		expect(shared.baseSubject('Rest of it')).toBe('Rest of it');
	});
	test('presets fill in the servers, own fields win', () => {
		expect(shared.servers({ type: 'gmail' }).imap).toEqual({ host: 'imap.gmail.com', port: 993 });
		expect(shared.servers({ type: 'imap', imap: { host: 'mail.x.org' } }).imap).toEqual({
			host: 'mail.x.org',
			port: 993
		});
		expect(shared.servers({ type: 'imap' }).imap).toBeUndefined();
	});
	test('marker letter', () => {
		expect(shared.markerLetter({ name: 'Work', address: '' })).toBe('W');
		expect(shared.markerLetter({ name: 'Work', letter: 'x', address: '' })).toBe('x');
	});
});

describe('parsing', () => {
	test('simple HTML reads as text', () => {
		const html = `<html><body><meta http-equiv="content-type" content="text/html; charset=us-ascii">
Hi,<br><br>you are invited next Monday, 2026-11-09 at 14:30 in<br>the seminar room:<br><br><br>----------<br><br>Title: "Developing an Available<br><span class="Apple-converted-space">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span> Mechanism for TEEs"<br>Advisor: Erika<br><br>Cheers,<br>Erika<br><br>

<br><br><div>
<meta charset="UTF-8"><div dir="auto" style="color: rgb(0, 0, 0); text-decoration: none;"><div>--</div><div>Erika Mustermann, M.Sc.&nbsp;<br>Example University, Germany&nbsp;<br>web:&nbsp;https://www.example.edu/team/erika-mustermann</div></div>
</div>
<br></body></html>`;
		expect(mail.isSimpleHtml(html)).toBe(true);
		expect(mail.htmlText(html).replace(/ /g, ' ')).toBe(
			[
				'Hi,',
				'',
				'you are invited next Monday, 2026-11-09 at 14:30 in',
				'the seminar room:',
				'',
				'',
				'----------',
				'',
				'Title: "Developing an Available',
				'        Mechanism for TEEs"',
				'Advisor: Erika',
				'',
				'Cheers,',
				'Erika',
				'',
				'',
				'--',
				'Erika Mustermann, M.Sc.',
				'Example University, Germany',
				'web: https://www.example.edu/team/erika-mustermann'
			].join('\n')
		);
		expect(
			mail.htmlText(
				'<style>p{color:red}</style><p>See <a href="https://x.org/a">this</a>, <a href="https://y.org">https://y.org</a></p><ul><li>one</li></ul><blockquote>quoted</blockquote>'
			)
		).toBe('See this [https://x.org/a], https://y.org\n\n- one\n\n> quoted');
		expect(mail.isSimpleHtml('<div style="background: url(https://x.org/a.png)">x</div>')).toBe(
			false
		);
	});
	test('HTML as markdown: formatting survives, the text itself is escaped', () => {
		const md = (h: string) => mail.htmlText(h, true);
		expect(
			md(
				'<p>See <a href="https://x.org/a">this</a>, <a href="https://y.org">https://y.org</a>, <a href="mailto:a@b.c">a@b.c</a> and <b>bold </b>text, <i>it</i>, <strong>a <em>b</em></strong>.</p>'
			)
		).toBe('See [this](https://x.org/a), https://y.org, a@b.c and **bold** text, _it_, **a _b_**.');
		// what the mail says literally is no markup
		expect(md('<h1>Title</h1><h2>Sub</h2><p>snake_case _x_ *y* [1] a](b</p><p># lit</p>')).toBe(
			'# Title\n\n## Sub\n\nsnake_case \\_x\\_ \\*y\\* [1] a\\](b\n\n\\# lit'
		);
		expect(
			md(
				'<ul><li>one<ul><li>in <b>ner</b></li></ul></li><li>two</li></ul><ol><li>first</li><li>second<br>line</li></ol>'
			)
		).toBe('- one\n  - in **ner**\n- two\n\n 1. first\n 2. second\n    line');
		// bold over several lines and blocks is bold per line, after the line's marker
		expect(md('<b>one<br>two</b><blockquote><b>quoted</b> text</blockquote>')).toBe(
			'**one**\n**two**\n\n> **quoted** text'
		);
		expect(
			md(
				'<table><tr><th>A</th><th>B</th></tr><tr><td><a href="https://x.org/r">R</a></td><td>a|b <b>c</b></td></tr></table>' +
					'<a href="https://x.org/(p)"><img src="x.png"></a> <a href="#top">top</a> <a href="https://x.org">[PDF] x</a>'
			)
		).toBe(
			'| A | B |\n| --- | --- |\n| [R](https://x.org/r) | a\\|b **c** |\n\nhttps://x.org/%28p%29 top [\\[PDF\\] x](https://x.org)'
		);
	});
	test('the reader: runs of one style, blocks', () => {
		const { mailInline, mailBlocks, mailPlain } = shared;
		// a plain mail has no markup
		expect(mailInline('_x_ and **y** [a](https://x.org)')).toEqual([
			{ s: '_x_ and **y** [a](https://x.org)' }
		]);
		expect(
			mailInline('a \\_x\\_ **b _c_** _d_ snake_case [t **u**](https://x.org/a) 2 * 3', true)
		).toEqual([
			{ s: 'a _x_ ' },
			{ s: 'b ', bold: true },
			{ s: 'c', bold: true, em: true },
			{ s: ' ' },
			{ s: 'd', em: true },
			{ s: ' snake_case ' },
			{ s: 't ', href: 'https://x.org/a' },
			{ s: 'u', bold: true, href: 'https://x.org/a' },
			{ s: ' 2 * 3' }
		]);
		// no scripts as links
		expect(mailInline('[x](javascript:alert)', true)).toEqual([{ s: '[x](javascript:alert)' }]);
		expect(mailPlain({ text: 'On **next Monday** \\_ok\\_', md: true })).toBe(
			'On next Monday _ok_'
		);
		expect(
			mailBlocks(
				'# Title\n\nHi,\n\n- one\n  - inner\n    more\n- two\n\n 1. first\n 2) second\nText\n> a\n> > b\n| A | B |\n| --- | --- |\n| 1 | x\\|y |\n-- \nMe',
				true
			)
		).toEqual([
			{ kind: 'head', level: 1, text: 'Title' },
			{ kind: 'text', quote: false, text: 'Hi,' },
			{
				kind: 'list',
				items: [
					{ depth: 0, marker: '•', text: 'one' },
					{ depth: 1, marker: '•', text: 'inner\nmore' },
					{ depth: 0, marker: '•', text: 'two' }
				]
			},
			{
				kind: 'list',
				items: [
					{ depth: 0, marker: '1.', text: 'first' },
					{ depth: 0, marker: '2.', text: 'second' }
				]
			},
			{ kind: 'text', quote: false, text: 'Text' },
			{ kind: 'text', quote: true, text: 'a\n> b' },
			{
				kind: 'table',
				rows: [
					['A', 'B'],
					['1', 'x|y']
				]
			},
			{ kind: 'text', quote: false, text: '-- \nMe' }
		]);
		// headings are markup too
		expect(mailBlocks('# not a heading')).toEqual([
			{ kind: 'text', quote: false, text: '# not a heading' }
		]);
	});
	test('pictures: pixels and icons do not count, a few others are left out', () => {
		const c = mail.classify;
		expect(c('<p>Hi</p><img src="https://t.x.org/o.gif" width="1" height="1">')).toEqual({
			simple: true,
			pictures: 0,
			cids: []
		});
		expect(c('<p>Hi</p><img src="t.gif" style="display:none">').pictures).toBe(0);
		expect(
			c('<p>Hi</p><img src="a.png" width="16" height="16"><img src="b.png" style="width: 24px">')
		).toEqual({ simple: true, pictures: 0, cids: [] });
		expect(c('<p>Hi <img src="cid:logo@x" width="180" height="60"></p>')).toEqual({
			simple: true,
			pictures: 1,
			cids: ['logo@x']
		});
		// a notification: logo on top, a styled button
		const note =
			'<div style="background-color:#f6f8fa"><img src="https://x.org/logo.png" width="120"><p style="color:#333">Your build failed.</p><a href="https://x.org/b/1" style="background:#2da44e;color:#fff;padding:8px">View build</a></div>';
		expect(c(note)).toEqual({ simple: true, pictures: 1, cids: [] });
		expect(mail.htmlText(note)).toBe('Your build failed.\n\nView build [https://x.org/b/1]');
		expect(c('<p>x</p>' + '<img src="a.png">'.repeat(4)).simple).toBe(false);
		expect(c('<form><input name="q"></form>').simple).toBe(false);
		expect(c('<style>body{background-image:url(a.png)}</style><p>x</p>').simple).toBe(false);
	});
	test('tables: data becomes a markdown table, layout stays in the frame', () => {
		const table =
			'<p>The plan:</p><table><thead><tr><th>Time</th><th>Speaker</th><th>Room</th></tr></thead><tbody>' +
			'<tr><td>14:30</td><td><a href="https://x.org/r">Rasmus</a></td><td>9007</td></tr>' +
			'<tr><td>15:00</td><td>Sami<br>Zouhri</td><td>a|b</td></tr>' +
			'<tr><td colspan="2">Break</td><td></td></tr></tbody></table><p>Bye</p>';
		expect(mail.isSimpleHtml(table)).toBe(true);
		expect(mail.htmlText(table)).toBe(
			[
				'The plan:',
				'',
				'| Time | Speaker | Room |',
				'| --- | --- | --- |',
				'| 14:30 | Rasmus [https://x.org/r] | 9007 |',
				'| 15:00 | Sami Zouhri | a\\|b |',
				'| Break |  |  |',
				'',
				'Bye'
			].join('\n')
		);
		const s = mail.isSimpleHtml;
		expect(s('<table><tr><td>News</td></tr></table>')).toBe(false); // a wrapper
		expect(s('<table><tr><td><table><tr><td>a</td><td>b</td></tr></table></td></tr></table>')).toBe(
			false
		);
		expect(
			s('<table><tr><td><img src="banner.jpg" width="600"></td><td>Text</td></tr></table>')
		).toBe(false);
		expect(s(`<table><tr><td>Menu</td><td>${'long text '.repeat(40)}</td></tr></table>`)).toBe(
			false
		);
		// a layout table still reads as paragraphs (snippets, search, quoting)
		expect(mail.htmlText('<table><tr><td>One</td></tr><tr><td>Two</td></tr></table>')).toBe(
			'One\n\nTwo'
		);
	});
	test('thread id: first References id, else In-Reply-To, else own id', () => {
		const root = store.threadId('<a@x>');
		expect(store.threadId('<c@x>', ['<a@x>', '<b@x>'], '<b@x>')).toBe(root);
		expect(store.threadId('<b@x>', [], '<a@x>')).toBe(root);
		expect(store.threadId('<z@x>')).not.toBe(root);
	});

	test('toRow from a FETCH result', () => {
		const m = {
			uid: 7,
			seq: 1,
			flags: new Set(['\\Seen']),
			internalDate: new Date('2026-11-14T09:12:00Z'),
			envelope: {
				messageId: '<c@x>',
				inReplyTo: '<b@x>',
				subject: 'Re: Chapter 2',
				from: [{ name: 'Anna', address: 'anna@example.org' }],
				to: [{ name: '', address: 'me@example.org' }]
			},
			headers: Buffer.from('References: <a@x>\r\n <b@x>\r\n'),
			bodyStructure: {
				type: 'multipart/mixed',
				childNodes: [
					{
						part: '1',
						type: 'text/plain',
						parameters: { charset: 'utf-8' },
						encoding: 'quoted-printable'
					},
					{ part: '2', type: 'application/pdf', disposition: 'attachment' }
				]
			}
		} as unknown as FetchMessageObject;
		const r = mail.toRow('acc', 'inbox', m);
		expect(r.thread).toBe(store.threadId('<a@x>'));
		expect(r).toMatchObject({ uid: 7, seen: true, flagged: false, attach: true, invite: false });
		expect(r.date).toBe('2026-11-14T09:12:00.000Z');
		expect(JSON.parse(r.tpart!)).toEqual({
			key: '1',
			type: 'text/plain',
			charset: 'utf-8',
			encoding: 'quoted-printable'
		});
	});

	test('a single-part message: text part 1; an invitation is no attachment', () => {
		expect(JSON.parse(mail.textPart({ type: 'text/html', encoding: 'base64' })!).key).toBe('1');
		expect(
			mail.structureFlags({
				type: 'multipart/alternative',
				childNodes: [
					{ type: 'text/plain' },
					{ type: 'text/calendar' },
					{ type: 'application/ics', disposition: 'attachment' }
				]
			})
		).toEqual({ attach: false, invite: true });
	});

	test('snippet skips quotes and the signature', () => {
		expect(mail.snippet('Hi,\n\nsee below.\n> old\n> text\n-- \nAnna')).toBe('Hi, see below.');
	});

	test('snippet from the first bytes of a base64 or quoted-printable part', async () => {
		const b64 = Buffer.from('Grüße aus Köln, und noch viel mehr Text danach'.repeat(5)).toString(
			'base64'
		);
		const cut = Buffer.from(b64.slice(0, 61)); // in the middle of a group of 4
		const s = await mail.partSnippet(
			JSON.stringify({ type: 'text/plain', charset: 'utf-8', encoding: 'base64' }),
			cut
		);
		expect(s.startsWith('Grüße aus Köln')).toBe(true);
		const qp = await mail.partSnippet(
			JSON.stringify({ type: 'text/html', charset: 'iso-8859-1', encoding: 'quoted-printable' }),
			Buffer.from('<p>Gr=FC=DFe</p><p>zur=FC=\r\nck</p>')
		);
		expect(qp).toBe('Grüße zurück');
	});
});

describe('cache', () => {
	const row = (o: Partial<import('../src/modules/mail/server/mailstore.ts').NewMsg>) => ({
		account: 'a1',
		folder: 'inbox' as const,
		uid: 1,
		msgid: '<x@x>',
		thread: 't',
		date: '2026-11-14T09:00:00.000Z',
		from_name: 'Anna',
		from_addr: 'anna@example.org',
		to_json: '[]',
		subject: 'Hello',
		snippet: 'first words',
		seen: false,
		flagged: false,
		attach: false,
		invite: false,
		tpart: null,
		...o
	});

	test('views, counts, dedupe by Message-ID, search', () => {
		store.insert([
			row({
				uid: 1,
				msgid: '<1@x>',
				thread: 'A',
				subject: 'Chapter two',
				snippet: 'Kommentare zum Kapitel'
			}),
			row({
				uid: 2,
				msgid: '<2@x>',
				thread: 'A',
				date: '2026-11-14T10:00:00.000Z',
				seen: true,
				subject: 'Re: Hello',
				flagged: true
			}),
			row({ uid: 3, msgid: '<3@x>', thread: 'B', date: '2026-11-13T10:00:00.000Z', seen: true }),
			// Gmail: the same message in All Mail as well
			row({ folder: 'archive', uid: 11, msgid: '<1@x>', thread: 'A' }),
			row({ folder: 'archive', uid: 12, msgid: '<4@x>', thread: 'C', flagged: true }),
			row({ folder: 'sent', uid: 21, msgid: '<5@x>', thread: 'B', from_name: 'Me' }),
			row({ account: 'other', uid: 1, msgid: '<9@x>', thread: 'D' })
		]);
		const ids = (v: import('../src/modules/mail/mail.ts').MailView, account?: string) =>
			store.threads({ view: v, account }, ['a1']).map((t) => t.thread);
		expect(ids('inbox')).toEqual(['A', 'B']); // D: account not enabled
		expect(ids('archive')).toEqual(['C']); // A is in the inbox too
		expect(ids('sent')).toEqual(['B']);
		expect(ids('flagged')).toEqual(['A', 'C']);
		const a = store.threads({ view: 'inbox' }, ['a1'])[0];
		expect(a).toMatchObject({ count: 2, unread: 1, subject: 'Re: Hello' }); // newest message's fields
		expect(store.threads({ view: 'inbox', before: a.date }, ['a1']).map((t) => t.thread)).toEqual([
			'B'
		]);
		expect(
			store
				.unreadInbox(['a1', 'other'])
				.map((t) => t.thread)
				.sort()
		).toEqual(['A', 'D']);
		expect(store.threadRows('A', ['a1']).map((r) => r.msgid)).toEqual(['<1@x>', '<2@x>']);
		// mail between two of our accounts: the received copy is kept, though our sent copy is older
		store.insert([
			row({
				account: 'e1',
				folder: 'sent',
				uid: 5,
				msgid: '<6@x>',
				thread: 'E',
				date: '2026-11-14T08:00:00.000Z'
			}),
			row({ account: 'e2', uid: 6, msgid: '<6@x>', thread: 'E', date: '2026-11-14T08:00:05.000Z' })
		]);
		expect(store.threadRows('E', ['e1', 'e2']).map((r) => r.account)).toEqual(['e2']);
		const hits = store.searchMail('kapitel', ['a1']);
		expect(hits).toHaveLength(1);
		expect(hits[0]).toMatchObject({ coll: 'mail', id: 'A' });
		expect(hits[0].snippet).toContain('<mark>Kapitel</mark>');
		expect(store.searchMail('kapitel', ['other'])).toHaveLength(0);
	});

	test('flags, removal, dropping a folder', () => {
		expect(store.setFlags('a1', 'inbox', [[1, true, true]])).toBe(1);
		expect(store.setFlags('a1', 'inbox', [[1, true, true]])).toBe(0);
		expect(store.keepOnly('a1', 'inbox', [1, 3])).toBe(1);
		expect(store.count('a1', 'inbox')).toBe(2);
		store.dropFolder('a1', 'inbox');
		expect(store.count('a1', 'inbox')).toBe(0);
		store.dropAccount('a1');
		store.dropAccount('other');
		expect(store.unreadInbox(['a1', 'other'])).toEqual([]);
	});
});

describe('secrets', () => {
	test('passwords of feeds and mail accounts never leave the server', () => {
		const a = db.put('mail_accounts', {
			id: 'sec',
			name: 'X',
			password: 'pw',
			oauth: { refreshToken: 't' }
		});
		db.put('feeds', { id: 'secf', name: 'F', password: 'pw' });
		expect(db.pub('mail_accounts', a)).not.toHaveProperty('password');
		expect(db.pub('mail_accounts', a)).not.toHaveProperty('oauth');
		expect(db.list('mail_accounts').find((d) => d.id === 'sec')).not.toHaveProperty('password');
		expect(db.list('feeds').find((d) => d.id === 'secf')).not.toHaveProperty('password');
		expect(db.get('mail_accounts', 'sec')!.password).toBe('pw'); // the server still has it
		db.remove('mail_accounts', 'sec');
		db.remove('feeds', 'secf');
	});
});

// ---------------------------------------------------------------- against a real IMAP server

const IMAP = process.env.MAIL_TEST_IMAP;
describe.skipIf(!IMAP)('sync against IMAP', () => {
	const [host, port] = (IMAP ?? ':').split(':');
	const user = process.env.MAIL_TEST_USER ?? `test${Date.now()}`;
	const pass = process.env.MAIL_TEST_PASS ?? 'secret';
	process.env.MAIL_TLS_INSECURE = 'true';
	let c: import('imapflow').ImapFlow;
	const id = 'imap-test';

	beforeAll(async () => {
		const { ImapFlow } = await import('imapflow');
		c = new ImapFlow({
			host,
			port: +port,
			secure: true,
			auth: { user, pass },
			logger: false,
			tls: { rejectUnauthorized: false }
		});
		await c.connect();
		db.put('mail_accounts', {
			id,
			name: 'Test',
			address: 'me@example.org',
			type: 'imap',
			imap: { host, port: +port },
			username: user,
			password: pass,
			enabled: true
		});
	});

	const list = (view: import('../src/modules/mail/mail.ts').MailView) =>
		store.threads({ view, account: id }, [id]);

	test('first sync: inbox, sent, archive, bodies of recent mail, snippets of old mail', async () => {
		const first = await build({
			subject: 'Chapter 2',
			text: 'Thanks for the draft.',
			messageId: '<m1@x>'
		});
		const reply = await build({
			from: 'me@example.org',
			to: 'anna@example.org',
			subject: 'Re: Chapter 2',
			text: 'Will do.',
			messageId: '<m2@x>',
			inReplyTo: '<m1@x>',
			references: ['<m1@x>']
		});
		const old = await build({
			subject: 'Old one',
			text: 'Something from last year, long ago.',
			messageId: '<m3@x>',
			attachments: [{ filename: 'a.txt', content: 'hello' }]
		});
		await c.append('INBOX', first, [], new Date(Date.now() - 600_000));
		await c.append('Sent', reply, ['\\Seen']);
		await c.append('Archive', old, ['\\Seen'], new Date('2025-01-10T10:00:00Z'));

		expect(await mail.syncAccount(id)).toBe(true);
		expect(db.get('mail_accounts', id)!.error).toBeUndefined();
		const inbox = list('inbox');
		expect(inbox).toHaveLength(1);
		expect(inbox[0]).toMatchObject({ count: 2, unread: 1, snippet: 'Will do.' });
		expect(list('sent').map((t) => t.thread)).toEqual([inbox[0].thread]);
		const arch = list('archive');
		expect(arch[0]).toMatchObject({
			subject: 'Old one',
			snippet: 'Something from last year, long ago.',
			attach: true
		});
		expect(store.threadRows(arch[0].thread, [id])[0].cached).toBe(0); // old: not downloaded

		const msgs = await mail.readThread(arch[0].thread); // fetched on opening
		expect(msgs[0].text).toContain('Something from last year');
		expect(msgs[0].attachments.map((a) => a.filename)).toEqual(['a.txt']);
		expect(store.threadRows(arch[0].thread, [id])[0].cached).toBe(1);
		const p = await mail.part(msgs[0].id, 0);
		expect(Buffer.from(p!.content as ArrayBuffer).toString()).toBe('hello');
	});

	test('flags, removals and a reset UIDVALIDITY come over with the next sync', async () => {
		await c.mailboxOpen('INBOX');
		await c.messageFlagsAdd('1:*', ['\\Seen', '\\Flagged']);
		expect(await mail.syncAccount(id)).toBe(true);
		expect(list('inbox')[0].unread).toBe(0);
		expect(list('flagged')).toHaveLength(1);
		expect(await mail.syncAccount(id)).toBe(false); // nothing changed

		await c.messageDelete('1:*');
		await mail.syncAccount(id);
		expect(list('inbox')).toHaveLength(0);

		// a mailbox deleted and created again gets a new UIDVALIDITY
		const before = store.folderState(id, 'archive')!.uidvalidity;
		const raw = await build({ subject: 'Again', text: 'x', messageId: '<m4@x>' });
		await c.mailboxClose().catch(() => {});
		await c.mailboxDelete('Archive');
		await c.mailboxCreate('Archive');
		await c.append('Archive', raw);
		await mail.syncAccount(id);
		expect(store.folderState(id, 'archive')!.uidvalidity).not.toBe(before);
		expect(list('archive').map((t) => t.subject)).toEqual(['Again']);
	});

	test('a wrong password sets the error and keeps the cache', async () => {
		const n = store.count(id, 'sent');
		db.patch('mail_accounts', id, { password: 'wrong' });
		expect(await mail.syncAccount(id)).toBe(false);
		const a = db.get('mail_accounts', id)!;
		expect(a.error).toContain('Sign-in refused');
		expect(a.errorSince).toBeTruthy();
		expect(store.count(id, 'sent')).toBe(n);
		db.patch('mail_accounts', id, { password: pass });
		await mail.syncAccount(id);
		expect(db.get('mail_accounts', id)!.error).toBeUndefined();
		mail.unwatch(id);
		await c.logout();
	}, 30_000);
});

// ---------------------------------------------------------------- M2: projects, later, actions

describe('projects and focus', () => {
	const ctx = (o: Partial<import('../src/modules/mail/mail.ts').MailCtx> = {}) => ({
		threads: {},
		accounts: {},
		projects: [
			{ id: 'thesis', group: 'Uni', senders: ['anna@uni.example'] },
			{ id: 'seminar', group: 'Uni', senders: ['@seminar.example'] },
			{ id: 'home', senders: [] },
			{ id: 'old', archived: true, senders: ['old@x.org'] }
		],
		...o
	});
	const t = (senders: string[], account = 'a') => ({ thread: 'T', account, senders });

	test('manual project, then the account, then sender rules', () => {
		expect(shared.threadProject(t(['Anna@Uni.example']), ctx())).toBe('thesis');
		expect(shared.threadProject(t(['x@lists.seminar.example']), ctx())).toBe('seminar');
		expect(shared.threadProject(t(['old@x.org']), ctx())).toBeNull(); // archived projects don't sort
		expect(
			shared.threadProject(
				t(['anna@uni.example']),
				ctx({ accounts: { a: { assign: 'project', projectId: 'home' } } })
			)
		).toBe('home');
		expect(
			shared.threadProject(t(['anna@uni.example']), ctx({ threads: { T: { projectId: 'home' } } }))
		).toBe('home');
	});

	test('visibility with and without a focused project', () => {
		const c = ctx();
		expect(shared.mailVisible(t(['anna@uni.example']), c, null)).toBe(true);
		expect(shared.mailVisible(t(['anna@uni.example']), c, 'thesis')).toBe(true);
		expect(shared.mailVisible(t(['anna@uni.example']), c, 'home')).toBe(false);
		expect(shared.mailVisible(t(['nobody@x.org']), c, 'home')).toBe(false);
		const g = ctx({ accounts: { a: { assign: 'group', group: 'Uni' } } });
		expect(shared.mailVisible(t(['nobody@x.org']), g, 'seminar')).toBe(true); // group account
		expect(shared.mailVisible(t(['nobody@x.org']), g, 'home')).toBe(false);
		expect(
			shared.mailVisible(t(['x@y']), ctx({ accounts: { a: { show: 'always' } } }), 'home')
		).toBe(true);
		expect(
			shared.mailVisible(
				t(['anna@uni.example']),
				ctx({ accounts: { a: { show: 'all' } } }),
				'thesis'
			)
		).toBe(false);
		expect(shared.mailVisible(t(['x']), ctx({ threads: { T: { projectId: 'old' } } }), null)).toBe(
			false
		);
	});

	test('later presets', () => {
		const morning = shared.laterPresets(new Date(2026, 10, 16, 9, 0)); // a Monday
		expect(morning.map((p) => p.label)).toEqual([
			'This afternoon',
			'This evening',
			'Tomorrow morning',
			'Next week'
		]);
		expect(morning.at(-1)!.at).toEqual(new Date(2026, 10, 23, 8, 0)); // a week on, not today
		const night = shared.laterPresets(new Date(2026, 10, 15, 21, 0)); // a Sunday
		expect(night.map((p) => p.label)).toEqual(['Tomorrow morning', 'Next week']);
		expect(night[1].at).toEqual(new Date(2026, 10, 16, 8, 0));
	});
});

describe('later views and actions in the cache', () => {
	const r = (o: Partial<import('../src/modules/mail/server/mailstore.ts').NewMsg>) => ({
		account: 'b1',
		folder: 'inbox' as const,
		uid: 1,
		msgid: '<x@x>',
		thread: 't',
		date: '2026-11-14T09:00:00.000Z',
		from_name: 'Anna',
		from_addr: 'anna@example.org',
		to_json: '[]',
		subject: 'Hello',
		snippet: '',
		seen: false,
		flagged: false,
		attach: false,
		invite: false,
		tpart: null,
		...o
	});

	test('put off threads leave the inbox; those that came back are on top', () => {
		store.insert([
			r({ uid: 1, msgid: '<1@b>', thread: 'P', date: '2026-11-14T08:00:00.000Z' }),
			r({ uid: 2, msgid: '<2@b>', thread: 'Q', date: '2026-11-14T09:00:00.000Z' }),
			r({ uid: 3, msgid: '<3@b>', thread: 'R', date: '2026-11-14T10:00:00.000Z' })
		]);
		const ids = (o: Partial<import('../src/modules/mail/server/mailstore.ts').ThreadQuery>) =>
			store.threads({ view: 'inbox', ...o }, ['b1']).map((t) => t.thread);
		expect(ids({})).toEqual(['R', 'Q', 'P']);
		expect(ids({ off: ['Q'] })).toEqual(['R', 'P']);
		expect(ids({ view: 'later', off: ['Q'] })).toEqual(['Q']);
		const back = { P: '2026-11-15T07:00:00.000Z' };
		expect(ids({ back })).toEqual(['P', 'R', 'Q']);
		const top = store.threads({ view: 'inbox', back }, ['b1'])[0];
		expect(top.sort).toBe(back.P);
		expect(ids({ back, before: top.sort })).toEqual(['R', 'Q']); // paging goes by sort
		expect(
			store
				.unreadInbox(['b1'], ['Q'])
				.map((t) => t.thread)
				.sort()
		).toEqual(['P', 'R']);
	});

	test('read, flag and archive change the cache and queue ops', () => {
		const ops = () => store.pendingOps('b1').map((o) => [o.kind, JSON.parse(o.args)]);
		expect(store.setSeen('R', ['b1'], true)).toBe(1);
		expect(store.setSeen('R', ['b1'], true)).toBe(0);
		expect(store.setFlagged('R', ['b1'], true)).toBe(1);
		expect(ops()).toEqual([
			['flags', { folder: 'inbox', items: [{ msgid: '<3@b>', uid: 3 }], add: ['\\Seen'] }],
			['flags', { folder: 'inbox', items: [{ msgid: '<3@b>', uid: 3 }], add: ['\\Flagged'] }]
		]);
		for (const o of store.pendingOps('b1')) store.opDone(o.id);

		store.setFolderState('b1', 'inbox', {
			path: 'INBOX',
			uidvalidity: '1',
			uidnext: 1,
			modseq: null
		});
		// no archive folder known yet: nothing to do
		expect(store.setArchived('R', ['b1'], true, () => false)).toBe(0);
		store.setFolderState('b1', 'archive', {
			path: 'Archive',
			uidvalidity: '1',
			uidnext: 1,
			modseq: null
		});
		expect(store.setArchived('R', ['b1'], true, () => false)).toBe(1);
		const [row] = store.threadRows('R', ['b1']);
		expect(row.folder).toBe('archive');
		expect(row.uid).toBeLessThan(0); // placeholder until the server tells the new UID
		expect(ops()).toEqual([
			['move', { from: 'inbox', to: 'archive', items: [{ msgid: '<3@b>', uid: 3 }] }]
		]);
		expect(store.threads({ view: 'archive' }, ['b1']).map((t) => t.thread)).toEqual(['R']);
		store.settleUid('b1', 'archive', '<3@b>', 77);
		expect(store.uidOf('b1', 'archive', '<3@b>')).toBe(77);

		// Gmail ("All Mail"): archiving drops the inbox row, unarchiving copies it back
		store.insert([r({ folder: 'archive', uid: 12, msgid: '<2@b>', thread: 'Q' })]);
		expect(store.setArchived('Q', ['b1'], true, () => true)).toBe(1);
		expect(store.threadRows('Q', ['b1']).map((x) => x.folder)).toEqual(['archive']);
		expect(store.setArchived('Q', ['b1'], false, () => true)).toBe(1);
		expect(store.count('b1', 'inbox')).toBe(2);
		expect(store.count('b1', 'archive')).toBe(2);
		store.dropAccount('b1');
		expect(store.pendingOps('b1')).toHaveLength(0);
	});
});

describe.skipIf(!IMAP)('triage against IMAP', () => {
	const [host, port] = (IMAP ?? ':').split(':');
	const user = `triage${Date.now()}`;
	let c: import('imapflow').ImapFlow;
	const id = 'imap-triage';
	const box = async (path: string) => {
		const lock = await c.getMailboxLock(path);
		try {
			await c.noop(); // expunges by other connections are only told on the next NOOP
			const out: { subject: string; flags: string[] }[] = [];
			for await (const m of c.fetch('1:*', { envelope: true, flags: true }))
				out.push({ subject: m.envelope?.subject ?? '', flags: [...(m.flags ?? [])].sort() });
			return out;
		} catch {
			return [];
		} finally {
			lock.release();
		}
	};

	beforeAll(async () => {
		process.env.MAIL_TLS_INSECURE = 'true';
		const { ImapFlow } = await import('imapflow');
		c = new ImapFlow({
			host,
			port: +port,
			secure: true,
			auth: { user, pass: 'secret' },
			logger: false,
			tls: { rejectUnauthorized: false }
		});
		await c.connect();
		await c.append('INBOX', await build({ subject: 'Triage me', text: 'x', messageId: '<t1@x>' }));
		db.put('mail_accounts', {
			id,
			name: 'T',
			address: 'me@example.org',
			type: 'imap',
			imap: { host, port: +port },
			username: user,
			password: 'secret',
			enabled: true
		});
		await mail.syncAccount(id);
	});

	test('read, flag, archive and undo reach the server', async () => {
		const [t] = store.threads({ view: 'inbox', account: id }, [id]);
		expect(mail.act(t.thread, { seen: true, flagged: true })).toBe(true);
		await mail.pushOps(id);
		expect((await box('INBOX'))[0].flags).toEqual(['\\Flagged', '\\Seen']);

		mail.act(t.thread, { archived: true });
		await mail.pushOps(id);
		expect(await box('INBOX')).toHaveLength(0);
		expect((await box('Archive')).map((m) => m.subject)).toEqual(['Triage me']);
		expect(store.threadRows(t.thread, [id])[0].uid).toBeGreaterThan(0); // UID from MOVE's map

		mail.act(t.thread, { archived: false }); // undo
		await mail.pushOps(id);
		expect((await box('INBOX')).map((m) => m.subject)).toEqual(['Triage me']);
		expect(store.pendingOps(id)).toHaveLength(0);
		expect(await mail.syncAccount(id)).toBe(false); // the cache agrees with the server
	});

	test('a message arriving while idling starts a sync and is announced', async () => {
		mail.watch(id);
		await new Promise((r) => setTimeout(r, 2500)); // connected and in IDLE
		const got = new Promise<import('../src/modules/mail/server/mail.ts').MailEvent>((res) => {
			const off = mail.onMail((e) => {
				if (e.account === id && !e.syncing && e.fresh) {
					off();
					res(e);
				}
			});
		});
		await c.append('INBOX', await build({ subject: 'Fresh one', text: 'y', messageId: '<t2@x>' }));
		const e = await got;
		expect(e.fresh!.map((f) => f.subject)).toEqual(['Fresh one']);
		mail.unwatch(id);
		await c.logout();
	}, 20_000);
});

// ---------------------------------------------------------------- M3: writing

describe('writing', () => {
	const msg = (o: Partial<import('../src/lib/types.ts').MailMessage>) =>
		({
			id: 1,
			msgid: '<m1@x>',
			references: ['<m0@x>'],
			account: 'acc',
			folder: 'inbox',
			date: '2026-11-14T09:12:00.000Z',
			fromName: 'Anna Keller',
			fromAddr: 'anna@uni.example',
			to: [{ name: '', address: 'me@example.org' }],
			cc: [{ name: 'Jonas', address: 'jonas@example.org' }],
			subject: 'Re: Chapter 2',
			snippet: '',
			text: 'Thanks.\nSee you.',
			seen: true,
			flagged: false,
			attachments: [],
			...o
		}) as import('../src/lib/types.ts').MailMessage;

	test('reply, reply all, forward, and a reply after our own message', () => {
		const r = shared.replyDraft('reply', [msg({})], { acc: 'me@example.org' });
		expect(r).toMatchObject({
			account: 'acc',
			to: ['Anna Keller <anna@uni.example>'],
			cc: [],
			subject: 'Re: Chapter 2',
			inReplyTo: '<m1@x>',
			references: ['<m0@x>', '<m1@x>']
		});
		expect(r.quote).toContain('wrote:\n> Thanks.\n> See you.');
		const all = shared.replyDraft('all', [msg({})], { acc: 'ME@example.org' });
		expect(all.cc).toEqual(['Jonas <jonas@example.org>']); // not ourselves
		const fwd = shared.replyDraft('forward', [msg({})], { acc: 'me@example.org' });
		expect(fwd).toMatchObject({ to: [], subject: 'Fwd: Chapter 2', forward: 1 });
		expect(fwd.inReplyTo).toBeUndefined();
		expect(fwd.quote).toContain(
			'---------- Forwarded message ----------\nFrom: Anna Keller <anna@uni.example>'
		);
		const own = shared.replyDraft(
			'reply',
			[
				msg({
					fromAddr: 'me@example.org',
					fromName: 'Me',
					to: [{ name: '', address: 'anna@uni.example' }]
				})
			],
			{ acc: 'me@example.org' }
		);
		expect(own.to).toEqual(['anna@uni.example']); // to the recipients of our message
		// from our work account into this one: answered from this one, to the work address
		const cross = shared.replyDraft(
			'reply',
			[msg({ fromAddr: 'me@work.example', fromName: 'Me' })],
			{ acc: 'me@example.org', work: 'me@work.example' }
		);
		expect(cross).toMatchObject({ account: 'acc', to: ['Me <me@work.example>'] });
		expect(shared.addrOf('Anna <Anna@Uni.example>')).toBe('anna@uni.example');
	});

	test('fetchSafe skips the messages a server refuses to FETCH', async () => {
		const bad = new Set([7, 12]);
		const c = {
			fetch: async function* (range: string) {
				const uids = range.includes(':')
					? Array.from({ length: 20 }, (_, i) => i + 1)
					: range.split(',').map(Number);
				if (uids.some((u) => bad.has(u)))
					throw Object.assign(new Error('Some messages could not be FETCHed (Failure)'), {
						responseStatus: 'NO'
					});
				for (const uid of uids) yield { uid } as FetchMessageObject;
			},
			search: async () => Array.from({ length: 20 }, (_, i) => i + 1)
		} as unknown as Parameters<typeof mail.fetchSafe>[0];
		const skipped: number[] = [];
		const got = await mail.fetchSafe(c, '1:20', { uid: true }, (u) => skipped.push(u));
		expect(got.map((m) => m.uid)).toEqual(
			[...Array(20).keys()].map((i) => i + 1).filter((u) => !bad.has(u))
		);
		expect(skipped.sort((a, b) => a - b)).toEqual([7, 12]);
		const broken = {
			...c,
			fetch: async function* () {
				throw new Error('closed');
				yield {} as FetchMessageObject;
			}
		};
		expect(mail.fetchSafe(broken, [1], { uid: true }, () => {})).rejects.toThrow('closed');
	});

	test('compose: markdown → text + HTML, inline pictures, files, threading headers', async () => {
		const { writeFileSync } = await import('node:fs');
		const PostalMime = (await import('postal-mime')).default;
		db.put('files', { id: 'pic1', name: 'chart.png', mime: 'image/png', size: 4 });
		db.put('files', { id: 'doc1', name: 'draft.pdf', mime: 'application/pdf', size: 4 });
		writeFileSync(join(db.FILES_DIR, 'pic1'), 'PNG!');
		writeFileSync(join(db.FILES_DIR, 'doc1'), '%PDF');
		const raw = await mail.compose(
			{
				id: 'd',
				account: 'acc',
				to: ['Anna <anna@uni.example>'],
				subject: 'Re: Chapter 2',
				body: 'Here it is, **revised**.\n\n![chart](/files/pic1)',
				quote: '> old text',
				files: ['doc1'],
				inReplyTo: '<m1@x>',
				references: ['<m0@x>', '<m1@x>']
			},
			{ id: 'acc', name: 'Uni', address: 'me@example.org', type: 'imap', sender: 'Alex M' },
			'<new@example.org>'
		);
		const p = await PostalMime.parse(raw);
		expect(p.from).toEqual({ name: 'Alex M', address: 'me@example.org' });
		expect(p.messageId).toBe('<new@example.org>');
		expect(p.inReplyTo).toBe('<m1@x>');
		expect(p.references).toBe('<m0@x> <m1@x>');
		expect(p.text).toContain('**revised**');
		expect(p.text).toContain('> old text');
		expect(p.html).toContain('<strong>revised</strong>');
		expect(p.html).toContain('src="cid:pic1@planner"');
		expect(p.html).toContain('<blockquote>');
		expect(p.attachments.map((a) => [a.filename, a.contentId ?? null])).toEqual([
			['chart.png', '<pic1@planner>'],
			['draft.pdf', null]
		]);
		db.remove('files', 'pic1');
		db.remove('files', 'doc1');
	});

	test('contacts and answers in the cache', () => {
		store.insert([
			{
				account: 'w1',
				folder: 'inbox',
				uid: 1,
				msgid: '<w1@x>',
				thread: 'W',
				date: '2026-11-14T09:00:00.000Z',
				from_name: 'Anna Keller',
				from_addr: 'Anna@uni.example',
				to_json: '[]',
				subject: 's',
				snippet: '',
				seen: true,
				flagged: false,
				attach: false,
				invite: false,
				tpart: null
			},
			{
				account: 'w1',
				folder: 'sent',
				uid: 2,
				msgid: '<w2@x>',
				thread: 'W',
				date: '2026-11-14T10:00:00.000Z',
				from_name: 'Me',
				from_addr: 'me@example.org',
				to_json: JSON.stringify([{ name: 'Lea Brandt', address: 'lea@example.org' }]),
				subject: 's',
				snippet: '',
				seen: true,
				flagged: false,
				attach: false,
				invite: false,
				tpart: null
			}
		]);
		expect(store.contacts('ann', ['w1'])).toEqual([
			{ name: 'Anna Keller', address: 'anna@uni.example' }
		]);
		expect(store.contacts('brandt', ['w1'])).toEqual([
			{ name: 'Lea Brandt', address: 'lea@example.org' }
		]);
		expect(store.answered('W', '2026-11-14T08:00:00.000Z', ['me@example.org'])).toBe(true);
		expect(store.answered('W', '2026-11-14T09:30:00.000Z', ['me@example.org'])).toBe(false); // only ours since
		expect(store.threads({ view: 'waiting', waiting: ['W'] }, ['w1']).map((t) => t.thread)).toEqual(
			['W']
		);
		store.dropAccount('w1');
	});
});

const SMTP = process.env.MAIL_TEST_SMTP; // Mailpit: <host>:<smtp port>, its API on MAIL_TEST_SMTP_API
describe.skipIf(!IMAP || !SMTP)('sending against IMAP + SMTP', () => {
	const [host, port] = (IMAP ?? ':').split(':');
	const [shost, sport] = (SMTP ?? ':').split(':');
	const apiUrl = process.env.MAIL_TEST_SMTP_API ?? 'http://127.0.0.1:18025';
	const user = `send${Date.now()}`;
	const id = 'imap-send';
	let c: import('imapflow').ImapFlow;

	beforeAll(async () => {
		process.env.MAIL_TLS_INSECURE = 'true';
		const { ImapFlow } = await import('imapflow');
		c = new ImapFlow({
			host,
			port: +port,
			secure: true,
			auth: { user, pass: 'secret' },
			logger: false,
			tls: { rejectUnauthorized: false }
		});
		await c.connect();
		db.put('mail_accounts', {
			id,
			name: 'S',
			address: 'me@example.org',
			sender: 'Me Myself',
			type: 'imap',
			imap: { host, port: +port },
			smtp: { host: shost, port: 1 },
			username: user,
			password: 'secret',
			enabled: true
		});
		await mail.syncAccount(id);
	});

	test('a failed send stays queued; the next sync sends it, with a copy in Sent and Waiting set', async () => {
		const subject = `Hello ${user}`;
		db.put('mail_drafts', {
			id: 'dr1',
			account: id,
			to: ['Anna <anna@uni.example>'],
			subject,
			body: 'Hi **Anna**',
			track: true
		});
		const r = await mail.send('dr1');
		expect(r.ok).toBe(false);
		expect(db.get('mail_drafts', 'dr1')).toMatchObject({ queued: true });
		db.patch('mail_accounts', id, { smtp: { host: shost, port: +sport } });
		await mail.syncAccount(id);
		expect(db.get('mail_drafts', 'dr1')).toBeNull();
		const got = await (
			await fetch(`${apiUrl}/api/v1/search?query=${encodeURIComponent(`subject:"${subject}"`)}`)
		).json();
		expect(got.messages_count).toBe(1);
		expect(got.messages[0].From.Name).toBe('Me Myself');
		await mail.syncAccount(id); // picks up the Sent copy
		const sent = store.threads({ view: 'sent', account: id }, [id]);
		expect(sent.map((t) => t.subject)).toEqual([subject]);
		const waiting = db.list('mail_threads').find((t) => t.waiting);
		expect(waiting?.id).toBe(sent[0].thread);

		// the answer arrives: Waiting is cleared
		const sentRow = store.threadRows(sent[0].thread, [id])[0];
		await c.append(
			'INBOX',
			await build({
				subject: `Re: ${subject}`,
				text: 'Got it',
				inReplyTo: sentRow.msgid,
				references: [sentRow.msgid]
			})
		);
		await mail.syncAccount(id);
		expect(db.get('mail_threads', sent[0].thread)!.waiting).toBeUndefined();
		mail.unwatch(id);
		await c.logout();
	}, 30_000);
});

// ---------------------------------------------------------------- M4: dates in mail

describe('finding dates', () => {
	test('English and German dates, times, no bare numbers', async () => {
		const { findDates, firstDate } = await import('../src/modules/mail/dates.ts');
		const ref = new Date(2026, 10, 16, 9, 0); // Monday
		const en = findDates('Could you send it by Thursday, 19 November? Then we meet.', ref);
		expect(en.map((d) => [d.text, d.time])).toEqual([['Thursday, 19 November', false]]);
		expect(en[0].date.getDate()).toBe(19);
		const de = findDates('Treffen am Donnerstag, 19. November um 14 Uhr im Raum 2.14.', ref);
		expect(de.map((d) => d.text)).toEqual(['Donnerstag, 19. November um 14 Uhr']); // without "am"
		expect(de[0].time).toBe(true);
		expect(de[0].date.getHours()).toBe(14);
		expect(findDates('Are you free around 12? Version 2.14, page 12. Call me now.', ref)).toEqual(
			[]
		);
		// a weekday alone is a date ("next Monday" has no certain day of the month)
		const wd = findDates('We meet next Monday at 14:30 in the lab.', ref);
		expect(wd.map((d) => [d.text, d.time])).toEqual([['next Monday at 14:30', true]]);
		expect(wd[0].date).toEqual(new Date(2026, 10, 23, 14, 30));
		expect(findDates('Bis nächsten Montag um 14:30!', ref).map((d) => d.time)).toEqual([true]);
		expect(findDates('Sun is shining, march on.', ref)).toEqual([]);
		// a number before "bis" makes chrono read a range from that hour: the day is its end
		const bis = findDates('Korrektur von Blatt 5 bis Freitag, 20. November fertig?', ref);
		expect(bis.map((d) => [d.text, d.date.getDate(), d.time])).toEqual([
			['Freitag, 20. November', 20, false]
		]);
		// a week alone is no date, a day in it or a count of weeks is
		expect(findDates('Plan for the week: see you next week, nächste Woche.', ref)).toEqual([]);
		expect(findDates('Monday next week, or in 2 weeks.', ref).map((d) => d.text)).toEqual([
			'Monday next week',
			'in 2 weeks'
		]);
		expect(firstDate('Lunch tomorrow at 1pm? Or on 24.11.2026.', ref)!.date).toEqual(
			new Date(2026, 10, 17, 13, 0)
		);
	});
});

// ---------------------------------------------------------------- M5: invitations

const inviteIcs = (o: {
	uid: string;
	method?: string;
	seq?: number;
	start?: Date;
	summary?: string;
}) => {
	const s = o.start ?? new Date(Date.now() + 3 * 86_400_000);
	const f = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
	return [
		'BEGIN:VCALENDAR',
		'VERSION:2.0',
		'PRODID:-//Test//EN',
		`METHOD:${o.method ?? 'REQUEST'}`,
		'BEGIN:VEVENT',
		`UID:${o.uid}`,
		`SEQUENCE:${o.seq ?? 0}`,
		'DTSTAMP:20261115T120000Z',
		`DTSTART:${f(s)}`,
		`DTEND:${f(new Date(s.getTime() + 3_600_000))}`,
		`SUMMARY:${o.summary ?? 'Guest talk'}`,
		'LOCATION:Room 2.14',
		'ORGANIZER;CN=Seminar Office:mailto:seminar@uni.example',
		'ATTENDEE;CN=Me;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:me@example.org',
		'ATTENDEE;CN=Anna;PARTSTAT=ACCEPTED:mailto:anna@uni.example',
		...(o.method === 'CANCEL' ? ['STATUS:CANCELLED'] : []),
		'END:VEVENT',
		'END:VCALENDAR',
		''
	].join('\r\n');
};
const inviteMail = (o: Parameters<typeof inviteIcs>[0]) =>
	build({
		from: 'Seminar Office <seminar@uni.example>',
		subject: `${o.method === 'CANCEL' ? 'Cancelled' : 'Invitation'}: ${o.summary ?? 'Guest talk'}`,
		text: 'You are invited.',
		icalEvent: { method: o.method ?? 'REQUEST', content: inviteIcs(o) }
	});

describe('invitations', () => {
	test('the calendar part of a mail, the REPLY, and the event keeps ORGANIZER/ATTENDEE', async () => {
		const PostalMime = (await import('postal-mime')).default;
		const dav = await import('../src/lib/server/dav.ts');
		const p = await PostalMime.parse(await inviteMail({ uid: 'unit-inv@x', seq: 2 }));
		const inv = mail.inviteOf(p)!;
		expect(inv.info).toMatchObject({
			method: 'REQUEST',
			uid: 'unit-inv@x',
			summary: 'Guest talk',
			location: 'Room 2.14',
			allDay: false,
			sequence: 2,
			organizer: { name: 'Seminar Office', address: 'seminar@uni.example' }
		});
		expect(inv.info.attendees.map((a) => [a.address, a.partstat])).toEqual([
			['me@example.org', 'NEEDS-ACTION'],
			['anna@uni.example', 'ACCEPTED']
		]);

		const reply = mail.replyIcs(inv.ics, { name: 'Me', address: 'me@example.org' }, 'ACCEPTED');
		expect(reply).toContain('METHOD:REPLY');
		expect(reply).toContain('UID:unit-inv@x');
		expect(reply.match(/^ATTENDEE/gm)).toHaveLength(1);
		expect(reply.replace(/\r\n /g, '')).toMatch(
			/ATTENDEE;PARTSTAT=ACCEPTED;CN=Me:mailto:me@example.org/
		);

		const id = dav.importEvent(inv.ics, {
			tentative: true,
			invite: { organizer: 'seminar@uni.example', partstat: 'NEEDS-ACTION' },
			mail: { thread: 'T', subject: 'Invitation: Guest talk' }
		})!;
		expect(id).toBe('unit-inv@x');
		const ics = dav.eventIcs(id)!;
		expect(ics).not.toContain('METHOD:'); // a calendar resource must not have one
		expect(ics).toContain('ORGANIZER;CN=Seminar Office:mailto:seminar@uni.example');
		expect(ics).toContain('STATUS:TENTATIVE');
		expect(ics).toContain('X-PLANNER-INVITE');
		expect(db.get('events', id)).toMatchObject({
			title: 'Guest talk',
			tentative: true,
			invite: { organizer: 'seminar@uni.example', partstat: 'NEEDS-ACTION' },
			mail: { thread: 'T' }
		});
		expect(dav.setPartstat(id, 'ME@example.org', 'ACCEPTED')).toBe(true);
		expect(dav.eventIcs(id)!.replace(/\r\n /g, '')).toMatch(
			/ATTENDEE;CN=Me;PARTSTAT=ACCEPTED:mailto:me@example.org/
		);
		db.remove('events', id);
	});
});

describe.skipIf(!IMAP || !SMTP)('invitations against IMAP + SMTP', () => {
	const [host, port] = (IMAP ?? ':').split(':');
	const [shost, sport] = (SMTP ?? ':').split(':');
	const apiUrl = process.env.MAIL_TEST_SMTP_API ?? 'http://127.0.0.1:18025';
	const user = `inv${Date.now()}`;
	const id = 'imap-inv';
	const uid = `${user}-talk@x`;
	let c: import('imapflow').ImapFlow;

	beforeAll(async () => {
		process.env.MAIL_TLS_INSECURE = 'true';
		const { ImapFlow } = await import('imapflow');
		c = new ImapFlow({
			host,
			port: +port,
			secure: true,
			auth: { user, pass: 'secret' },
			logger: false,
			tls: { rejectUnauthorized: false }
		});
		await c.connect();
		db.put('mail_accounts', {
			id,
			name: 'I',
			address: 'me@example.org',
			sender: 'Me',
			type: 'imap',
			imap: { host, port: +port },
			smtp: { host: shost, port: +sport },
			username: user,
			password: 'secret',
			enabled: true
		});
	});

	test('invitation → tentative event → Accept (REPLY sent) → CANCEL removes it; Decline archives', async () => {
		await c.append('INBOX', await inviteMail({ uid }));
		await mail.syncAccount(id);
		expect(db.get('events', uid)).toMatchObject({
			tentative: true,
			invite: { partstat: 'NEEDS-ACTION' }
		});
		const [t] = store.threads({ view: 'inbox', account: id }, [id]);
		const [m] = await mail.readThread(t.thread);
		expect(m.invite?.uid).toBe(uid);

		const r = await mail.answerInvite(m.id, 'accept');
		expect(r).toMatchObject({ ok: true, sent: true, partstat: 'ACCEPTED' });
		const ev = db.get('events', uid)!;
		expect(ev.tentative).toBeUndefined();
		expect(ev.invite.partstat).toBe('ACCEPTED');
		const got = await (
			await fetch(
				`${apiUrl}/api/v1/search?query=${encodeURIComponent('subject:"Accepted: Guest talk"')}`
			)
		).json();
		const msgId = got.messages.find(
			(x: { To: { Address: string }[] }) => x.To[0].Address === 'seminar@uni.example'
		)?.ID;
		expect(msgId).toBeTruthy();
		const raw = await (await fetch(`${apiUrl}/api/v1/message/${msgId}/raw`)).text();
		expect(raw).toContain('method=REPLY');

		// the same invitation again (no new SEQUENCE) changes nothing; a cancellation removes the event
		await mail.syncAccount(id);
		expect(db.get('events', uid)!.invite.partstat).toBe('ACCEPTED');
		await c.append('INBOX', await inviteMail({ uid, method: 'CANCEL', seq: 1 }));
		await mail.syncAccount(id);
		expect(db.get('events', uid)).toBeNull();
		await mail.syncAccount(id);
		expect(db.get('events', uid)).toBeNull(); // and it doesn't come back

		// decline: no event, the mail goes to the archive
		const uid2 = `${user}-lunch@x`;
		await c.append('INBOX', await inviteMail({ uid: uid2, summary: 'Lunch' }));
		await mail.syncAccount(id);
		expect(db.get('events', uid2)).toBeTruthy();
		const t2 = store
			.threads({ view: 'inbox', account: id }, [id])
			.find((x) => x.subject === 'Invitation: Lunch')!;
		const [m2] = await mail.readThread(t2.thread);
		expect(await mail.answerInvite(m2.id, 'decline')).toMatchObject({
			ok: true,
			partstat: 'DECLINED'
		});
		expect(db.get('events', uid2)).toBeNull();
		await mail.pushOps(id);
		expect(
			store
				.threads({ view: 'archive', account: id }, [id])
				.some((x) => x.subject === 'Invitation: Lunch')
		).toBe(true);
		await mail.syncAccount(id);
		expect(db.get('events', uid2)).toBeNull();
		mail.unwatch(id);
		await c.logout();
	}, 60_000);
});
