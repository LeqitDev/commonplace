<script lang="ts">
	// Event panel (floating, no scrim). A click on an event shows its details; "Edit" (E) turns the
	// panel into the editor. A new event is a draft (ui.draft) until "Create"; existing events save
	// field by field.
	import FloatingPanel from '#lib/components/app/FloatingPanel.svelte';
	import { Button } from '#lib/components/ui/button/index.ts';
	import { Switch } from '#lib/components/ui/switch/index.ts';
	import AppSelect from '#lib/components/app/AppSelect.svelte';
	import DateInput from '#lib/components/app/DateInput.svelte';
	import MetaFields from '#lib/components/app/MetaFields.svelte';
	import { batch, create, db, remove, update } from '#lib/data.svelte.ts';
	import { ask, choose, confirmAction } from '#lib/choice.svelte.ts';
	import { localIso, parseDate, RECURRENCE_PRESETS } from '#lib/tasks.ts';
	import { service, slot } from '#lib/slots.svelte.ts';
	import { bindKeys } from '#lib/shortcuts.ts';
	import { ui } from '#lib/ui.svelte.ts';
	import type { CalEvent, EventTime } from '#lib/types.ts';
	import { addDays, format } from 'date-fns';
	import { RRule } from 'rrule';
	import X from '@lucide/svelte/icons/x';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Trash from '@lucide/svelte/icons/trash-2';
	import Repeat from '@lucide/svelte/icons/repeat';
	import MapPin from '@lucide/svelte/icons/map-pin';
	import AlignLeft from '@lucide/svelte/icons/align-left';
	import Tag from '@lucide/svelte/icons/tag';
	import FileText from '@lucide/svelte/icons/file-text';
	import Plus from '@lucide/svelte/icons/plus';

	const e = $derived(
		(ui.draft as CalEvent | null) ?? (ui.event ? db.events.items[ui.event.id] : undefined)
	);
	// details first; the editor after "Edit" (a draft is always edited)
	let editingId: string | null = $state(null);
	const edit = $derived(!!ui.draft || (!!ui.event && editingId === ui.event.id));
	const startEdit = () => (editingId = ui.event?.id ?? null);
	$effect(() => {
		if (!ui.event) editingId = null;
	});

	const field = 'h-[34px] w-full rounded-lg border border-line2 bg-transparent px-2.5 outline-none';
	function set(p: Partial<CalEvent> | Record<string, unknown>) {
		if (ui.draft) {
			for (const [k, v] of Object.entries(p))
				if (v === null || v === undefined) delete ui.draft[k as keyof CalEvent];
				else (ui.draft as Record<string, unknown>)[k] = v;
		} else if (e) update('events', e.id, p as Partial<CalEvent>);
	}
	// all-day ends are exclusive internally, shown inclusive
	const shownEnd = (end?: string) =>
		e?.allDay && end ? localIso(addDays(parseDate(end), -1), true) : end;
	const storedEnd = (end: string | null) =>
		end && e?.allDay ? localIso(addDays(parseDate(end), 1), true) : end;
	const presets = Object.entries(RECURRENCE_PRESETS).map(([value, label]) => ({ value, label }));
	const CUSTOM = '?';
	const repeatOptions = (rrule?: string) => [
		...presets,
		...(rrule && !(rrule in RECURRENCE_PRESETS) ? [{ value: rrule, label: rrule }] : []),
		{ value: CUSTOM, label: 'Custom…' }
	];
	async function repeat(v: string, apply: (rrule: string | undefined) => void) {
		const rrule =
			v === CUSTOM ? await ask('Repeat', { placeholder: 'RRULE, e.g. FREQ=MONTHLY;BYDAY=1MO' }) : v;
		if (v !== CUSTOM || rrule) apply(rrule || undefined);
	}

	function toggleAllDay(allDay: boolean) {
		if (!e) return;
		const convert = (t: EventTime) => {
			const s = parseDate(t.start);
			if (allDay) return { start: localIso(s, true), end: localIso(addDays(s, 1), true) };
			s.setHours(9);
			return { start: s.toISOString(), end: new Date(s.getTime() + 3_600_000).toISOString() };
		};
		set({
			allDay,
			...convert(e),
			...(e.times && { times: e.times.map((t) => ({ ...t, ...convert(t) })) })
		});
	}

	// --- further times of the event (CalEvent.times): each has start, end and repeat of its own
	/** The schedule the clicked occurrence belongs to: the event itself or one of its times. */
	const clicked = $derived((ui.event?.time !== undefined && e?.times?.[ui.event.time]) || e);
	const setTimes = (times: EventTime[]) => set({ times: times.length ? times : null });
	const setTime = (i: number, p: Partial<EventTime>) =>
		e?.times && setTimes(e.times.map((t, j) => (j === i ? { ...t, ...p } : t)));
	/** A new time starts as a copy of the event's own, a day later (a rule that names weekdays
	 *  would put it on the same days again: it repeats weekly instead). */
	function addTime() {
		if (!e) return;
		const rrule = e.rrule?.includes('BYDAY') ? 'FREQ=WEEKLY' : e.rrule;
		const next = (s?: string) =>
			s && (e.allDay ? localIso(addDays(parseDate(s), 1), true) : addDays(s, 1).toISOString());
		setTimes([...(e.times ?? []), { start: next(e.start)!, end: next(e.end), rrule }]);
	}

	async function createDraft() {
		if (!ui.draft) return;
		const doc = $state.snapshot(ui.draft);
		ui.draft = null;
		await create('events', doc);
	}

	let confirming = false;
	async function close() {
		if (!ui.draft) return (ui.event = null);
		if (confirming) return;
		confirming = true;
		const discard = await confirmAction(
			'Discard new event?',
			'It has not been created yet.',
			'Discard'
		);
		confirming = false;
		if (discard) ui.draft = null;
	}

	/** Turn the clicked occurrence of a series into its own event. */
	async function detach() {
		if (!e || !ui.event?.occurrence) return;
		const occ = new Date(ui.event.occurrence);
		const t = clicked ?? e;
		const dur = t.end ? new Date(t.end).getTime() - new Date(t.start).getTime() : 3_600_000;
		const { id: _i, rrule: _r, exdates: _x, times: _t, createdAt: _c, updatedAt: _u, ...rest } = e;
		let created = '';
		await batch(async () => {
			await update('events', e.id, { exdates: [...(e.exdates ?? []), localIso(occ, e.allDay)] });
			const n = await create('events', {
				...rest,
				start: e.allDay ? localIso(occ, true) : occ.toISOString(),
				end: e.allDay
					? localIso(new Date(occ.getTime() + dur), true)
					: new Date(occ.getTime() + dur).toISOString()
			});
			created = n.id;
		});
		ui.event = { id: created };
		editingId = created;
	}

	async function del() {
		if (!e) return;
		const occ = ui.event?.occurrence;
		if (clicked?.rrule && occ) {
			const scope = await choose(
				'Delete recurring event',
				[
					{ value: 'this', label: 'Only this one' },
					{ value: 'all', label: 'All events', destructive: true }
				],
				`${e.title}, ${format(new Date(occ), 'EEE d MMM')}. You can undo this.`
			);
			if (!scope) return;
			if (scope === 'this') {
				await update('events', e.id, {
					exdates: [...(e.exdates ?? []), localIso(new Date(occ), e.allDay)]
				});
				ui.event = null;
				return;
			}
		}
		ui.event = null;
		await remove('events', e.id);
	}

	// --- details
	const marker = $derived(
		e
			? (e.categoryId && db.categories.items[e.categoryId]) ||
					(e.projectId && db.projects.items[e.projectId]) ||
					null
			: null
	);
	/** Start and end of the clicked occurrence. */
	const span = $derived.by(() => {
		if (!e || !clicked) return null;
		const start = ui.event?.occurrence ? new Date(ui.event.occurrence) : parseDate(clicked.start);
		const dur = clicked.end
			? parseDate(clicked.end).getTime() - parseDate(clicked.start).getTime()
			: 0;
		return { start, end: new Date(start.getTime() + dur), dur };
	});
	const length = (ms: number) => {
		const m = Math.round(ms / 60_000);
		return m < 60 ? `${m} min` : `${+(m / 60).toFixed(1)} h`;
	};
	function ruleText(t: EventTime) {
		if (!t.rrule) return '';
		try {
			let s = RRule.fromString(t.rrule).toText();
			if (/FREQ=WEEKLY/.test(t.rrule) && !/BYDAY/.test(t.rrule))
				s += ` on ${format(parseDate(t.start), 'EEEE')}`;
			return s[0].toUpperCase() + s.slice(1);
		} catch {
			return t.rrule;
		}
	}
	const otherTimes = $derived(
		e ? [e, ...(e.times ?? [])].filter((t) => t !== clicked && (t.rrule || t.start)) : []
	);
	const timeText = (t: EventTime) =>
		e?.allDay
			? format(parseDate(t.start), 'EEE d MMM')
			: `${format(parseDate(t.start), 'HH:mm')}${t.end ? ` – ${format(parseDate(t.end), 'HH:mm')}` : ''}`;

	$effect(() => {
		if (!e || edit) return;
		return bindKeys({ e: startEdit });
	});
