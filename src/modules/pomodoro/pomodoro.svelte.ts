// Pomodoro timer. State survives reloads (localStorage); finished work sessions go to `pomodoros`.
import { create, db, settings } from '#lib/data.svelte.ts';
import { notify } from '#lib/notify.ts';
import { ui } from '#lib/ui.svelte.ts';

type Phase = 'work' | 'short' | 'long';
const KEY = 'pomodoro';

const initial = () => ({
	phase: 'work' as Phase,
	endsAt: null as number | null,
	startedAt: null as number | null,
	remaining: settings().pomodoro.work * 60_000,
	count: 0,
	taskId: null as string | null
});

function restore() {
	try {
		return { ...initial(), ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
	} catch {
		return initial();
	}
}

export const pomo = $state({ ...restore(), now: Date.now() });

function persist() {
	const { now: _now, ...rest } = pomo;
	try {
		localStorage.setItem(KEY, JSON.stringify(rest));
	} catch {
		/* ignore */
	}
}

/** "Focus" / "Break" / "Long break". */
export const PHASES: Record<string, string> = { work: 'Focus', short: 'Break', long: 'Long break' };
/** mm:ss */
export const clock = (ms: number) => {
	const s = Math.ceil(ms / 1000);
	return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

export const remaining = () => Math.max(0, pomo.endsAt ? pomo.endsAt - pomo.now : pomo.remaining);
export const running = () => pomo.endsAt !== null;
/** Running, or paused in the middle of a session (the footer chip shows then). */
export const active = () => running() || pomo.startedAt !== null;

export function start() {
	pomo.endsAt = Date.now() + pomo.remaining;
	pomo.startedAt ??= Date.now();
	persist();
}
export function pause() {
	pomo.remaining = remaining();
	pomo.endsAt = null;
	persist();
}
export const toggle = () => (running() ? pause() : start());

export function reset(phase: Phase = pomo.phase) {
	pomo.phase = phase;
	pomo.endsAt = null;
	pomo.startedAt = null;
	pomo.remaining = settings().pomodoro[phase] * 60_000;
	persist();
}

async function complete() {
	const s = settings().pomodoro;
	if (pomo.phase === 'work') {
		const task = pomo.taskId ? db.tasks.items[pomo.taskId] : null;
		pomo.count++;
		const startedAt = pomo.startedAt ?? Date.now() - s.work * 60_000;
		reset(pomo.count % s.every === 0 ? 'long' : 'short');
		notify('Pomodoro finished', 'Time for a break.');
		await create(
			'pomodoros',
			{
				start: new Date(startedAt).toISOString(),
				end: new Date().toISOString(),
				minutes: s.work,
				taskId: task?.id ?? null,
				projectId: task?.projectId ?? ui.project
			},
			false
		);
	} else {
		reset('work');
		notify('Break is over');
	}
}

setInterval(() => {
	pomo.now = Date.now();
	if (pomo.endsAt && pomo.now >= pomo.endsAt) complete();
}, 1000);
