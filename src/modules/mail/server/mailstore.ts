// Mail cache: a second SQLite file (DATA_DIR/mail.db) + raw messages as DATA_DIR/mail/<account>/<hash>.eml.
// The IMAP server is the truth; all of this can be deleted and is rebuilt by the next sync.
import { Database } from 'bun:sqlite';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from '#lib/server/db.ts';
import type { MailView } from '../mail.ts';
import type { MailThreadRow, SearchHit } from '#lib/types.ts';

export const MAIL_DIR = join(DATA_DIR, 'mail');
export type Folder = 'inbox' | 'sent' | 'archive';

export const mdb = new Database(process.env.MAIL_DB_PATH ?? join(DATA_DIR, 'mail.db'), {
	create: true
});
mdb.run('PRAGMA journal_mode = WAL');
mdb.run(`CREATE TABLE IF NOT EXISTS msg (
	id INTEGER PRIMARY KEY,
	account TEXT NOT NULL, folder TEXT NOT NULL, uid INTEGER NOT NULL,
	msgid TEXT NOT NULL, thread TEXT NOT NULL, date TEXT NOT NULL,
	from_name TEXT NOT NULL DEFAULT '', from_addr TEXT NOT NULL DEFAULT '', to_json TEXT NOT NULL DEFAULT '[]',
	subject TEXT NOT NULL DEFAULT '', snippet TEXT,
	seen INTEGER NOT NULL DEFAULT 0, flagged INTEGER NOT NULL DEFAULT 0,
	attach INTEGER NOT NULL DEFAULT 0, invite INTEGER NOT NULL DEFAULT 0,
	tpart TEXT, cached INTEGER NOT NULL DEFAULT 0,
	UNIQUE (account, folder, uid))`);
mdb.run('CREATE INDEX IF NOT EXISTS msg_afd ON msg (account, folder, date)');
mdb.run('CREATE INDEX IF NOT EXISTS msg_thread ON msg (thread)');
mdb.run('CREATE INDEX IF NOT EXISTS msg_msgid ON msg (msgid)');
mdb.run(`CREATE TABLE IF NOT EXISTS folder_state (
	account TEXT NOT NULL, folder TEXT NOT NULL, path TEXT NOT NULL,
	uidvalidity TEXT NOT NULL, uidnext INTEGER NOT NULL, modseq TEXT,
	PRIMARY KEY (account, folder))`);
try {
	// M2: the folder's SPECIAL-USE (\All: archiving only takes the message out of the inbox)
	mdb.run('ALTER TABLE folder_state ADD COLUMN special TEXT');
} catch {
	/* there already */
}
mdb.run(`CREATE TABLE IF NOT EXISTS ops (
	id INTEGER PRIMARY KEY, account TEXT NOT NULL, kind TEXT NOT NULL, args TEXT NOT NULL,
	tries INTEGER NOT NULL DEFAULT 0, error TEXT)`);
mdb.run(
	"CREATE VIRTUAL TABLE IF NOT EXISTS mail_fts USING fts5(subject, sender, body, tokenize='unicode61 remove_diacritics 2')"
);

// What the decision model said about a message (mail triage, `src/lib/server/triage.ts`), by
// Message-ID. `state` is exactly what it was given; bucket/due/importance come from `summary()`.
mdb.run(`CREATE TABLE IF NOT EXISTS triage (
	msgid TEXT PRIMARY KEY, thread TEXT NOT NULL, date TEXT NOT NULL,
	version TEXT NOT NULL, model TEXT NOT NULL, at TEXT NOT NULL,
	state TEXT NOT NULL, facts TEXT NOT NULL, answers TEXT NOT NULL,
	bucket TEXT NOT NULL, due TEXT, importance REAL NOT NULL DEFAULT 0)`);
mdb.run('CREATE INDEX IF NOT EXISTS triage_thread ON triage (thread, date)');
// 2026-11-25: `bucket` holds the tab (personal/orders/news/ads); the one-time code found in the
// text, the summary of the optional generative model, and a copy of the hand-corrected answers
// (the truth is `triage_labels` in commonplace.db)
for (const col of ['code TEXT', 'summary TEXT', 'labels TEXT'])
	try {
		mdb.run(`ALTER TABLE triage ADD COLUMN ${col}`);
	} catch {
		/* there already */
	}
