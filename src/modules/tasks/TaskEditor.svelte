<script lang="ts">
	// Task panel (floating, no scrim): details first, "Edit" (E) turns it into the editor.
	import FloatingPanel from '#lib/components/app/FloatingPanel.svelte';
	import { Button } from '#lib/components/ui/button/index.ts';
	import { Checkbox } from '#lib/components/ui/checkbox/index.ts';
	import AppSelect from '#lib/components/app/AppSelect.svelte';
	import DateInput from '#lib/components/app/DateInput.svelte';
	import MetaFields from '#lib/components/app/MetaFields.svelte';
	import { create, db, update } from '#lib/data.svelte.ts';
	import { askNotificationPermission } from '#lib/notify.ts';
	import { bindKeys } from '#lib/shortcuts.ts';
	import { children, deleteTask, setDone } from './taskActions.ts';
	import { parseDate, RECURRENCE_PRESETS } from '#lib/tasks.ts';
	import { ui } from '#lib/ui.svelte.ts';
	import { PRIORITIES, STATUSES, type Task } from '#lib/types.ts';
	import { slot } from '#lib/slots.svelte.ts';
	import { differenceInCalendarDays, format } from 'date-fns';
	import X from '@lucide/svelte/icons/x';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Trash from '@lucide/svelte/icons/trash-2';
	import Bell from '@lucide/svelte/icons/bell';
	import AlignLeft from '@lucide/svelte/icons/align-left';
	import Repeat from '@lucide/svelte/icons/repeat';
	import ArrowUp from '@lucide/svelte/icons/arrow-up';
	import Plus from '@lucide/svelte/icons/plus';

	const t = $derived(ui.task ? db.tasks.items[ui.task] : undefined);
	const subs = $derived(t ? children(t.id) : []);
	const parent = $derived(t?.parentId ? db.tasks.items[t.parentId] : undefined);
	const field = 'h-[34px] w-full rounded-lg border border-line2 bg-transparent px-2.5 outline-none';
	const set = (p: Partial<Task>) => t && update('tasks', t.id, p);

	let editingId: string | null = $state(null);
	const edit = $derived(!!t && editingId === t.id);
	const startEdit = () => (editingId = ui.task);
	$effect(() => {
		if (!ui.task) editingId = null;
	});
	$effect(() => {
		if (!t || edit) return;
		return bindKeys({ e: startEdit });
	});

	function addReminder() {
		if (!t) return;
		askNotificationPermission();
		const base = t.start ?? (t.deadline ? `${t.deadline}T09:00:00` : null);
		const at = base
			? new Date(new Date(base).getTime() - 15 * 60_000)
			: new Date(Date.now() + 3_600_000);
		set({ reminders: [...(t.reminders ?? []), at.toISOString()] });
	}

	async function addSub(e: KeyboardEvent & { currentTarget: HTMLInputElement }) {
		const input = e.currentTarget;
		const title = input.value.trim();
		if (e.key !== 'Enter' || !t || !title) return;
		input.value = '';
		await create('tasks', { title, parentId: t.id, projectId: t.projectId });
	}

	function close() {
		ui.task = null;
	}
	function del() {
		if (!t) return;
		const id = t.id;
		ui.task = null;
		deleteTask(id);
	}

	// --- details
	const project = $derived(t?.projectId ? db.projects.items[t.projectId] : undefined);
	const color = $derived(
		(t?.categoryId && db.categories.items[t.categoryId]?.color) || project?.color
	);
	const tracked = $derived(
		t ? db.pomodoros.all.filter((p) => p.taskId === t.id).reduce((n, p) => n + p.minutes, 0) : 0
	);
	const doneSubs = $derived(subs.filter((s) => s.status === 'done').length);
	const mins = (m: number) => (m < 60 ? `${m} m` : `${+(m / 60).toFixed(1)} h`);
	const day = (s: string) => format(parseDate(s), 'EEE d MMM');
	const hm = (s: string) => format(parseDate(s), 'HH:mm');
	function until(d: string) {
		const n = differenceInCalendarDays(parseDate(d), new Date());
		return n === 0 ? 'today' : n === 1 ? 'tomorrow' : n > 0 ? `in ${n} days` : `${-n} days ago`;
	}
</script>