</script>

{#snippet icon(Icon: typeof X, label: string, onclick: () => void)}
	<Button size="icon-sm" variant="ghost" class="text-muted-foreground" aria-label={label} {onclick}
		><Icon /></Button
	>
{/snippet}
{#snippet dot()}
	{#if marker?.color}<span
			class="size-[7px] shrink-0 rounded-full"
			style="background:{marker.color}"
		></span>{/if}
{/snippet}

{#if e}
	<FloatingPanel
		key="event"
		label={ui.draft ? 'New event' : edit ? 'Edit event' : 'Event details'}
		width={edit ? 440 : 372}
		onclose={close}
	>
		{#if !edit && span}
			<!-- details -->
			<div class="flex items-center gap-0.5 pr-2 pl-5 text-muted-foreground">
				<span class="flex min-w-0 grow items-center gap-1.5 text-[11.5px] font-medium">
					{@render dot()}<span class="truncate">{marker?.name ?? ''}</span>
				</span>
				{@render icon(Pencil, 'Edit event', startEdit)}
				{@render icon(Trash, 'Delete event', del)}
				{@render icon(X, 'Close', close)}
			</div>
			<div class="flex min-h-0 flex-col gap-4 overflow-y-auto px-5 pt-0.5 pb-[18px]">
				<div class="flex flex-col gap-0.5">
					<h2 class="text-xl leading-tight font-semibold tracking-tight">{e.title}</h2>
					<div class="text-sm">{format(span.start, 'EEEE, d MMMM')}</div>
					{#if !e.allDay}
						<div class="text-sm tabular-nums">
							{format(span.start, 'HH:mm')}{#if span.dur}{` – ${format(span.end, 'HH:mm')} `}
								<span class="text-[13px] text-muted-foreground">· {length(span.dur)}</span>{/if}
						</div>
					{/if}
				</div>
				<div class="flex flex-col gap-2.5">
					{#if clicked?.rrule || otherTimes.some((t) => t.rrule)}
						<div class="flex gap-3">
							<Repeat class="mt-0.5 size-4 shrink-0 text-muted-foreground" />
							<div>
								{#if clicked?.rrule}<div>{ruleText(clicked)}</div>{/if}
								{#each otherTimes as t, i (i)}
									<div class="text-muted-foreground tabular-nums">
										Also {(ruleText(t) || format(parseDate(t.start), 'EEE d MMM')).replace(
											/^./,
											(c) => c.toLowerCase()
										)}, {timeText(t)}
									</div>
								{/each}
							</div>
						</div>
					{/if}
					{#if e.location}
						<div class="flex gap-3">
							<MapPin class="mt-0.5 size-4 shrink-0 text-muted-foreground" /><span
								>{e.location}</span
							>
						</div>
					{/if}
					{#each slot('itemBadges') as Badge (Badge)}<Badge item={e} />{/each}
					{#if e.description}
						<div class="flex gap-3">
							<AlignLeft class="mt-0.5 size-4 shrink-0 text-muted-foreground" />
							<span class="whitespace-pre-wrap">{e.description}</span>
						</div>
					{/if}
					{#if e.tags?.length}
						<div class="flex items-center gap-3">
							<Tag class="size-4 shrink-0 text-muted-foreground" />
							<span class="flex flex-wrap gap-1">
								{#each e.tags as t (t)}<span
										class="flex h-[22px] items-center rounded-full bg-muted px-2 text-[11.5px]"
										>{t}</span
									>{/each}
							</span>
						</div>
					{/if}
				</div>
			</div>
			<div class="flex items-center gap-2 border-t px-5 py-2.5">
				{#if service('openDailyNote')}<Button
						variant="ghost"
						class="-ml-2.5 text-muted-foreground"
						onclick={() => service('openDailyNote')?.(span.start)}><FileText />Daily note</Button
					>{/if}
				<div class="grow"></div>
				<Button onclick={startEdit}
					>Edit <kbd class="rounded border border-current px-1 text-[11px] opacity-75">E</kbd
					></Button
				>
			</div>
		{:else}
			<!-- editor -->
			<div class="flex items-center gap-2 pr-4 pl-5">
				<span
					class="flex grow items-center gap-1.5 text-[11.5px] font-medium text-muted-foreground"
				>
					{#if ui.draft}New event{:else if e.rrule}<Repeat class="size-3" />Repeats · opened on {span
							? format(span.start, 'EEE d MMM')
							: ''}{:else}Edit event{/if}
				</span>
				{@render icon(X, 'Close', close)}
			</div>
			<div class="flex min-h-0 flex-col gap-3 overflow-y-auto px-5 pt-1 pb-4">
				<!-- svelte-ignore a11y_autofocus -->
				<input
					aria-label="Title"
					placeholder="Title"
					class="-ml-2 h-10 w-[calc(100%+8px)] rounded-lg bg-transparent px-2 text-xl font-semibold tracking-tight outline-none focus:bg-muted"
					value={e.title}
					autofocus={!!ui.draft}
					onchange={(ev) => set({ title: ev.currentTarget.value })}
					onfocus={(ev) => e.title === 'New event' && ev.currentTarget.select()}
					onkeydown={(ev) => {
						if (ev.key !== 'Enter' || !ui.draft) return;
						ev.preventDefault();
						set({ title: ev.currentTarget.value });
						createDraft();
					}}
				/>

				<div class="grid grid-cols-[84px_minmax(0,1fr)] items-center gap-y-2">
					<span class="text-muted-foreground">All day</span>
					<div><Switch checked={!!e.allDay} onCheckedChange={toggleAllDay} /></div>
					<span class="text-muted-foreground">Start</span>
					<DateInput value={e.start} dateOnly={e.allDay} onchange={(v) => v && set({ start: v })} />
					<span class="text-muted-foreground">End</span>
					<DateInput
						value={shownEnd(e.end)}
						dateOnly={e.allDay}
						onchange={(v) => set({ end: storedEnd(v) })}
					/>
					<span class="text-muted-foreground">Repeat</span>
					<AppSelect
						value={e.rrule ?? ''}
						options={repeatOptions(e.rrule)}
						onchange={(v) => repeat(v, (rrule) => set({ rrule: rrule ?? null, exdates: null }))}
					/>
				</div>

				{#each e.times ?? [] as t, i (i)}
					<div class="flex flex-col gap-1.5 rounded-[10px] border bg-panel px-3 pt-2 pb-3">
						<div class="flex items-center">
							<span class="grow text-[11.5px] font-medium text-muted-foreground">Another time</span>
							<Button
								size="icon-xs"
								variant="ghost"
								class="-mr-1.5 text-muted-foreground"
								aria-label="Remove this time"
								onclick={() => setTimes(e.times!.filter((_, j) => j !== i))}><X /></Button
							>
						</div>
						<div class="grid grid-cols-[71px_minmax(0,1fr)] items-center gap-y-2">
							<span class="text-muted-foreground">Start</span>
							<DateInput
								value={t.start}
								dateOnly={e.allDay}
								onchange={(v) => v && setTime(i, { start: v })}
							/>
							<span class="text-muted-foreground">End</span>
							<DateInput
								value={shownEnd(t.end)}
								dateOnly={e.allDay}
								onchange={(v) => setTime(i, { end: storedEnd(v) ?? undefined })}
							/>
							<span class="text-muted-foreground">Repeat</span>
							<AppSelect
								value={t.rrule ?? ''}
								options={repeatOptions(t.rrule)}
								onchange={(v) => repeat(v, (rrule) => setTime(i, { rrule }))}
							/>
						</div>
					</div>
				{/each}
				<button
					class="flex h-7 items-center gap-1.5 self-start text-muted-foreground hover:text-foreground"
					title="The same event at a further time, e.g. on another weekday at another hour"
					onclick={addTime}><Plus class="size-4" />Add another time</button
				>

				<div class="h-px bg-border"></div>

				<div class="grid grid-cols-[84px_minmax(0,1fr)] items-center gap-y-2">
					<span class="text-muted-foreground">Tentative</span>
					<div>
						<Switch
							checked={!!e.tentative}
							onCheckedChange={(v) => set({ tentative: v || null })}
						/>
					</div>
					<label for="ev-loc" class="text-muted-foreground">Location</label>
					<input
						id="ev-loc"
						class={field}
						placeholder="Add a place"
						value={e.location ?? ''}
						onchange={(ev) => set({ location: ev.currentTarget.value || null })}
					/>
					<MetaFields coll="events" doc={e} {set} />
				</div>
				<textarea
					aria-label="Description"
					class="min-h-20 rounded-lg border border-line2 bg-transparent px-2.5 py-2 outline-none"
					placeholder="Description"
					value={e.description ?? ''}
					onchange={(ev) => set({ description: ev.currentTarget.value || null })}></textarea>
			</div>
			<div class="flex flex-wrap items-center gap-2 border-t px-5 py-3">
				{#if ui.draft}
					<div class="grow"></div>
					<Button variant="outline" onclick={close}>Cancel</Button>
					<Button onclick={createDraft}
						>Create <kbd class="rounded border border-current px-1 text-[11px] opacity-75"
							>Enter</kbd
						></Button
					>
				{:else}
					<Button variant="ghost" class="-ml-2.5 text-muted-foreground" onclick={del}
						><Trash />Delete</Button
					>
					<div class="grow"></div>
					{#if clicked?.rrule && ui.event?.occurrence}
						<Button variant="outline" onclick={detach}>Edit only this occurrence</Button>
					{:else}
						<Button variant="outline" onclick={() => (editingId = null)}>Done</Button>
					{/if}
				{/if}
			</div>
		{/if}
	</FloatingPanel>
{/if}