// DHL parcels found in triaged order mail, with their last tracking status (`parcels.ts`)
mdb.run(`CREATE TABLE IF NOT EXISTS parcels (
	number TEXT PRIMARY KEY, thread TEXT NOT NULL, msgid TEXT NOT NULL, found TEXT NOT NULL,
	checked TEXT, delivered INTEGER NOT NULL DEFAULT 0, status TEXT)`);
mdb.run('CREATE INDEX IF NOT EXISTS parcels_thread ON parcels (thread)');

const sha = (s: string) => createHash('sha1').update(s).digest('hex').slice(0, 20);

/** Thread id: the first id in References, else In-Reply-To, else the message's own Message-ID. */
export function threadId(msgid: string, references: string[] = [], inReplyTo?: string | null) {
	return sha(references[0] ?? inReplyTo ?? msgid);
}

/** The cached raw message (shared by the folders an account has it in, e.g. Gmail's Inbox and All Mail). */
export const emlPath = (account: string, msgid: string) =>
	join(MAIL_DIR, account.replace(/[^\w-]/g, '_'), `${sha(msgid)}.eml`);

export interface MsgRow {
	id: number;
	account: string;
	folder: Folder;
	uid: number;
	msgid: string;
	thread: string;
	date: string;
	from_name: string;
	from_addr: string;
	to_json: string;
	subject: string;
	snippet: string | null;
	seen: number;
	flagged: number;
	attach: number;
	invite: number;
	tpart: string | null;
	cached: number;
}
export type NewMsg = Omit<MsgRow, 'id' | 'cached' | 'seen' | 'flagged' | 'attach' | 'invite'> & {
	seen: boolean;
	flagged: boolean;
	attach: boolean;
	invite: boolean;
};

export interface FolderState {
	path: string;
	uidvalidity: string;
	uidnext: number;
	modseq: string | null;
	special?: string | null;
}

const q = {
	state: mdb.query<FolderState, [string, string]>(
		'SELECT path, uidvalidity, uidnext, modseq, special FROM folder_state WHERE account = ? AND folder = ?'
	),
	setState: mdb.query(
		'INSERT OR REPLACE INTO folder_state (account, folder, path, uidvalidity, uidnext, modseq, special) VALUES (?, ?, ?, ?, ?, ?, ?)'
	),
	insert: mdb.query(`INSERT OR IGNORE INTO msg
		(account, folder, uid, msgid, thread, date, from_name, from_addr, to_json, subject, snippet, seen, flagged, attach, invite, tpart, cached)
		VALUES ($account, $folder, $uid, $msgid, $thread, $date, $from_name, $from_addr, $to_json, $subject, $snippet, $seen, $flagged, $attach, $invite, $tpart, $cached)
		RETURNING id`),
	ftsPut: mdb.query(
		'INSERT OR REPLACE INTO mail_fts (rowid, subject, sender, body) VALUES (?, ?, ?, ?)'
	),
	ftsDel: mdb.query('DELETE FROM mail_fts WHERE rowid = ?'),
	flags: mdb.query(
		'UPDATE msg SET seen = ?, flagged = ? WHERE account = ? AND folder = ? AND uid = ? AND (seen != ? OR flagged != ?)'
	),
	count: mdb.query<{ n: number }, [string, string]>(
		'SELECT count(*) AS n FROM msg WHERE account = ? AND folder = ?'
	),
	uids: mdb.query<{ id: number; uid: number; msgid: string }, [string, string]>(
		'SELECT id, uid, msgid FROM msg WHERE account = ? AND folder = ?'
	),
	del: mdb.query('DELETE FROM msg WHERE id = ?'),
	byId: mdb.query<MsgRow, [number]>('SELECT * FROM msg WHERE id = ?'),
	others: mdb.query<{ n: number }, [string, string]>(
		'SELECT count(*) AS n FROM msg WHERE account = ? AND msgid = ?'
	),
	anywhere: mdb.query<{ n: number }, [string]>('SELECT count(*) AS n FROM msg WHERE msgid = ?'),
	triageDel: mdb.query('DELETE FROM triage WHERE msgid = ?')
};

export const folderState = (account: string, folder: Folder) => q.state.get(account, folder);
export const setFolderState = (account: string, folder: Folder, s: FolderState) =>
	q.setState.run(account, folder, s.path, s.uidvalidity, s.uidnext, s.modseq, s.special ?? null);

const ftsText = (m: Pick<MsgRow, 'subject' | 'from_name' | 'from_addr'>, body: string) => [
	m.subject,
	`${m.from_name} ${m.from_addr}`,
	body
];

