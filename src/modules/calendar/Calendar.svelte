<script lang="ts">
	import { Calendar, type EventDropInfo } from 'fullcalendar';
	import dayGrid from 'fullcalendar/daygrid';
	import timeGrid from 'fullcalendar/timegrid';
	import multiMonth from 'fullcalendar/multimonth';
	import interaction, { Draggable } from 'fullcalendar/interaction';
	import forma from 'fullcalendar/themes/forma';
	import 'fullcalendar/skeleton.css';
	import 'fullcalendar/themes/forma/theme.css';
	import { api, batch, create, db, featureOn, settings, update } from '#lib/data.svelte.ts';
	import { columns, eventToFc, feedVisible, isOpen, localIso, taskToEvents } from '#lib/tasks.ts';
	import { inFocus, ui } from '#lib/ui.svelte.ts';
	import { choose } from '#lib/choice.svelte.ts';
	import { bindKeys } from '#lib/shortcuts.ts';
	import { service, slot } from '#lib/slots.svelte.ts';
	import type { CalEvent, FeedEvent } from '#lib/types.ts';
	import { addDays, format, getISOWeek, isSameMonth, isSameYear, isToday } from 'date-fns';
	import { untrack, type Snippet } from 'svelte';
	import { Button } from '#lib/components/ui/button/index.ts';
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import FileText from '@lucide/svelte/icons/file-text';
	import SquareCheck from '@lucide/svelte/icons/square-check';

	let {
		dragSource,
		onFeedEvent,
		onTaskDrag,
		aside
	}: {
		dragSource?: HTMLElement;
		onFeedEvent?: (e: FeedEvent | null) => void;
		/** A scheduled task is being dragged in the grid (it can be dropped on `dragSource`). */
		onTaskDrag?: (dragging: boolean) => void;
		/** Shown right of the grid, below the header (the tasks pane). */
		aside?: Snippet;
	} = $props();

	// header: title, subtitle and the current view (FC's own toolbar is off)
	let title = $state('');
	let subtitle = $state('');
	let view = $state('');
	const views = [
		{ type: 'timeGridDay', label: 'Day' },
		{ type: 'timeGridWeek', label: 'Week' },
		{ type: 'month', label: 'Month' }
	];
	function setTitle() {
		if (!cal) return;
		const v = cal.view;
		view = v.type;
		const s = v.currentStart;
		if (v.type === 'timeGridDay') {
			title = format(s, 'EEEE, d MMMM yyyy');
			subtitle = isToday(s) ? 'Today' : '';
		} else if (v.type === 'timeGridWeek') {
			const e = addDays(v.currentEnd, -1);
			const from = isSameMonth(s, e) ? 'd' : isSameYear(s, e) ? 'd MMMM' : 'd MMMM yyyy';
			title = `${format(s, from)} – ${format(e, 'd MMMM yyyy')}`;
			subtitle = `Week ${getISOWeek(addDays(s, 3))}`;
		} else {
			subtitle = '';
			monthTitle();
		}
	}

	// --- how entries look (grey block + colour dot, see layout.css `.ev`)
	const esc = (s: string) =>
		s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
	const svg = (cls: string, d: string) =>
		`<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
	const FLAG = '<path d="M5 21V4M5 4h13l-3 5 3 5H5"/>';
	const REPEAT =
		'<path d="m17 2 4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/>';
	const hm = (d: Date | null) => (d ? format(d, 'HH:mm') : '');
	type Arg = {
		event: import('fullcalendar').EventApi;
		timeText: string;
		view: { type: string };
	};
	/** Inner markup of an entry: mark (dot / ring for feeds / square for tasks / flag for
	 *  deadlines), title and time; blocks in the time grid put the time on a line of its own. */
	function entryContent({ event: ev, timeText, view: v }: Arg) {
		const p = ev.extendedProps;
		const deadline = ev.id.startsWith('deadline:');
		const own = sourceOf(p.kind)?.mark;
		const mark = deadline
			? svg('ev-flag', FLAG)
			: own
				? svg('ev-flag', own)
				: ev.color || p.kind === 'task'
					? '<span class="ev-mark"></span>'
					: '';
		const t = `<span class="ev-tt">${esc(ev.title)}</span>`;
		const block = v.type.startsWith('timeGrid') && !ev.allDay;
		if (!block)
			return {
				html: `<div class="ev-line ev-row">${mark}${timeText ? `<span class="ev-time">${timeText}</span>` : ''}${t}</div>`
			};
		const mins = ev.end && ev.start ? (ev.end.getTime() - ev.start.getTime()) / 60_000 : 60;
		if (mins <= 30)
			return {
				html: `<div class="ev-line">${mark}${t}<span class="ev-time">${hm(ev.start)}</span></div>`
			};
		const time = timeText || `${hm(ev.start)} – ${hm(ev.end)}`;
		return {
			html:
				`<div class="ev-line">${mark}${t}</div>` +
				`<div class="ev-time">${time}${p.repeats ? svg('ev-rep', REPEAT) : ''}</div>` +
				(p.location ? `<div class="ev-time">${esc(p.location)}</div>` : '')
		};
	}
	function entryClass({ event: ev }: { event: import('fullcalendar').EventApi }) {
		const kind = ev.id.startsWith('deadline:') ? 'deadline' : ev.extendedProps.kind;
		return `ev ev-${kind}${ev.color ? '' : ' ev-nc'}`;
	}

	let el: HTMLDivElement;
	let cal: Calendar | undefined;

	const colorOf = (d: { categoryId?: string | null; projectId?: string | null }) =>
		(d.categoryId && db.categories.items[d.categoryId]?.color) ||
		(d.projectId && db.projects.items[d.projectId]?.color) ||
		undefined;

	const events = $derived(db.events.all.filter(inFocus));
	// what other modules add (mail put off until later)
	const sources = $derived(slot('calendarSources'));
	const sourceOf = (kind: string) => sources.find((x) => x.kind === kind);
	const sourceEntries = () => sources.flatMap((x) => x.entries());
	// done/cancelled tasks are left out; the "Tasks" toolbar button hides tasks altogether
	let showTasks = $state(localStorage.getItem('calTasks') !== 'hide');
	const tasks = $derived(
		showTasks && featureOn('tasks')
			? db.tasks.all
					.filter((t) => isOpen(t) && inFocus(t))
					.flatMap((t) => taskToEvents(t, colorOf(t)))
			: []
	);
	function toggleTasks() {
		showTasks = !showTasks;
		localStorage.setItem('calTasks', showTasks ? 'show' : 'hide');
	}

	const savedView = () => {
		const v = localStorage.getItem('calView');
		return v === 'dayGridMonth' ? 'month' : (v ?? 'timeGridWeek');
	};

	// --- Month view: 12 stacked months. Scrolling near either end shifts the range by a month and
	// keeps the month under the viewport top in place, so it reads as one endless list.
	const monthScroller = () =>
		el.querySelector<HTMLElement>('[role=list]:has(> [role=listitem] > [role=table][data-date])')
			?.parentElement;
	/** Topmost visible month and its offset from the scroller top. */
	function topMonth(s: HTMLElement) {
		const top = s.getBoundingClientRect().top;
		for (const m of s.querySelectorAll<HTMLElement>('[role=table][data-date]')) {
			const r = m.getBoundingClientRect();
			if (r.bottom > top + 40) return { key: m.dataset.date!, off: r.top - top };
		}
	}
	/** The toolbar title follows the scrolled-to month (FC would show the whole 12-month range). */
	function monthTitle() {
		const s = cal?.view.type === 'month' && monthScroller();
		const t = s && topMonth(s);
		if (t) title = format(new Date(`${t.key}-01T00:00`), 'MMMM yyyy');
	}
	let shifting = false;
	async function onMonthScroll() {
		const s = cal?.view.type === 'month' && monthScroller();
		if (!s) return;
		monthTitle();
		const left = s.scrollHeight - s.scrollTop - s.clientHeight;
		const dir = s.scrollTop < 150 ? -1 : left < 150 ? 1 : 0;
		if (!dir || shifting) return;
		shifting = true;
		const anchor = topMonth(s);
		if (dir < 0) cal!.prev();
		else cal!.next();
		await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
		const s2 = monthScroller();
		const m = anchor && s2?.querySelector(`[role=table][data-date="${anchor.key}"]`);
		if (s2 && m)
			s2.scrollTop += m.getBoundingClientRect().top - s2.getBoundingClientRect().top - anchor.off;
		monthTitle();
		shifting = false;
	}

	// Clicks FC doesn't handle the way we want, caught on window (capture) so they run before FC's
	// document listeners and don't start a drag-select / draft:
	// - the whole top strip of a month-view day cell (not only the small day number) opens the day
	// - timed tasks in week/day view are background events (FC gives those no clicks): open the task
	function onCapture(ev: Event) {
		const t = ev.target as Element | null;
		if (!t?.closest || !el.contains(t)) return;
		const top =
			cal?.view.type === 'month' &&
			t.closest<HTMLElement>('[role=cell][data-date] > [role=presentation]:first-child');
		const task = !top && taskAt(ev as MouseEvent);
		if (!top && !task) return;
		ev.stopPropagation();
		if (ev.type !== 'click') return;
		ev.preventDefault();
		if (top) cal!.changeView('timeGridDay', top.parentElement!.dataset.date);
		else if (task) {
			ui.event = null;
			ui.task = task.dataset.taskId!;
		}
	}

	/** Background task under the pointer, unless a real event lies above it there. (FC's event
	 *  layer covers the whole column, so the task element itself never receives the click.) */
	function taskAt(e: MouseEvent) {
		if (!cal?.view.type.startsWith('timeGrid')) return null;
		for (const n of document.elementsFromPoint(e.clientX, e.clientY)) {
			if (n.closest('[data-task-id]')) return n.closest<HTMLElement>('[data-task-id]');
			if (n.closest('[role=button]')) return null; // an event (or the draft) is on top
		}
		return null;
	}

	/** Hover look + pointer cursor for a background task wherever no event covers it (CSS :hover
	 *  only reaches the column edges, the rest is under FC's event layer). */
	let hovered: HTMLElement | null = null;
	function onTaskHover(e: PointerEvent) {
		const t = e.type === 'pointerleave' || e.buttons ? null : taskAt(e);
		if (t === hovered) return;
		hovered?.classList.remove('task-hover');
		t?.classList.add('task-hover');
		el.classList.toggle('cal-task-hover', !!t);
		hovered = t;
	}

	/** The view the entries of tasks are made for. FC fetches for a new view while `cal.view` is
	 *  still the old one (and not at all if it has the range already), so `datesSet` keeps this
	 *  and refetches. */
	let viewType = savedView();
	/**
	 * Tasks per view. Month: only the deadline markers. Week/day: timed tasks become muted
	 * background events, so they never take width away from events lying on top of them; those
	 * that overlap stand side by side in columns of their own (`tc-n<columns> tc-i<column>`).
	 */
	function taskEntries() {
		if (viewType === 'month') return tasks.filter((e) => e.id.startsWith('deadline:'));
		if (!viewType.startsWith('timeGrid')) return tasks;
		const timed = tasks.filter((e) => !e.allDay);
		const cols = columns(timed.map((e) => [Date.parse(e.start), Date.parse(e.end!)]));
		return tasks.map((e) => {
			if (e.allDay) return e;
			const { i, n } = cols[timed.indexOf(e)];
			const col = n > 1 ? ` tc-n${Math.min(n, 8)} tc-i${i % 8}` : '';
			return { ...e, display: 'background', className: `${e.className} task-bg${col}` };
		});
	}

	const iso = (d: Date, allDay: boolean) => (allDay ? localIso(d, true) : d.toISOString());

	/** Event moved/resized; a recurring one asks whether to change this occurrence or the series.
	 *  `time`: the occurrence belongs to that one of the event's further times (`CalEvent.times`). */
	async function moveEvent(
		e: CalEvent,
		oldStart: Date,
		start: Date,
		end: Date | null,
		allDay: boolean,
		time?: number
	) {
		const endIso = end ? iso(end, allDay) : undefined;
		const t = time === undefined ? e : e.times?.[time];
		if (!t) return;
		// all times of an event are all-day or none is: one of them can't change sides alone
		if (e.times?.length && allDay !== !!e.allDay) return;
		const set = (p: { start: string; end?: string }) =>
			time === undefined
				? update('events', e.id, { ...p, allDay })
				: update('events', e.id, {
						times: e.times!.map((x, i) => (i === time ? { ...x, ...p } : x))
					});
		if (!t.rrule) return set({ start: iso(start, allDay), end: endIso });
		const to = allDay
			? format(start, 'EEE d MMM')
			: `${format(start, 'EEE d MMM, HH:mm')}${end ? ` – ${format(end, 'HH:mm')}` : ''}`;
		// the last option is the primary button
		const scope = await choose(
			'Change recurring event',
			[
				{ value: 'all', label: 'All events' },
				{ value: 'this', label: 'Only this one' }
			],
			`${e.title} moves to ${to}.`
		);
		if (scope === 'this')
			return batch(async () => {
				await update('events', e.id, {
					exdates: [...(e.exdates ?? []), localIso(oldStart, e.allDay)]
				});
				const {
					id: _i,
					rrule: _r,
					exdates: _x,
					times: _t,
					createdAt: _c,
					updatedAt: _u,
					...rest
				} = e;
				await create('events', { ...rest, start: iso(start, allDay), end: endIso, allDay });
			});
		if (scope === 'all') {
			const shift = start.getTime() - oldStart.getTime();
			const dur = end ? end.getTime() - start.getTime() : 0;
			const s = new Date(new Date(t.start).getTime() + shift);
			await set({
				start: iso(s, allDay),
				end: end ? iso(new Date(s.getTime() + dur), allDay) : undefined
			});
		}
	}

	async function onMove(info: Pick<EventDropInfo, 'event' | 'oldEvent' | 'revert'>) {
		const { kind, id, time } = info.event.extendedProps as {
			kind: string;
			id: string;
			time?: number;
		};
		const { start, end, allDay } = info.event;
		const oldStart = info.oldEvent.start!;
		info.revert(); // the store re-renders the calendar
		if (!start) return;
		if (kind === 'draft' && ui.draft) {
			Object.assign(ui.draft, {
				start: iso(start, allDay),
				end: end ? iso(end, allDay) : undefined,
				allDay
			});
			return;
		}
		if (kind === 'task') {
			if (info.event.id.startsWith('deadline:'))
				return update('tasks', id, { deadline: localIso(start, true) });
			return update('tasks', id, { start: iso(start, allDay), end: end ? iso(end, allDay) : null });
		}
		const own = sourceOf(kind);
		if (own) return own.move?.(id, start, end);
		if (kind === 'event') await moveEvent(db.events.items[id], oldStart, start, end, allDay, time);
	}

	// Rebuilt only when firstDay changes; everything else is read untracked: render() runs the
	// event-source functions synchronously, which made ui.draft/events/tasks dependencies, so
	// every new draft rebuilt the calendar on today's date.
	let lastDate: Date | undefined;
	$effect(() => {
		const firstDay = settings().firstDay;
		return untrack(() => setup(firstDay));
	});

	function setup(firstDay: number | undefined) {
		cal = new Calendar(el, {
			...(lastDate && { initialDate: lastDate }),
			plugins: [dayGrid, timeGrid, multiMonth, interaction, forma],
			initialView: savedView(),
			headerToolbar: false,
			eventContent: entryContent,
			backgroundEventContent: entryContent,
			eventClass: entryClass,
			backgroundEventClass: entryClass,
			allDayText: 'all day',
			dayHeaderAlign: 'start',
			dayLaneClass: ({ isToday: today }) => today && 'cal-today',
			dayCellClass: ({ isToday: today }) => today && 'cal-today',
			slotMinHeight: 26, // 52px per hour, as in the design
			dayHeaderContent: ({ date, isToday: today, view: v, text }) =>
				v.type.startsWith('timeGrid')
					? {
							html: `<span class="dh"><span class="dh-wd">${format(date, 'EEE')}</span><span class="dh-n${today ? ' dh-today' : ''}">${format(date, 'd')}</span></span>`
						}
					: { html: `<span class="dh-m">${text}</span>` },
			views: {
				timeGrid: { dayMaxEventRows: 2 },
				// stacked months, scrolled vertically (see monthScroll)
				month: {
					type: 'multiMonth',
					duration: { months: 12 },
					dateIncrement: { months: 1 },
					multiMonthMaxColumns: 1,
					dayMaxEvents: 3
				}
			},
			height: '100%',
			firstDay,
			nowIndicator: true,
			navLinks: true,
			selectable: true,
			selectMirror: true,
			editable: true,
			droppable: true,
			snapDuration: '00:15',
			slotDuration: '00:30',
			scrollTime: '07:00',
			slotHeaderFormat: { hour: '2-digit', minute: '2-digit', hour12: false },
			eventTimeFormat: { hour: '2-digit', minute: '2-digit', hour12: false },
			eventSources: [
				{
					id: 'local',
					events: async (info: { start: Date; end: Date }) =>
						$state.snapshot([
							...taskEntries(),
							...events.flatMap((e) => eventToFc(e, info.start, info.end, colorOf(e))),
							...sourceEntries(),
							...(ui.draft?.start
								? [
										{
											id: 'draft',
											title: ui.draft.title,
											start: ui.draft.start,
											end: ui.draft.end,
											allDay: !!ui.draft.allDay,
											extendedProps: { kind: 'draft' }
										}
									]
								: [])
						]) as never
				},
				{
					id: 'feeds',
					events: async (info: { startStr: string; endStr: string }) => {
						const list = await api<FeedEvent[]>(
							`/api/feed_event?start=${info.startStr}&end=${info.endStr}`
						);
						return list
							.filter((f) => {
								const feed = db.feeds.items[f.feedId];
								return feed && feedVisible(feed, ui.project);
							})
							.map((f) => ({
								id: `feed:${f.id}`,
								title: f.title,
								start: f.start,
								end: f.end,
								allDay: f.allDay,
								editable: false,
								...(db.feeds.items[f.feedId].color && { color: db.feeds.items[f.feedId].color }),
								className: f.tentative ? 'feed-event tentative' : 'feed-event',
								extendedProps: { kind: 'feed', doc: f }
							}));
					}
				}
			],
			// only a draft: the event is stored when the editor's "Create" is pressed
			select: ({ start, end, allDay }) => {
				cal!.unselect();
				if (sources.some((x) => x.select?.(start, end))) return;
				ui.event = null;
				ui.task = null;
				onFeedEvent?.(null);
				ui.draft = {
					title: 'New event',
					start: iso(start, allDay),
					end: iso(end, allDay),
					allDay,
					projectId: ui.project
				};
			},
			backgroundEventDidMount: ({ el, event }) => {
				if (event.extendedProps.kind === 'task') el.dataset.taskId = event.extendedProps.id;
			},
			eventClick: ({ event }) => {
				// one floating panel at a time
				const p = event.extendedProps;
				if (p.kind === 'draft') return;
				const own = sourceOf(p.kind);
				if (own) return void own.open?.(p.id);
				ui.task = null;
				ui.event = null;
				if (p.kind === 'task') ui.task = p.id;
				else if (p.kind === 'event')
					ui.event = { id: p.id, occurrence: event.start?.toISOString(), time: p.time };
				onFeedEvent?.(p.kind === 'feed' ? p.doc : null);
			},
			eventDragStart: ({ event }) => {
				if (event.extendedProps.kind === 'task' && event.id.startsWith('task:')) onTaskDrag?.(true);
			},
			eventDrop: onMove,
			eventResize: onMove,
			eventReceive: (info) => {
				const { start, end, allDay } = info.event;
				const id = info.event.extendedProps.taskId as string;
				info.event.remove();
				if (start)
					update('tasks', id, { start: iso(start, allDay), end: end ? iso(end, allDay) : null });
			},
			eventDragStop: ({ event, jsEvent }) => {
				// dropping a scheduled task back onto the task panel unschedules it
				onTaskDrag?.(false);
				const r = dragSource?.getBoundingClientRect();
				const p = event.extendedProps;
				if (
					r &&
					p.kind === 'task' &&
					event.id.startsWith('task:') &&
					jsEvent.clientX >= r.left &&
					jsEvent.clientX <= r.right &&
					jsEvent.clientY >= r.top &&
					jsEvent.clientY <= r.bottom
				)
					update('tasks', p.id, { start: null, end: null });
			},
			datesSet: ({ view }) => {
				localStorage.setItem('calView', view.type);
				if (view.type !== viewType) {
					viewType = view.type;
					cal?.getEventSourceById('local')?.refetch();
				}
				el.classList.toggle('cal-month', view.type === 'month');
				setTitle();
				requestAnimationFrame(setTitle);
			}
		});
		cal.render();
		el.addEventListener('scroll', onMonthScroll, true);
		el.addEventListener('pointermove', onTaskHover);
		el.addEventListener('pointerleave', onTaskHover);
		for (const t of ['pointerdown', 'mousedown', 'click'])
			window.addEventListener(t, onCapture, true);
		const keys = bindKeys({
			t: () => cal!.today(),
			d: () => cal!.changeView('timeGridDay'),
			w: () => cal!.changeView('timeGridWeek'),
			m: () => cal!.changeView('month'),
			j: () => cal!.next(),
			k: () => cal!.prev()
		});
		return () => {
			keys();
			el.removeEventListener('scroll', onMonthScroll, true);
			el.removeEventListener('pointermove', onTaskHover);
			el.removeEventListener('pointerleave', onTaskHover);
			for (const t of ['pointerdown', 'mousedown', 'click'])
				window.removeEventListener(t, onCapture, true);
			lastDate = cal?.getDate();
			cal?.destroy();
		};
	}

	// re-render local entries whenever the store (or the draft) changes
	$effect(() => {
		void [events, tasks, $state.snapshot(ui.draft), sourceEntries()];
		cal?.getEventSourceById('local')?.refetch();
	});

	// refetch external events after a feed sync / feed edit / focus change
	$effect(() => {
		void [
			ui.project,
			JSON.stringify(
				db.feeds.all.map((f) => [f.lastSync, f.color, f.show, f.projectIds, f.enabled])
			)
		];
		cal?.getEventSourceById('feeds')?.refetch();
	});

	$effect(() => {
		if (ui.calendarDate && cal) {
			cal.gotoDate(ui.calendarDate);
			ui.calendarDate = null;
		}
	});

	$effect(() => {
		if (!dragSource) return;
		const d = new Draggable(dragSource, {
			itemSelector: '[data-task]',
			eventData: (item) => {
				const t = db.tasks.items[item.dataset.task!];
				return {
					title: t?.title,
					duration: { minutes: t?.estimate || 60 },
					extendedProps: { taskId: t?.id }
				};
			}
		});
		return () => d.destroy();
	});
</script>

<div class="flex h-full min-h-0 flex-col">
	<header class="flex min-h-15 flex-wrap items-center gap-3 border-b px-4 py-2.5">
		<div class="flex items-center gap-0.5">
			<Button
				size="icon-sm"
				variant="ghost"
				aria-label="Previous"
				title="Previous (k)"
				onclick={() => cal?.prev()}><ChevronLeft /></Button
			>
			<Button
				size="icon-sm"
				variant="ghost"
				aria-label="Next"
				title="Next (j)"
				onclick={() => cal?.next()}><ChevronRight /></Button
			>
		</div>
		<h1 class="text-[17px] font-semibold tracking-tight">{title}</h1>
		{#if subtitle}<span class="text-[13px] text-muted-foreground">{subtitle}</span>{/if}
		<div class="grow"></div>
		<Button variant="outline" size="sm" title="Today (t)" onclick={() => cal?.today()}>Today</Button
		>
		{#if service('openDailyNote')}
			<Button
				variant="outline"
				size="sm"
				onclick={() => cal && service('openDailyNote')?.(cal.getDate())}
				><FileText />Daily note</Button
			>
		{/if}
		{#if featureOn('tasks')}
			<Button
				variant="ghost"
				size="sm"
				class="aria-pressed:bg-muted"
				aria-pressed={showTasks}
				title="Show/hide tasks in the calendar"
				onclick={toggleTasks}><SquareCheck />Tasks</Button
			>
		{/if}
		<div role="group" aria-label="View" class="flex rounded-[9px] bg-muted p-[3px]">
			{#each views as v (v.type)}
				<button
					aria-pressed={view === v.type}
					title="{v.label} ({v.label[0].toLowerCase()})"
					class="h-7 rounded-md px-3 text-[13px] text-muted-foreground aria-pressed:bg-background aria-pressed:font-medium aria-pressed:text-foreground aria-pressed:shadow-xs"
					onclick={() => cal?.changeView(v.type)}>{v.label}</button
				>
			{/each}
		</div>
	</header>
	{#each sources as x (x.kind)}{#if x.banner}<x.banner />{/if}{/each}
	<div class="flex min-h-0 flex-1">
		<div bind:this={el} class="cal min-h-0 min-w-0 flex-1"></div>
		{@render aside?.()}
	</div>
</div>
