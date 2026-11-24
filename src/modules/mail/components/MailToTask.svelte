<script lang="ts">
	// "New task from mail": title, the mail it comes from, a deadline found in the mail, project,
	// priority, estimate; "Archive the mail" (remembered). Enter creates it.
	import FloatingPanel from '#lib/components/app/FloatingPanel.svelte';
	import AppSelect from '#lib/components/app/AppSelect.svelte';
	import DateInput from '#lib/components/app/DateInput.svelte';
	import MailChip from './MailChip.svelte';
	import { Button } from '#lib/components/ui/button/index.ts';
	import { Switch } from '#lib/components/ui/switch/index.ts';
	import { create, db } from '#lib/data.svelte.ts';
	import { archive, linkOf, projectOf, turn } from '#modules/mail/mail.svelte.ts';
	import { PRIORITIES, type Priority } from '#lib/types.ts';
	import { ui } from '#lib/ui.svelte.ts';
	import { untrack } from 'svelte';
	import X from '@lucide/svelte/icons/x';

	const KEY = 'mail:task-archives';
	const stored = () => {
		try {
			return localStorage.getItem(KEY) === 'true';
		} catch {
			return false;
		}
	};

	let title = $state('');
	let deadline = $state<string | null>(null);
	let projectId = $state('');
	let priority = $state('');
	let estimate = $state('');
	let archiveIt = $state(stored());

	// a new panel: fresh fields from the mail
	$effect(() => {
		const t = turn.task;
		if (!t) return;
		untrack(() => {
			title = t.title;
			deadline = t.deadline;
			projectId = projectOf(t.row) ?? '';
			priority = '';
			estimate = '';
		});
	});

	const projects = $derived(
		db.projects.all
			.filter((p) => !p.archived)
			.toSorted((a, b) => a.name.localeCompare(b.name))
			.map((p) => ({ value: p.id, label: p.name }))
	);

	async function createTask() {
		const t = turn.task;
		if (!t || !title.trim()) return;
		turn.task = null;
		try {
			localStorage.setItem(KEY, String(archiveIt));
		} catch {
			/* storage unavailable */
		}
		const task = await create('tasks', {
			title: title.trim(),
			deadline,
			projectId: projectId || null,
			priority: priority ? (Number(priority) as Priority) : null,
			estimate: Number(estimate) || null,
			mail: linkOf(t.row)
		});
		if (archiveIt) await archive(t.row.thread);
		ui.task = task.id;
	}
	const close = () => (turn.task = null);
</script>

{#if turn.task}
	<FloatingPanel key="mail-task" label="New task from mail" width={420} onclose={close}>
		<form
			class="flex flex-col gap-3 px-5 pb-4"
			onsubmit={(e) => {
				e.preventDefault();
				void createTask();
			}}
			onkeydowncapture={(e) => {
				// Enter creates it from anywhere (a focused switch would take it as a click),
				// except on the pickers, where it opens them
				const t = e.target as HTMLElement;
				if (e.key !== 'Enter' || e.shiftKey || t.closest('[aria-haspopup], [role=combobox]'))
					return;
				e.preventDefault();
				e.stopPropagation();
				void createTask();
			}}
		>
			<div class="flex items-center gap-2">
				<span class="flex-1 text-[11.5px] font-medium text-muted-foreground"
					>New task from mail</span
				>
				<Button type="button" size="icon-sm" variant="ghost" title="Close (Esc)" onclick={close}
					><X /></Button
				>
			</div>
			<!-- svelte-ignore a11y_autofocus -->
			<input
				class="h-9 bg-transparent text-[17px] font-semibold tracking-tight outline-none"
				aria-label="Title"
				bind:value={title}
				autofocus
			/>
			<MailChip link={linkOf(turn.task.row)} />
			<div class="grid grid-cols-[6rem_minmax(0,1fr)] items-center gap-x-3 gap-y-2">
				<span class="text-muted-foreground">Deadline</span>
				<div class="flex items-center gap-2">
					<DateInput value={deadline} dateOnly onchange={(v) => (deadline = v)} />
					{#if turn.task.found && deadline === turn.task.deadline}
						<span class="text-[11.5px] text-muted-foreground">found in the mail</span>
					{:else if turn.task.suggested && deadline === turn.task.deadline}
						<span class="text-[11.5px] text-muted-foreground">suggested by triage</span>
					{/if}
				</div>
				<span class="text-muted-foreground">Project</span>
				<AppSelect
					value={projectId}
					placeholder="No project"
					options={[{ value: '', label: 'No project' }, ...projects]}
					onchange={(v) => (projectId = v)}
				/>
				<span class="text-muted-foreground">Priority</span>
				<AppSelect
					value={priority}
					placeholder="None"
					options={[
						{ value: '', label: 'None' },
						...Object.entries(PRIORITIES).map(([value, label]) => ({ value, label }))
					]}
					onchange={(v) => (priority = v)}
				/>
				<span class="text-muted-foreground">Estimate</span>
				<input
					class="h-8 w-28 rounded-md border border-input bg-transparent px-2"
					type="number"
					min="0"
					step="5"
					placeholder="minutes"
					bind:value={estimate}
				/>
			</div>
			<div class="flex items-center gap-2 border-t pt-3">
				<Switch bind:checked={archiveIt} aria-label="Archive the mail" />
				<span class="flex-1 text-muted-foreground">Archive the mail</span>
				<Button type="submit" size="sm" disabled={!title.trim()}
					>Create <kbd class="rounded border border-current px-1 text-[10px] opacity-75">Enter</kbd
					></Button
				>
			</div>
		</form>
	</FloatingPanel>
{/if}