const COLS = [
	'account',
	'folder',
	'uid',
	'msgid',
	'thread',
	'date',
	'from_name',
	'from_addr',
	'to_json',
	'subject',
	'snippet',
	'tpart'
] as const;

/** Insert new messages (existing (account, folder, uid) are left alone). Messages whose raw text is
 *  cached already (from another folder) count as cached. Returns the ids of the new rows. */
export const insert = mdb.transaction((rows: NewMsg[]) => {
	const ids: number[] = [];
	for (const r of rows) {
		const cached = existsSync(emlPath(r.account, r.msgid)) ? 1 : 0;
		const res = q.insert.get({
			...Object.fromEntries(COLS.map((k) => [`$${k}`, r[k]])),
			$seen: +r.seen,
			$flagged: +r.flagged,
			$attach: +r.attach,
			$invite: +r.invite,
			$cached: cached
		} as never) as { id: number } | null;
		if (!res) continue;
		ids.push(res.id);
		q.ftsPut.run(res.id, ...ftsText(r, r.snippet ?? ''));
	}
	return ids;
});

/** Flag updates of one folder: [uid, seen, flagged]. Returns how many rows changed. */
export const setFlags = mdb.transaction(
	(account: string, folder: Folder, updates: [number, boolean, boolean][]) => {
		let n = 0;
		for (const [uid, seen, flagged] of updates)
			n += q.flags.run(+seen, +flagged, account, folder, uid, +seen, +flagged).changes;
		return n;
	}
);

export const count = (account: string, folder: Folder) => q.count.get(account, folder)!.n;

function dropRows(rows: { id: number; msgid: string }[], account: string) {
	for (const r of rows) {
		q.del.run(r.id);
		q.ftsDel.run(r.id);
		if (!q.others.get(account, r.msgid)!.n) rmSync(emlPath(account, r.msgid), { force: true });
		if (!q.anywhere.get(r.msgid)!.n) q.triageDel.run(r.msgid);
	}
}

/** Drop the rows of messages that are no longer in the folder. Returns how many went. */
export const keepOnly = mdb.transaction((account: string, folder: Folder, uids: number[]) => {
	const keep = new Set(uids);
	const gone = q.uids.all(account, folder).filter((r) => !keep.has(r.uid));
	dropRows(gone, account);
	return gone.length;
});

/** The folder's UIDs are no longer valid (UIDVALIDITY changed): read it again from scratch. */
export const dropFolder = mdb.transaction((account: string, folder: Folder) => {
	dropRows(q.uids.all(account, folder), account);
	mdb.query('DELETE FROM folder_state WHERE account = ? AND folder = ?').run(account, folder);
});

export function dropAccount(account: string) {
	mdb.transaction(() => {
		for (const r of mdb
			.query<{ id: number }, [string]>('SELECT id FROM msg WHERE account = ?')
			.all(account))
			q.ftsDel.run(r.id);
		mdb.query('DELETE FROM msg WHERE account = ?').run(account);
		mdb.query('DELETE FROM folder_state WHERE account = ?').run(account);
		mdb.query('DELETE FROM ops WHERE account = ?').run(account);
		mdb.run('DELETE FROM triage WHERE msgid NOT IN (SELECT msgid FROM msg)');
	})();
	rmSync(join(MAIL_DIR, account.replace(/[^\w-]/g, '_')), { recursive: true, force: true });
}

/** Messages of a folder whose raw text should be downloaded (newer than `since`), newest first. */
export const needBody = (account: string, folder: Folder, since: string) =>
	mdb
		.query<Pick<MsgRow, 'id' | 'uid' | 'msgid'>, [string, string, string]>(
			'SELECT id, uid, msgid FROM msg WHERE account = ? AND folder = ? AND cached = 0 AND date >= ? ORDER BY date DESC'
		)
		.all(account, folder, since);

/** Older messages without a snippet yet: their text part is fetched partially. */
export const needSnippet = (account: string, folder: Folder) =>
	mdb
		.query<Pick<MsgRow, 'id' | 'uid' | 'tpart'>, [string, string]>(
			'SELECT id, uid, tpart FROM msg WHERE account = ? AND folder = ? AND cached = 0 AND snippet IS NULL AND tpart IS NOT NULL ORDER BY date DESC'
		)
		.all(account, folder);

