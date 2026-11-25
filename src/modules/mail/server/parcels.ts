// DHL parcels found in triaged order mail (`trackingOf()` in triage.ts), looked up with DHL's
// "Parcel DE Tracking (Post & Parcel Germany)" API (the one open to private users in Germany): when
// found, then every 3 hours until delivered (30 days at most). Only with `DHL_API_KEY` (an app on
// developer.dhl.com with that API); `DHL_TRACKING_USER`/`DHL_TRACKING_PASSWORD` go into the request's
// `appname`/`password` as DHL's portal says. The server calls DHL, the browser never does. Rows live
// in `parcels` of mail.db (a cache: the mails have the numbers).
import { DomUtils, parseDocument } from 'htmlparser2';
import * as store from './mailstore.ts';
import { triaged } from './mail.ts';
import type { Parcel } from '#modules/mail/triage/triage.ts';

const API = 'https://api-eu.dhl.com/parcel/de/tracking/v0/shipments';
const key = () => process.env.DHL_API_KEY?.trim();
export const parcelsOn = () => !!key();

const EVERY = 3 * 3_600_000;
const GIVE_UP = 30 * 86_400_000;
/** Spread out: at most 250 calls a day, one every 5.5 s. */
const PER_DAY = 250;
const GAP = 5_500;

type Row = { number: string; thread: string; found: string; status: string | null };

/** Parcels of a conversation (the reader). */
export function parcelsOf(thread: string): Parcel[] {
	return store.mdb
		.query<Row, [string]>('SELECT * FROM parcels WHERE thread = ? ORDER BY found')
		.all(thread)
		.map((r) => (r.status ? JSON.parse(r.status) : { number: r.number }));
}

/** New numbers of a mail: kept and looked up soon. */
export function track(numbers: string[], thread: string, msgid: string) {
	if (!parcelsOn()) return;
	const add = store.mdb.query(
		'INSERT OR IGNORE INTO parcels (number, thread, msgid, found) VALUES (?, ?, ?, ?)'
	);
	for (const n of numbers) add.run(n, thread, msgid, new Date().toISOString());
	kick();
}

const esc = (v: string) =>
	v.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** The request: one `<data>` element in the `xml` query parameter. */
export function requestXml(number: string, o: { user?: string; password?: string } = {}) {
	const attrs: Record<string, string> = {
		...(o.user && { appname: o.user }),
		...(o.password && { password: o.password }),
		request: 'd-get-piece-detail',
		'language-code': 'de',
		'piece-code': number
	};
	return `<?xml version="1.0" encoding="UTF-8" standalone="no"?><data ${Object.entries(attrs)
		.map(([k, v]) => `${k}="${esc(v)}"`)
		.join(' ')}/>`;
}

/** "18.03.2026 10:02" → ISO (German local time, like the server's). */
function dhlTime(s?: string) {
	const m = /^(\d{2})\.(\d{2})\.(\d{4}) (\d{2}):(\d{2})/.exec(s ?? '');
	return m ? new Date(+m[3], +m[2] - 1, +m[1], +m[4], +m[5]).toISOString() : undefined;
}

/** What we keep of DHL's XML answer about one number. */
export function parseDhl(number: string, xml: string): Parcel {
	const doc = parseDocument(xml, { xmlMode: true });
	const datas = DomUtils.getElementsByTagName('data', doc.children, true);
	const root = datas[0]?.attribs ?? {};
	const piece = datas.find((d) => d.attribs.name === 'pieceshipment')?.attribs;
	if (!piece || (root.code && root.code !== '0') || (piece['error-status'] ?? '0') !== '0')
		return { number, error: root.error ? `not found yet (${root.error})` : 'not found yet' };
	const events = datas.filter((d) => d.attribs.name === 'pieceEvent').map((d) => d.attribs);
	const last = events.at(-1);
	const status = piece.status || last?.['event-status'];
	const code =
		piece['delivery-event-flag'] === '1' || piece.ice === 'DLVRD'
			? 'delivered'
			: !events.length || /elektronisch|übermittelt|angekündigt/i.test(status ?? '')
				? 'pre-transit'
				: 'transit';
	const location = piece['event-location'] || last?.['event-location'];
	const at = dhlTime(piece['status-timestamp'] || last?.['event-timestamp']);
	return {
		number,
		code,
		...(status && { status: status.replace(/\s+/g, ' ').trim() }),
		...(location && { location }),
		...(at && { at })
	};
}

const today = () => new Date().toISOString().slice(0, 10);
const calls = { day: today(), n: 0 };

/** One number at DHL. Throws on a refused key or the rate limit (the queue stops). */
async function lookUp(number: string): Promise<Parcel> {
	const xml = requestXml(number, {
		user: process.env.DHL_TRACKING_USER?.trim(),
		password: process.env.DHL_TRACKING_PASSWORD
	});
	const res = await fetch(`${API}?xml=${encodeURIComponent(xml)}`, {
		headers: { 'DHL-API-Key': key()!, accept: 'application/xml' },
		signal: AbortSignal.timeout(20_000)
	});
	if (res.status === 401 || res.status === 403)
		throw new Error(
			`DHL refused the request (${res.status}): check DHL_API_KEY and DHL_TRACKING_USER/PASSWORD`
		);
	if (res.status === 429) throw new Error('DHL rate limit');
	if (res.status === 404) return { number, error: 'not found yet' };
	if (!res.ok) return { number, error: `DHL: ${res.status} ${res.statusText}` };
	return parseDhl(number, await res.text());
}

let running = false;
/** Look up what is due, one call every few seconds; announce changes once at the end. */
export async function kick() {
	if (running || !parcelsOn()) return;
	running = true;
	let changed = false;
	try {
		const now = Date.now();
		const due = store.mdb
			.query<Row, [string, string]>(
				`SELECT * FROM parcels WHERE delivered = 0 AND found >= ?
				AND (checked IS NULL OR checked < ?) ORDER BY checked IS NOT NULL, checked LIMIT 50`
			)
			.all(new Date(now - GIVE_UP).toISOString(), new Date(now - EVERY).toISOString());
		const save = store.mdb.query(
			'UPDATE parcels SET status = ?, checked = ?, delivered = ? WHERE number = ?'
		);
		for (const r of due) {
			if (calls.day !== today()) Object.assign(calls, { day: today(), n: 0 });
			if (calls.n >= PER_DAY) break;
			calls.n++;
			const p = await lookUp(r.number);
			const checked = new Date().toISOString();
			const status = JSON.stringify({ ...p, checked });
			if (status !== r.status) changed = true;
			save.run(status, checked, p.code === 'delivered' ? 1 : 0, r.number);
			await new Promise((ok) => setTimeout(ok, GAP));
		}
	} catch (e) {
		console.warn('[parcels]', (e as Error).message);
	} finally {
		running = false;
		if (changed) triaged();
	}
}

/** Every half hour: what is due (each parcel at most every 3 hours). */
export function startParcels() {
	if (!parcelsOn()) return;
	void kick();
	setInterval(() => void kick(), 30 * 60_000);
}
