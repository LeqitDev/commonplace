import { batch, create, db, remove, update } from '#lib/data.svelte.ts';
import { nextInstance } from '#lib/tasks.ts';
import type { Task } from '#lib/types.ts';

/** Complete/reopen a task; completing a recurring task spawns its next instance. */
export function setDone(t: Task, done: boolean) {
	return batch(async () => {
		await update('tasks', t.id, {
			status: done ? 'done' : 'todo',
			completedAt: done ? new Date().toISOString() : null
		});
		const next = done && nextInstance(t);
		if (next) {
			await create('tasks', next);
			await update('tasks', t.id, { rrule: null });
		}
	});
}

export const children = (id: string) => db.tasks.all.filter((t) => t.parentId === id);

/** Delete a task with all its subtasks as one undo step. */
export function deleteTask(id: string) {
	const rec = async (tid: string) => {
		for (const c of children(tid)) await rec(c.id);
		await remove('tasks', tid);
	};
	return batch(() => rec(id));
}