export function setSnippet(id: number, snippet: string) {
	const m = q.byId.get(id);
	if (!m) return;
	mdb.query('UPDATE msg SET snippet = ? WHERE id = ?').run(snippet, id);
	q.ftsPut.run(id, ...ftsText(m, snippet));
}

/** The raw text of a message was saved: every row of it (all folders) is cached and its body indexed. */
export const setBody = mdb.transaction(
	(
		account: string,
		msgid: string,
		b: { snippet: string; text: string; attach: boolean; invite: boolean }
	) => {
		const rows = mdb
			.query<MsgRow, [string, string]>('SELECT * FROM msg WHERE account = ? AND msgid = ?')
			.all(account, msgid);
		for (const m of rows) {
			mdb
				.query('UPDATE msg SET cached = 1, snippet = ?, attach = ?, invite = ? WHERE id = ?')
				.run(b.snippet, +b.attach, +b.invite, m.id);
			q.ftsPut.run(m.id, ...ftsText(m, b.text));
		}
	}
);

export const msg = (id: number) => q.byId.get(id) ?? null;

// ---------------------------------------------------------------- views

// `later` is planner state (mail_threads docs): the caller passes which threads are put off
// (out of the inbox) and which came back (sorted by the time they came back).
const VIEW_SQL: Record<MailView, string> = {
	inbox:
		"thread IN (SELECT thread FROM m WHERE folder = 'inbox') AND thread NOT IN (SELECT value FROM json_each($off))",
	later: 'thread IN (SELECT value FROM json_each($off))',
	waiting: 'thread IN (SELECT value FROM json_each($waiting))',
	sent: "thread IN (SELECT thread FROM m WHERE folder = 'sent')",
	archive:
		"thread IN (SELECT thread FROM m WHERE folder = 'archive') AND thread NOT IN (SELECT thread FROM m WHERE folder = 'inbox')",
	flagged: 'thread IN (SELECT thread FROM m WHERE flagged = 1)'
};

type ThreadSql = {
	thread: string;
	account: string;
	date: string;
	sort: string;
	senders: string;
	from_name: string;
	from_addr: string;
	to_json: string;
	subject: string;
	snippet: string | null;
	count: number;
	unread: number;
	flagged: number;
	attach: number;
	invite: number;
	t_answers: string | null;
	t_facts: string | null;
	t_at: string | null;
	t_bucket: string | null;
	t_code: string | null;
	t_summary: string | null;
	t_labels: string | null;
	replied: number;
	parcel: string | null;
};

export interface ThreadQuery {
	account?: string | null;
	view: MailView;
	before?: string | null;
	limit?: number;
	/** Threads put off until later (in the future). */
	off?: string[];
	/** Threads whose later time has passed: thread → that time. */
	back?: Record<string, string>;
	/** Threads waiting for an answer (Track the reply). */
	waiting?: string[];
	/** Inbox tab of the triage (the tab of the thread's newest triaged message). */
	tab?: string | null;
}

/** Threads of a view, newest first; `before` pages by `sort` (newest message, or the time it came
 *  back from later). */