{#snippet icon(Icon: typeof X, label: string, onclick: () => void)}
	<Button size="icon-sm" variant="ghost" class="text-muted-foreground" aria-label={label} {onclick}
		><Icon /></Button
	>
{/snippet}
{#snippet chip(text: string, cls = 'bg-muted')}
	<span class="flex h-[22px] items-center gap-1 rounded-full px-2 text-[11.5px] font-medium {cls}"
		>{text}</span
	>
{/snippet}

{#if t}
	<FloatingPanel
		key="task"
		label={edit ? 'Edit task' : 'Task details'}
		width={edit ? 440 : 372}
		onclose={close}
	>
		<div class="flex items-center gap-0.5 pr-2 pl-5 text-muted-foreground">
			<span class="flex min-w-0 grow items-center gap-1.5 text-[11.5px] font-medium">
				{#if color}<span class="size-[7px] shrink-0 rounded-full" style="background:{color}"
					></span>{/if}
				{#if project}<span class="shrink-0">{project.name}</span>{/if}
				{#if project && parent}<span>·</span>{/if}
				{#if parent}<button class="truncate hover:underline" onclick={() => (ui.task = parent.id)}
						>{parent.title}</button
					>{/if}
				{#if !project && !parent}{edit ? 'Edit task' : 'Task'}{/if}
			</span>
			{#if !edit}{@render icon(Pencil, 'Edit task', startEdit)}{/if}
			{@render icon(Trash, 'Delete task', del)}
			{@render icon(X, 'Close', close)}
		</div>

		<div class="flex min-h-0 flex-col gap-3.5 overflow-y-auto px-5 pt-0.5 pb-4">
			<div class="flex flex-col gap-2">
				<div class="flex items-start gap-2.5">
					<Checkbox
						class="mt-1 size-[18px]"
						checked={t.status === 'done'}
						onCheckedChange={(v) => setDone(t, !!v)}
						aria-label="Done"
					/>
					{#if edit}
						<input
							aria-label="Title"
							class="-my-1 -ml-2 h-8 w-full rounded-lg bg-transparent px-2 text-xl leading-tight font-semibold tracking-tight outline-none focus:bg-muted"
							value={t.title}
							onchange={(e) => set({ title: e.currentTarget.value })}
						/>
					{:else}
						<h2
							class="text-xl leading-tight font-semibold tracking-tight"
							class:line-through={t.status === 'done'}
						>
							{t.title}
						</h2>
					{/if}
				</div>
				{#if t.mail}<div class="pl-7">
						{#each slot('itemBadges') as Badge (Badge)}<Badge
								item={t}
								onremove={edit ? () => set({ mail: null }) : undefined}
							/>{/each}
					</div>{/if}
				{#if !edit && (t.status || t.priority || t.tags?.length || t.rrule)}
					<div class="flex flex-wrap gap-1.5 pl-7">
						{#if t.status}{@render chip(t.status, 'bg-primary text-primary-foreground')}{/if}
						{#if t.priority}
							<span
								class="flex h-[22px] items-center gap-1 rounded-full border border-line2 px-2 text-[11.5px] font-medium"
								>{#if t.priority <= 2}<ArrowUp class="size-3" />{/if}{PRIORITIES[t.priority]}</span
							>
						{/if}
						{#if t.rrule}<span
								class="flex h-[22px] items-center gap-1 rounded-full bg-muted px-2 text-[11.5px]"
								><Repeat class="size-3" />{RECURRENCE_PRESETS[t.rrule] ?? 'repeats'}</span
							>{/if}
						{#each t.tags ?? [] as tag (tag)}{@render chip(tag)}{/each}
					</div>
				{/if}
			</div>

			{#if edit}
				<div class="grid grid-cols-[84px_minmax(0,1fr)] items-center gap-y-2">
					<span class="text-muted-foreground">Status</span>
					<AppSelect
						value={t.status}
						placeholder="None"
						options={[
							{ value: '', label: 'None' },
							...STATUSES.map((s) => ({ value: s, label: s }))
						]}
						onchange={(v) => set({ status: (v || null) as Task['status'] })}
					/>
					<span class="text-muted-foreground">Priority</span>
					<AppSelect
						value={t.priority}
						placeholder="None"
						options={[
							{ value: '', label: 'None' },
							...Object.entries(PRIORITIES).map(([value, label]) => ({ value, label }))
						]}
						onchange={(v) => set({ priority: (Number(v) || null) as Task['priority'] })}
					/>
					<span class="text-muted-foreground">Start</span>
					<DateInput value={t.start} onchange={(v) => set({ start: v })} />
					<span class="text-muted-foreground">End</span>
					<DateInput value={t.end} onchange={(v) => set({ end: v })} />
					<span class="text-muted-foreground">Deadline</span>
					<DateInput value={t.deadline} dateOnly onchange={(v) => set({ deadline: v })} />
					<label for="task-est" class="text-muted-foreground">Estimate</label>
					<input
						id="task-est"
						class={field}
						type="number"
						min="0"
						step="15"
						placeholder="minutes"
						value={t.estimate ?? ''}
						onchange={(e) => set({ estimate: Number(e.currentTarget.value) || null })}
					/>
					<span class="text-muted-foreground">Repeat</span>
					<AppSelect
						value={t.rrule}
						options={[
							...Object.entries(RECURRENCE_PRESETS).map(([value, label]) => ({ value, label })),
							...(t.rrule && !(t.rrule in RECURRENCE_PRESETS)
								? [{ value: t.rrule, label: t.rrule }]
								: [])
						]}
						onchange={(v) => set({ rrule: v || null })}
					/>
					<span class="self-start pt-2 text-muted-foreground">Reminders</span>
					<div class="flex flex-col gap-1">
						{#each t.reminders ?? [] as r, i (i)}
							<div class="flex items-center gap-1">
								<DateInput
									value={r}
									onchange={(v) =>
										set({
											reminders: (t.reminders ?? [])
												.map((x, j) => (j === i ? v : x))
												.filter((x): x is string => !!x)
										})}
								/>
								<Button
									size="icon-sm"
									variant="ghost"
									aria-label="Remove reminder"
									onclick={() => set({ reminders: t.reminders?.filter((_, j) => j !== i) })}
									><X /></Button
								>
							</div>
						{/each}
						<button
							class="flex h-7 items-center gap-1.5 self-start text-muted-foreground hover:text-foreground"
							onclick={addReminder}><Plus class="size-4" />Add reminder</button
						>
					</div>
					<MetaFields coll="tasks" doc={t} />
				</div>
				<textarea
					aria-label="Description"
					class="min-h-20 rounded-lg border border-line2 bg-transparent px-2.5 py-2 outline-none"
					placeholder="Description"
					value={t.description ?? ''}
					onchange={(e) => set({ description: e.currentTarget.value || undefined })}></textarea>
			{:else}
				<div
					class="grid grid-cols-3 gap-px overflow-hidden rounded-[10px] border bg-border [&>div]:bg-background [&>div]:px-2.5 [&>div]:py-2"
				>
					<div>
						<div class="text-[11.5px] text-muted-foreground">Scheduled</div>
						{#if t.start}
							<div class="font-medium">{day(t.start)}</div>
							{#if t.start.length > 10}<div class="text-xs text-muted-foreground tabular-nums">
									{hm(t.start)}{t.end ? ` – ${hm(t.end)}` : ''}
								</div>{/if}
						{:else}<div class="text-muted-foreground">Not yet</div>{/if}
					</div>
					<div>
						<div class="text-[11.5px] text-muted-foreground">Deadline</div>
						{#if t.deadline}
							<div class="font-medium">{day(t.deadline)}</div>
							<div class="text-xs text-muted-foreground">{until(t.deadline)}</div>
						{:else}<div class="text-muted-foreground">None</div>{/if}
					</div>
					<div>
						<div class="text-[11.5px] text-muted-foreground">Estimate</div>
						<div class="font-medium">{t.estimate ? mins(t.estimate) : '—'}</div>
						{#if tracked}<div class="text-xs text-muted-foreground">
								{mins(tracked)} tracked
							</div>{/if}
					</div>
				</div>
				{#if t.reminders?.length || t.description}
					<div class="flex flex-col gap-2">
						{#each t.reminders ?? [] as r (r)}
							<div class="flex gap-3">
								<Bell class="mt-0.5 size-4 shrink-0 text-muted-foreground" />
								<span class="tabular-nums">Reminder {day(r)}, {hm(r)}</span>
							</div>
						{/each}
						{#if t.description}
							<div class="flex gap-3">
								<AlignLeft class="mt-0.5 size-4 shrink-0 text-muted-foreground" />
								<span class="whitespace-pre-wrap">{t.description}</span>
							</div>
						{/if}
					</div>
				{/if}
			{/if}

			<div class="flex flex-col gap-1">
				<div class="flex items-center gap-2.5">
					<span class="text-[11.5px] font-medium text-muted-foreground"
						>Subtasks{subs.length ? ` · ${doneSubs} of ${subs.length}` : ''}</span
					>
					{#if subs.length}
						<div
							role="img"
							aria-label="{doneSubs} of {subs.length} done"
							class="h-1 grow overflow-hidden rounded-full bg-muted"
						>
							<div class="h-full bg-primary" style="width: {(doneSubs / subs.length) * 100}%"></div>
						</div>
					{/if}
				</div>
				{#each subs as s (s.id)}
					<div class="flex h-[30px] items-center gap-2.5">
						<Checkbox checked={s.status === 'done'} onCheckedChange={(v) => setDone(s, !!v)} />
						<button
							class="truncate text-left hover:underline"
							class:line-through={s.status === 'done'}
							class:text-muted-foreground={s.status === 'done'}
							onclick={() => (ui.task = s.id)}>{s.title}</button
						>
					</div>
				{/each}
				<input
					class="h-[30px] bg-transparent outline-none placeholder:text-muted-foreground"
					placeholder="+ Add subtask"
					onkeydown={addSub}
				/>
			</div>
		</div>

		<div class="flex items-center gap-2 border-t px-5 py-2.5">
			{#if t.createdAt}<span class="text-[11.5px] text-muted-foreground"
					>Created {format(new Date(t.createdAt), 'd MMM yyyy')}</span
				>{/if}
			<div class="grow"></div>
			{#if edit}
				<Button variant="outline" onclick={() => (editingId = null)}>Done</Button>
			{:else}
				{#each slot('taskActions') as Action (Action)}<Action task={t} />{/each}
				<Button onclick={startEdit}
					>Edit <kbd class="rounded border border-current px-1 text-[11px] opacity-75">E</kbd
					></Button
				>
			{/if}
		</div>
	</FloatingPanel>
{/if}
