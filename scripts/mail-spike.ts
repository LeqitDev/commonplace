// M0 spike: imapflow, nodemailer and postal-mime under Bun (TLS + STARTTLS, SPECIAL-USE, CONDSTORE, move, IDLE).
// Writes to the account (appends, flags, moves): only use a scratch mailbox.
import { ImapFlow, type ImapFlowOptions } from 'imapflow';
import nodemailer from 'nodemailer';
import PostalMime from 'postal-mime';

export interface SpikeOpts {
	imapHost: string;
	imapsPort: number; // implicit TLS
	imapPort: number; // STARTTLS
	smtpHost: string;
	smtpPort: number; // STARTTLS
	user: string;
	pass: string;
	idleMs?: number; // how long the watcher idles before the message is delivered
}

const timeout = <T>(p: Promise<T>, ms: number, what: string) =>
	Promise.race([
		p,
		new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`timeout: ${what}`)), ms))
	]);

export async function spike(o: SpikeOpts) {
	const log: string[] = [];
	const step = async <T>(name: string, fn: () => Promise<T>) => {
		const t = performance.now();
		try {
			const r = await fn();
			log.push(`ok   ${name} (${Math.round(performance.now() - t)} ms)`);
			return r;
		} catch (e) {
			log.push(`FAIL ${name}: ${(e as Error).stack ?? e}`);
			throw e;
		}
	};
	const imap = (secure: boolean): ImapFlowOptions => ({
		host: o.imapHost,
		port: secure ? o.imapsPort : o.imapPort,
		secure,
		auth: { user: o.user, pass: o.pass },
		tls: { rejectUnauthorized: false },
		logger: false
	});

	try {
		// 1. nodemailer builds the MIME message (markdown → html part later) with an inline image and a calendar part.
		const raw = await step('nodemailer build (streamTransport)', async () => {
			const t = nodemailer.createTransport({
				streamTransport: true,
				buffer: true,
				newline: 'unix'
			});
			const info = await t.sendMail({
				from: 'Me <me@example.org>',
				to: 'You <you@example.org>',
				subject: 'Spike: Treffen am Donnerstag, 19. November',
				text: 'Hallo,\n\nkönnen wir Donnerstag, 19. November um 14 Uhr sprechen?',
				html: '<p>Hallo,</p><p>können wir <b>Donnerstag</b> sprechen?</p><img src="cid:dot">',
				attachments: [
					{
						filename: 'dot.png',
						cid: 'dot',
						content: Buffer.from(
							'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
							'base64'
						)
					},
					{ filename: 'notes.txt', content: 'attached text' }
				],
				icalEvent: {
					method: 'REQUEST',
					content:
						'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//spike//EN\r\nMETHOD:REQUEST\r\nBEGIN:VEVENT\r\nUID:spike-1@example.org\r\nDTSTAMP:20261115T120000Z\r\nDTSTART:20261119T130000Z\r\nDTEND:20261119T140000Z\r\nSUMMARY:Spike\r\nORGANIZER:mailto:you@example.org\r\nATTENDEE;PARTSTAT=NEEDS-ACTION:mailto:me@example.org\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n'
				}
			});
			return info.message as Buffer;
		});

		// 2. postal-mime parses it back.
		await step('postal-mime parse', async () => {
			const m = await PostalMime.parse(raw);
			const cal = m.attachments.find((a) => a.mimeType === 'text/calendar');
			if (!m.text?.includes('19. November') || !m.html?.includes('cid:dot'))
				throw new Error('body');
			if (!m.attachments.some((a) => a.contentId === '<dot>')) throw new Error('inline image');
			if (!cal) throw new Error('calendar part');
			log.push(
				`     subject=${m.subject} attachments=${m.attachments.map((a) => a.mimeType).join(',')}`
			);
		});

		// 3. SMTP with STARTTLS + AUTH.
		await step('nodemailer SMTP send (STARTTLS)', async () => {
			const t = nodemailer.createTransport({
				host: o.smtpHost,
				port: o.smtpPort,
				secure: false,
				requireTLS: true,
				auth: { user: o.user, pass: o.pass },
				tls: { rejectUnauthorized: false }
			});
			await t.verify();
			const info = await t.sendMail({
				envelope: { from: 'me@example.org', to: ['you@example.org'] },
				raw
			});
			log.push(`     accepted=${info.accepted} response=${info.response}`);
			t.close();
		});

		// 4. IMAP over STARTTLS.
		await step('imapflow connect (STARTTLS)', async () => {
			const c = new ImapFlow(imap(false));
			await c.connect();
			if (!c.secureConnection) log.push('     note: secureConnection=false after STARTTLS');
			await c.logout();
		});

		// 5. IMAP over implicit TLS: folders, append, fetch, flags, move, CONDSTORE.
		const c = new ImapFlow(imap(true));
		await step('imapflow connect (TLS)', () => c.connect());
		log.push(`     capabilities: ${[...c.capabilities.keys()].join(' ')}`);
		const folders = await step('list + SPECIAL-USE', async () => {
			const l = await c.list();
			const f = Object.fromEntries(
				l.filter((x) => x.specialUse).map((x) => [x.specialUse, x.path])
			);
			log.push(`     ${JSON.stringify(f)}`);
			if (!f['\\Inbox'] || !f['\\Sent'] || !f['\\Archive']) throw new Error('special use missing');
			return f as Record<string, string>;
		});
		await step('append to Inbox and Sent', async () => {
			await c.append('INBOX', raw);
			await c.append(folders['\\Sent'], raw, ['\\Seen']);
		});
		const watcher = new ImapFlow({ ...imap(true), autoIdleDelay: 500 }); // default: IDLE after 15 s of inactivity
		try {
			await step('fetch envelope/flags/structure/source, CONDSTORE', async () => {
				const lock = await c.getMailboxLock('INBOX');
				try {
					const mb = {
						...(c.mailbox as { uidValidity: bigint; uidNext: number; highestModseq?: bigint })
					}; // c.mailbox is live
					log.push(
						`     uidvalidity=${mb.uidValidity} uidnext=${mb.uidNext} modseq=${mb.highestModseq}`
					);
					let n = 0;
					for await (const m of c.fetch('1:*', {
						uid: true,
						envelope: true,
						flags: true,
						bodyStructure: true,
						internalDate: true
					}))
						(n++, m.envelope?.subject ?? '');
					const last = await c.fetchOne('*', { source: true, envelope: true, uid: true });
					if (!last || !last.source) throw new Error('no source');
					const parsed = await PostalMime.parse(last.source);
					log.push(`     ${n} messages; last uid=${last.uid} parsed subject=${parsed.subject}`);
					// part download: the text/plain part
					const part = await c.download(String(last.uid), '1', { uid: true }).catch(() => null);
					if (part?.content && part.meta) {
						const chunks: Buffer[] = [];
						for await (const ch of part.content) chunks.push(ch as Buffer);
						log.push(
							`     download part 1: ${part.meta.contentType} ${Buffer.concat(chunks).length} bytes`
						);
					}
					await c.messageFlagsAdd(String(last.uid), ['\\Seen', '\\Flagged'], { uid: true });
					const changed: number[] = [];
					for await (const m of c.fetch(
						'1:*',
						{ uid: true, flags: true },
						{ changedSince: mb.highestModseq ?? 0n }
					))
						changed.push(m.uid);
					log.push(`     changedSince → uids ${changed.join(',')}`);
					const moved = await c.messageMove(String(last.uid), folders['\\Archive'], { uid: true });
					log.push(
						`     move → ${JSON.stringify(moved && moved.uidMap ? [...moved.uidMap] : moved)}`
					);
				} finally {
					lock.release();
				}
			});

			// 6. IDLE: a second connection sits on the inbox; a message appended by the first must arrive as an event.
			await step(`IDLE watcher gets 'exists' after ${o.idleMs ?? 5000} ms`, async () => {
				await watcher.connect();
				await watcher.mailboxOpen('INBOX');
				const events: string[] = [];
				const got = new Promise<void>((res) => {
					watcher.on('exists', (d: { count: number; prevCount: number }) => {
						events.push(`exists ${d.prevCount}→${d.count}`);
						res();
					});
				});
				watcher.on('flags', (d: { uid?: number }) => events.push(`flags uid=${d.uid}`));
				watcher.on('expunge', () => events.push('expunge'));
				await new Promise((r) => setTimeout(r, o.idleMs ?? 5000));
				log.push(`     idling=${watcher.idling}`);
				await c.append('INBOX', raw);
				await timeout(got, 10_000, 'exists event');
				log.push(`     events: ${events.join('; ')}`);
			});

			// 7. Server drops the connection: 'close' must fire.
			await step('close event when the server drops the connection', async () => {
				const closed = new Promise<void>((res) => watcher.once('close', () => res()));
				// Destroy the socket from our side as a stand-in for a server-side kick (no doveadm here).
				(watcher as unknown as { socket: { destroy(): void } }).socket.destroy();
				await timeout(closed, 5000, 'close event');
				log.push(`     usable=${watcher.usable}`);
			});
		} finally {
			await c.logout().catch(() => {});
			watcher.close();
		}
		return { ok: true, log };
	} catch {
		return { ok: false, log };
	}
}

export const spikeEnv = (): SpikeOpts => ({
	imapHost: process.env.SPIKE_IMAP_HOST ?? '127.0.0.1',
	imapsPort: Number(process.env.SPIKE_IMAPS_PORT ?? 14993),
	imapPort: Number(process.env.SPIKE_IMAP_PORT ?? 14143),
	smtpHost: process.env.SPIKE_SMTP_HOST ?? '127.0.0.1',
	smtpPort: Number(process.env.SPIKE_SMTP_PORT ?? 11025),
	user: process.env.SPIKE_USER ?? 'spike',
	pass: process.env.SPIKE_PASS ?? 'secret',
	idleMs: Number(process.env.SPIKE_IDLE_MS ?? 5000)
});

// bun scripts/mail-spike.ts (SPIKE_* env, see spikeEnv): runs every step against a scratch account.
if (import.meta.main) {
	const r = await spike(spikeEnv());
	console.log(r.log.join('\n'));
	process.exit(r.ok ? 0 : 1);
}