export function threads(o: ThreadQuery, accounts: string[]): MailThreadRow[] {
	const acc = o.account ? [o.account] : accounts;
	if (!acc.length) return [];
	const where =
		o.tab && o.view === 'inbox' ? 'tri.bucket = $tab AND sort < $before' : 'sort < $before';
	const marks = acc.map((_, i) => `$a${i}`).join(',');
	// all threads of the view (agg), one page of them (page), the fields of each one's newest message (top)
	const rows = mdb
		.query<ThreadSql, Record<string, string | number>>(
			`WITH m AS (SELECT * FROM msg WHERE account IN (${marks})),
			agg AS (
				SELECT thread, max(date) AS date, count(DISTINCT msgid) AS count,
					count(DISTINCT CASE WHEN seen = 0 THEN msgid END) AS unread,
					max(flagged) AS flagged, max(attach) AS attach, max(invite) AS invite,
					group_concat(DISTINCT from_addr) AS senders
				FROM m WHERE ${VIEW_SQL[o.view]}
				GROUP BY thread),
			tri AS (
				SELECT thread, date, answers, facts, at, bucket, code, summary, labels,
					row_number() OVER (PARTITION BY thread ORDER BY date DESC) AS rn
				FROM triage WHERE thread IN (SELECT thread FROM agg)),
			page AS (
				SELECT agg.*, max(agg.date, coalesce(b.value, '')) AS sort,
					tri.answers AS t_answers, tri.facts AS t_facts, tri.at AS t_at, tri.date AS t_date,
					tri.bucket AS t_bucket, tri.code AS t_code, tri.summary AS t_summary,
					tri.labels AS t_labels
				FROM agg LEFT JOIN json_each($back) AS b ON b.key = agg.thread
					LEFT JOIN tri ON tri.thread = agg.thread AND tri.rn = 1
				WHERE ${where} ORDER BY sort DESC LIMIT $limit),
			top AS (
				SELECT m.*, row_number() OVER (PARTITION BY m.thread ORDER BY m.date DESC, m.cached DESC) AS rn
				FROM m JOIN page USING (thread))
			SELECT page.*, top.account, top.from_name, top.from_addr, top.to_json, top.subject, top.snippet,
				EXISTS (SELECT 1 FROM msg s WHERE s.thread = page.thread AND s.folder = 'sent'
					AND s.date > page.t_date) AS replied,
				(SELECT status FROM parcels p WHERE p.thread = page.thread ORDER BY p.found DESC LIMIT 1) AS parcel
			FROM page JOIN top ON top.thread = page.thread AND top.rn = 1
			ORDER BY page.sort DESC`
		)
		.all({
			...Object.fromEntries(acc.map((a, i) => [`$a${i}`, a])),
			$off: JSON.stringify(o.off ?? []),
			$back: JSON.stringify(o.back ?? {}),
			$waiting: JSON.stringify(o.waiting ?? []),
			$before: o.before ?? '9999',
			$limit: o.limit ?? 50,
			...(o.tab && o.view === 'inbox' && { $tab: o.tab })
		});
	return rows.map((r) => ({
		thread: r.thread,
		account: r.account,
		date: r.date,
		sort: r.sort,
		senders: r.senders ? r.senders.split(',').filter(Boolean) : [],
		fromName: r.from_name,
		fromAddr: r.from_addr,
		to: JSON.parse(r.to_json),
		subject: r.subject,
		snippet: r.snippet ?? '',
		count: r.count,
		unread: r.unread,
		flagged: !!r.flagged,
		attach: !!r.attach,
		invite: !!r.invite,
		...(r.t_answers && {
			triage: {
				answers: JSON.parse(r.t_answers),
				facts: JSON.parse(r.t_facts ?? '{}'),
				at: r.t_at!,
				tab: r.t_bucket ?? '',
				...(r.t_code && { code: r.t_code }),
				...(r.t_summary && { summary: r.t_summary }),
				...(r.t_labels && { labels: JSON.parse(r.t_labels) }),
				...(r.replied && { replied: true })
			}
		}),
		...(r.parcel && { parcel: JSON.parse(r.parcel) })
	}));
}

/** Unread conversations in the inbox ("N to triage"), with what decides their project. */
export function unreadInbox(accounts: string[], off: string[] = []) {
	if (!accounts.length) return [];
	return mdb
		.query<{ thread: string; account: string; senders: string }, Record<string, string>>(
			`SELECT thread, min(account) AS account, group_concat(DISTINCT from_addr) AS senders FROM msg
			WHERE account IN (${accounts.map((_, i) => `$a${i}`).join(',')})
				AND thread NOT IN (SELECT value FROM json_each($off))
			GROUP BY thread HAVING max(folder = 'inbox' AND seen = 0) = 1`
		)
		.all({
			...Object.fromEntries(accounts.map((a, i) => [`$a${i}`, a])),
			$off: JSON.stringify(off)
		})
		.map((r) => ({ ...r, senders: r.senders ? r.senders.split(',') : [] }));
}

/** The project and focus of a thread need its account and senders (palette hits, notifications). */
export function threadInfo(thread: string) {
	const r = mdb
		.query<{ account: string; senders: string } | null, [string]>(
			'SELECT min(account) AS account, group_concat(DISTINCT from_addr) AS senders FROM msg WHERE thread = ?'
		)
		.get(thread);
	return r?.account ? { thread, account: r.account, senders: (r.senders ?? '').split(',') } : null;
}

// ---------------------------------------------------------------- actions (cache first, server later)

/** A change still to be made on the IMAP server: done right away, retried with every sync. */
export interface Op {
	id: number;
	account: string;
	kind: 'flags' | 'move';
	/** flags: { folder, items, add?, remove? }; move: { from, to, items } */
	args: string;
	tries: number;
	error: string | null;
}
export type OpItem = { msgid: string; uid: number | null };

