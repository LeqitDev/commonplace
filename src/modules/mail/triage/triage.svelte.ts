// Mail triage in the browser: the decision model runs on this device (LM Studio on 127.0.0.1) and
// answers the questions about waiting mail while a tab is open; the answers go to the server, so
// every device sees them. Whether this device has a model is a per-browser setting (localStorage).
import { untrack } from 'svelte';
import { api } from '#lib/data.svelte.ts';
import { onMailChange } from '#modules/mail/mail.svelte.ts';
import {
	DEFAULT_MODEL,
	DEFAULT_URL,
	VERSION,
	decide,
	localModel,
	readResponse,
	type Item
} from './triage.ts';

const KEY = 'triage:device';
export interface Device {
	/** Triage new mail with the model on this device. */
	on: boolean;
	url: string;
	model: string;
	/** LM Studio can require an API token. */
	key?: string;
}
const DEFAULTS: Device = { on: false, url: DEFAULT_URL, model: DEFAULT_MODEL };
function load(): Device {
	try {
		return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
	} catch {
		return { ...DEFAULTS };
	}
}
export const device = $state(load());
export function saveDevice(p: Partial<Device>) {
	Object.assign(device, p);
	try {
		localStorage.setItem(KEY, JSON.stringify(device));
	} catch {
		/* storage unavailable: on for this tab only */
	}
}

export const triage = $state({
	running: false,
	/** Answered by this tab since it was opened. */
	done: 0,
	/** On the server: mail of the window still without answers, with answers, corrected answers. */
	waiting: 0,
	total: 0,
	labels: 0,
	error: null as string | null,
	/** How long the last mail took (all rounds). */
	ms: 0
});

type Pending = { items: Item[]; waiting: number; done: number; labels: number };

const model = (d: Device = device) =>
	localModel({ url: d.url, model: d.model, key: d.key || undefined, timeout: 120_000 });

/** What went wrong, in words: a network error means the browser couldn't reach the model at all. */
const explain = (e: unknown) =>
	e instanceof TypeError
		? "The browser couldn't reach the model. Is LM Studio's server running, and is local network access allowed for this site?"
		: e instanceof DOMException && e.name === 'TimeoutError'
			? 'The model took too long to answer.'
			: (e as Error).message;

export async function refreshStatus() {
	const r = await api<Pending>('/api/mail/triage?limit=0');
	Object.assign(triage, { waiting: r.waiting, total: r.done, labels: r.labels });
}

async function run() {
	triage.running = true;
	triage.error = null;
	let failures = 0;
	try {
		for (;;) {
			const r = await api<Pending>('/api/mail/triage?limit=5');
			Object.assign(triage, { waiting: r.waiting, total: r.done, labels: r.labels });
			if (!r.items.length) break;
			for (const item of r.items) {
				if (!device.on) return;
				const t0 = performance.now();
				let answers;
				try {
					answers = await decide(item, model());
					failures = 0;
				} catch (e) {
					// unreachable: stop; one mail the model refuses (too long …): skip it, it comes back later
					if (e instanceof TypeError || ++failures >= 3) throw e;
					triage.error = explain(e);
					continue;
				}
				triage.ms = Math.round(performance.now() - t0);
				await api('/api/mail/triage', {
					method: 'POST',
					body: JSON.stringify({
						msgid: item.msgid,
						model: device.model,
						version: VERSION,
						answers
					})
				});
				triage.done++;
				triage.waiting = Math.max(0, triage.waiting - 1);
			}
		}
	} catch (e) {
		triage.error = explain(e);
	} finally {
		triage.running = false;
	}
}

let again = false;
/** Ask the model about all waiting mail. One tab per browser does it (Web Locks); a call while it
 *  runs makes it look again when done. */
export async function drain() {
	if (!device.on) return;
	if (triage.running) return void (again = true);
	do {
		again = false;
		if (navigator.locks)
			await navigator.locks.request('commonplace-triage', { ifAvailable: true }, async (lock) => {
				if (lock) await run();
			});
		else await run();
	} while (again && device.on && !triage.error);
}

/** While a tab is open: now, after mail came in (`kick` from the mail events) and every 5 minutes. */
export function startTriage(onMail: (fn: () => void) => () => void) {
	const kick = () => void drain();
	kick();
	const off = onMail(kick);
	const timer = setInterval(kick, 300_000);
	return () => {
		off();
		clearInterval(timer);
	};
}

/** One tiny question from a click (which is also when Chrome asks to allow local network access).
 *  Returns how long it took. */
export async function testModel(d: Device = device) {
	const t0 = performance.now();
	const q = { type: 'predicate' as const, name: 'test', instructions: 'Is this a test?' };
	const res = await model(d)({ input: 'This is a test.', questions: [q] }).catch((e) => {
		throw new Error(explain(e));
	});
	readResponse(res, [{ ...q, items: [] }]);
	return Math.round(performance.now() - t0);
}

/** Models the local server has loaded or can load (LM Studio's `/v1/models`). */
export async function listModels(url: string): Promise<string[]> {
	try {
		const res = await fetch(new URL('/v1/models', url), { signal: AbortSignal.timeout(5000) });
		const json = (await res.json()) as { data?: { id: string }[] };
		return (json.data ?? []).map((m) => m.id);
	} catch {
		return [];
	}
}

/** Answers of the window go; this device asks again. */
export async function runAgain() {
	await api('/api/mail/triage', { method: 'DELETE' });
	triage.error = null;
	await refreshStatus();
	void drain();
}

/** The triage module while it is on: this device's model works while a tab is open (if set up). */
export function startModule() {
	return $effect.root(() => {
		$effect(() => {
			if (device.on) return untrack(() => startTriage(onMailChange));
		});
	});
}
