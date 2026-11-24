<script lang="ts">
	import * as Chart from '#lib/components/ui/chart/index.ts';
	import { BarChart } from 'layerchart';
	import { scaleBand } from 'd3-scale';
	import { format, startOfWeek, subDays } from 'date-fns';
	import { db, settings } from '#lib/data.svelte.ts';
	import { inFocus } from '#lib/ui.svelte.ts';

	const sessions = $derived(db.pomodoros.all.filter(inFocus));
	const day = (d: Date | string) => format(new Date(d), 'yyyy-MM-dd');
	const sum = (xs: { minutes: number }[]) => xs.reduce((s, x) => s + x.minutes, 0);
	const hours = (m: number) => `${Math.floor(m / 60)}h ${m % 60}m`;

	const today = day(new Date());
	const weekStart = startOfWeek(new Date(), {
		weekStartsOn: settings().firstDay as 0 | 1
	}).toISOString();
	const totals = $derived([
		['Today', sum(sessions.filter((s) => day(s.start) === today))],
		['This week', sum(sessions.filter((s) => s.start >= weekStart))],
		['All time', sum(sessions)]
	] as const);

	const perDay = $derived.by(() => {
		const by = Object.groupBy(sessions, (s) => day(s.start));
		return Array.from({ length: 30 }, (_, i) => {
			const d = day(subDays(new Date(), 29 - i));
			return { day: d.slice(8), minutes: sum(by[d] ?? []) };
		});
	});

	const ranked = (key: 'projectId' | 'taskId', name: (id: string) => string | undefined) =>
		Object.entries(
			Object.groupBy(
				sessions.filter((s) => s[key]),
				(s) => s[key]!
			)
		)
			.map(([id, xs]) => ({ name: name(id) ?? '(deleted)', minutes: sum(xs!) }))
			.sort((a, b) => b.minutes - a.minutes)
			.slice(0, 10);
	const projects = $derived(ranked('projectId', (id) => db.projects.items[id]?.name));
	const tasks = $derived(ranked('taskId', (id) => db.tasks.items[id]?.title));
	const config = {
		minutes: { label: 'Minutes', color: 'var(--chart-2)' }
	} satisfies Chart.ChartConfig;
</script>

<div class="mx-auto flex h-full w-full max-w-4xl flex-col gap-8 overflow-y-auto p-6">
	<div class="grid grid-cols-3 gap-4">
		{#each totals as [label, m] (label)}
			<div class="rounded-lg border p-4">
				<div class="text-xs text-muted-foreground">{label}</div>
				<div class="text-2xl font-semibold tabular-nums">{hours(m)}</div>
			</div>
		{/each}
	</div>

	<section>
		<h2 class="mb-2 text-xs font-medium text-muted-foreground uppercase">
			Focus minutes · last 30 days
		</h2>
		<Chart.Container {config} class="h-56 w-full">
			<BarChart
				data={perDay}
				xScale={scaleBand().padding(0.25)}
				x="day"
				axis="x"
				series={[{ key: 'minutes', label: 'Minutes', color: config.minutes.color }]}
			>
				{#snippet tooltip()}<Chart.Tooltip />{/snippet}
			</BarChart>
		</Chart.Container>
	</section>

	<div class="grid grid-cols-2 gap-8">
		{#each [['By project', projects], ['By task', tasks]] as const as [title, rows] (title)}
			<section>
				<h2 class="mb-2 text-xs font-medium text-muted-foreground uppercase">{title}</h2>
				{#each rows as r (r.name)}
					<div class="mb-1.5 text-sm">
						<div class="flex justify-between">
							<span class="truncate">{r.name}</span><span class="text-muted-foreground tabular-nums"
								>{hours(r.minutes)}</span
							>
						</div>
						<div class="h-1 rounded bg-muted">
							<div
								class="h-1 rounded bg-foreground/60"
								style="width:{(r.minutes / rows[0].minutes) * 100}%"
							></div>
						</div>
					</div>
				{:else}<p class="text-sm text-muted-foreground">No sessions yet.</p>{/each}
			</section>
		{/each}
	</div>
</div>