export const queueOp = (account: string, kind: Op['kind'], args: object) =>
	mdb
		.query('INSERT INTO ops (account, kind, args) VALUES (?, ?, ?)')
		.run(account, kind, JSON.stringify(args));
export const pendingOps = (account: string) =>
	mdb.query<Op, [string]>('SELECT * FROM ops WHERE account = ? ORDER BY id').all(account);
export const opDone = (id: number) => mdb.query('DELETE FROM ops WHERE id = ?').run(id);
export const opFailed = (id: number, error: string) =>
	mdb.query('UPDATE ops SET tries = tries + 1, error = ? WHERE id = ?').run(error, id);

const rowsOf = (thread: string, accounts: string[]) =>
	mdb
		.query<MsgRow, string[]>(
			`SELECT * FROM msg WHERE thread = ? AND account IN (${accounts.map(() => '?').join(',')}) ORDER BY date`
		)
		.all(thread, ...accounts);

const item = (r: MsgRow): OpItem => ({ msgid: r.msgid, uid: r.uid > 0 ? r.uid : null });
const byBox = (rows: MsgRow[]) => Map.groupBy(rows, (r) => `${r.account}\n${r.folder}`);
const placeholder = () => -1 - Math.floor(Math.random() * 2 ** 31);

/** Mark a thread read/unread: every message (unread: only the newest, as mail apps do). */
export const setSeen = mdb.transaction((thread: string, accounts: string[], seen: boolean) => {
	const all = rowsOf(thread, accounts);
	const newest = all.filter((r) => r.folder !== 'sent').at(-1)?.msgid;
	const rows = all.filter((r) => !!r.seen !== seen && (seen || r.msgid === newest));
	for (const r of rows) mdb.query('UPDATE msg SET seen = ? WHERE id = ?').run(+seen, r.id);
	for (const [key, part] of byBox(rows)) {
		const [account, folder] = key.split('\n');
		queueOp(account, 'flags', {
			folder,
			items: part.map(item),
			[seen ? 'add' : 'remove']: ['\\Seen']
		});
	}
	return rows.length;
});

/** Flag the newest message of a thread, or unflag all of them. */
export const setFlagged = mdb.transaction(
	(thread: string, accounts: string[], flagged: boolean) => {
		const all = rowsOf(thread, accounts);
		const newest = all.filter((r) => r.folder !== 'sent').at(-1)?.msgid ?? all.at(-1)?.msgid;
		const rows = all.filter((r) => (flagged ? r.msgid === newest && !r.flagged : !!r.flagged));
		for (const r of rows) mdb.query('UPDATE msg SET flagged = ? WHERE id = ?').run(+flagged, r.id);
		for (const [key, part] of byBox(rows)) {
			const [account, folder] = key.split('\n');
			queueOp(account, 'flags', {
				folder,
				items: part.map(item),
				[flagged ? 'add' : 'remove']: ['\\Flagged']
			});
		}
		return rows.length;
	}
);

/** Archive (inbox → archive folder) or back to the inbox. Rows move at once with a placeholder
 *  UID (negative) until the server tells the new one (MOVE's UID map, else the next sync). Where
 *  the archive is "All Mail" (Gmail), archiving only drops the inbox row and unarchiving copies. */
export const setArchived = mdb.transaction(
	(
		thread: string,
		accounts: string[],
		archived: boolean,
		allMail: (account: string) => boolean
	) => {
		const [from, to]: Folder[] = archived ? ['inbox', 'archive'] : ['archive', 'inbox'];
		const all = rowsOf(thread, accounts);
		const rows = all.filter((r) => r.folder === from && folderState(r.account, to));
		for (const r of rows) {
			const there = all.some(
				(x) => x.account === r.account && x.folder === to && x.msgid === r.msgid
			);
			if (archived && allMail(r.account)) {
				q.del.run(r.id);
				q.ftsDel.run(r.id);
			} else if (!archived && allMail(r.account)) {
				if (!there)
					insert([
						{
							...r,
							folder: 'inbox',
							uid: placeholder(),
							seen: !!r.seen,
							flagged: !!r.flagged,
							attach: !!r.attach,
							invite: !!r.invite
						}
					]);
			} else if (there) {
				q.del.run(r.id);
				q.ftsDel.run(r.id);
			} else
				mdb.query('UPDATE msg SET folder = ?, uid = ? WHERE id = ?').run(to, placeholder(), r.id);
		}
		for (const [key, part] of byBox(rows)) {
			const [account] = key.split('\n');
			queueOp(account, 'move', { from, to, items: part.map(item) });
		}
		return rows.length;
	}
);

/** The server told the UID a moved message got: replace the placeholder (or drop it, if a sync
 *  has brought the real row already). */
export function settleUid(account: string, folder: Folder, msgid: string, uid: number) {
	const ph = mdb
		.query<{ id: number }, [string, string, string]>(
			'SELECT id FROM msg WHERE account = ? AND folder = ? AND msgid = ? AND uid < 0'
		)
		.get(account, folder, msgid);
	if (!ph) return;
	const taken = mdb
		.query<{ id: number }, [string, string, number]>(
			'SELECT id FROM msg WHERE account = ? AND folder = ? AND uid = ?'
		)
		.get(account, folder, uid);
	if (taken) {
		q.del.run(ph.id);
		q.ftsDel.run(ph.id);
	} else mdb.query('UPDATE msg SET uid = ? WHERE id = ?').run(uid, ph.id);
}

/** A thread's cache row uid of a message in a folder (null: placeholder or gone). */
export const uidOf = (account: string, folder: Folder, msgid: string) =>
	mdb
		.query<{ uid: number }, [string, string, string]>(
			'SELECT uid FROM msg WHERE account = ? AND folder = ? AND msgid = ? AND uid > 0'
		)
		.get(account, folder, msgid)?.uid ?? null;

/** Rows inserted by a sync that are new unread mail in the inbox (for a notification). */
export const freshRows = (ids: number[]) =>
	ids.length
		? mdb
				.query<MsgRow, number[]>(
					`SELECT * FROM msg WHERE id IN (${ids.map(() => '?').join(',')}) AND folder = 'inbox' AND seen = 0`
				)
				.all(...ids)
		: [];

/** The messages of a thread, oldest first, one row per Message-ID (a cached one if there is one). */
export function threadRows(thread: string, accounts: string[]): MsgRow[] {
	if (!accounts.length) return [];
	const rows = mdb
		.query<MsgRow, string[]>(
			`SELECT * FROM msg WHERE thread = ? AND account IN (${accounts.map(() => '?').join(',')}) ORDER BY date, cached DESC`
		)
		.all(thread, ...accounts);
	// one row per message: a copy that was received beats our sent copy (mail between two of our
	// accounts is replied to from the receiving one), then a downloaded one
	const rank = (r: MsgRow) => (r.folder === 'sent' ? 2 : 0) + (r.cached ? 0 : 1);
	const best = new Map<string, MsgRow>();
	for (const r of rows) {
		const b = best.get(r.msgid);
		if (!b || rank(r) < rank(b)) best.set(r.msgid, r);
	}
	return rows.filter((r) => best.get(r.msgid) === r);
}

/** Full-text search for the palette: subject, sender and body (bodies only of cached messages). */
export function searchMail(text: string, accounts: string[], limit = 20): SearchHit[] {
	const terms = text.match(/[\p{L}\p{N}_-]+/gu);
	if (!terms || !accounts.length) return [];
	const match = terms.map((t) => `"${t}"*`).join(' ');
	const rows = mdb
		.query<{ thread: string; subject: string; snippet: string }, (string | number)[]>(
			`SELECT msg.thread, msg.subject, snippet(mail_fts, 2, char(1), char(2), '…', 12) AS snippet
			FROM mail_fts JOIN msg ON msg.id = mail_fts.rowid
			WHERE mail_fts MATCH ? AND msg.account IN (${accounts.map(() => '?').join(',')})
			ORDER BY bm25(mail_fts, 5, 3, 1) LIMIT ?`
		)
		.all(match, ...accounts, limit * 3);
	const seen = new Set<string>();
	return rows
		.filter((r) => !seen.has(r.thread) && seen.add(r.thread))
		.slice(0, limit)
		.map((r) => ({
			coll: 'mail',
			id: r.thread,
			project: null,
			title: r.subject || '(no subject)',
			snippet: escapeHtml(r.snippet).replaceAll('\x01', '<mark>').replaceAll('\x02', '</mark>')
		}));
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export const ensureDir = (account: string) =>
	mkdirSync(join(MAIL_DIR, account.replace(/[^\w-]/g, '_')), { recursive: true });

/** Addresses seen in the cache for the To field: senders, and whom we wrote to (Sent). */
export function contacts(q: string, accounts: string[], limit = 8) {
	if (!accounts.length || !q.trim()) return [];
	const like = `%${q.trim().toLowerCase()}%`;
	const marks = accounts.map(() => '?').join(',');
	return mdb
		.query<{ name: string; address: string }, string[]>(
			`WITH a AS (
				SELECT from_name AS name, lower(from_addr) AS address FROM msg WHERE account IN (${marks})
				UNION ALL
				SELECT json_extract(j.value, '$.name'), lower(json_extract(j.value, '$.address'))
				FROM msg, json_each(msg.to_json) AS j WHERE msg.folder = 'sent' AND msg.account IN (${marks}))
			SELECT max(name) AS name, address FROM a
			WHERE address != '' AND (address LIKE ? OR lower(name) LIKE ?)
			GROUP BY address ORDER BY count(*) DESC LIMIT ${Math.floor(limit)}`
		)
		.all(...accounts, ...accounts, like, like);
}

/** Did someone else write in the thread after `since` (the reply we were waiting for)? */
export function answered(thread: string, since: string, own: string[]) {
	const rows = mdb
		.query<{ from_addr: string }, [string, string]>(
			"SELECT from_addr FROM msg WHERE thread = ? AND date >= ? AND folder != 'sent'"
		)
		.all(thread, since.slice(0, 19)); // arrival times (INTERNALDATE) have whole seconds
	const mine = new Set(own.map((a) => a.toLowerCase()));
	return rows.some((r) => r.from_addr && !mine.has(r.from_addr.toLowerCase()));
}

/** The thread of a message we have already (to join a reply to its conversation even when its
 *  References don't name the conversation's first message). */
export const threadOfMsgid = (msgid: string) =>
	mdb
		.query<{ thread: string }, [string]>('SELECT thread FROM msg WHERE msgid = ? LIMIT 1')
		.get(msgid)?.thread ?? null;

// Invitations already handled (by UID, with the highest SEQUENCE seen): a declined or deleted
// event must not come back with the next sync.
mdb.run('CREATE TABLE IF NOT EXISTS invites (uid TEXT PRIMARY KEY, seq INTEGER NOT NULL)');
export const inviteSeq = (uid: string) =>
	mdb.query<{ seq: number }, [string]>('SELECT seq FROM invites WHERE uid = ?').get(uid)?.seq ??
	null;
export const setInviteSeq = (uid: string, seq: number) =>
	mdb.query('INSERT OR REPLACE INTO invites (uid, seq) VALUES (?, ?)').run(uid, seq);

/** Cached inbox messages with a calendar part from `since` on (invitations to look at). */
export const inviteRows = (account: string, since: string) =>
	mdb
		.query<MsgRow, [string, string]>(
			"SELECT * FROM msg WHERE account = ? AND folder = 'inbox' AND invite = 1 AND cached = 1 AND date >= ? ORDER BY date"
		)
		.all(account, since);

/** One-time conversion: a message without a Message-ID got the placeholder `…@planner.invalid`
 *  until 2026-11-24 (now `…@commonplace.invalid`). Its cached `.eml` is named after the id, so it
 *  moves too; the thread id stays, so "later", projects and links to the mail are kept. */
export const renameLegacyIds = mdb.transaction(() => {
	const rows = mdb
		.query<{ account: string; msgid: string }, []>(
			"SELECT DISTINCT account, msgid FROM msg WHERE msgid LIKE '%@planner.invalid>'"
		)
		.all();
	const to = (id: string) => id.replace(/@planner\.invalid>$/, '@commonplace.invalid>');
	for (const r of rows) {
		const [from, dest] = [emlPath(r.account, r.msgid), emlPath(r.account, to(r.msgid))];
		if (existsSync(from) && !existsSync(dest)) renameSync(from, dest);
	}
	for (const t of ['msg', 'triage'])
		mdb.run(
			`UPDATE ${t} SET msgid = replace(msgid, '@planner.invalid>', '@commonplace.invalid>') WHERE msgid LIKE '%@planner.invalid>'`
		);
	mdb.run(
		"UPDATE ops SET args = replace(args, '@planner.invalid>', '@commonplace.invalid>') WHERE args LIKE '%@planner.invalid>%'"
	);
	return rows.length;
});
renameLegacyIds();
