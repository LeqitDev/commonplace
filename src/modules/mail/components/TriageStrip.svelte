<script lang="ts">
	// What the triage says about a conversation: one line ("Work · Reply · due Mon · High importance"),
	// a warning when it may be phishing, and every answer in a popover, where it can be corrected
	// (labels for calibrating the model: scripts/triage-eval.ts).
	import * as Popover from '#lib/components/ui/popover/index.ts';
	import AppSelect from '#lib/components/app/AppSelect.svelte';
	import { api } from '#lib/data.svelte.ts';
	import { mail } from '#modules/mail/mail.svelte.ts';
	import {
		BY_NAME,
		QUESTIONS,
		T,
		authFailed,
		dueLabel,
		effective,
		expected,
		summary,
		top,
		yes,
		type Answers,
		type Facts
	} from '#modules/mail/triage/triage.ts';
	import ShieldAlert from '@lucide/svelte/icons/shield-alert';
	import Sparkles from '@lucide/svelte/icons/list-checks';
	import Check from '@lucide/svelte/icons/check';
	import { untrack } from 'svelte';

	let { thread }: { thread: string } = $props();

	type Triage = {
		msgid: string;
		at: string;
		model: string;
		facts: Facts;
		answers: Answers;
		labels: Record<string, string | boolean>;
	};
	let tr = $state<Triage | null>(null);

	// answers may arrive while the conversation is open
	$effect(() => {
		const t = thread;
		void mail.version;
		untrack(() =>
			api<Triage | null>(`/api/mail/triage?thread=${encodeURIComponent(t)}`)
				.then((r) => t === thread && (tr = r))
				.catch(() => {})
		);
	});

	const s = $derived(tr && summary(tr.answers, tr.facts, tr.at));
	const eff = $derived(tr ? effective(tr.answers, tr.facts) : {});
	const pct = (p: number) => `${Math.round(p * 100)}%`;
	const lower = (v: string) => v.charAt(0).toLowerCase() + v.slice(1);

	const line = $derived.by(() => {
		if (!tr || !s) return [];
		const a = eff;
		const out: string[] = [];
		const cat = top(a, 'Category');
		if (cat && cat.value !== 'Other') out.push(cat.value);
		if (s.action) out.push(s.action);
		if (s.late) out.push('too late');
		else if (s.due && s.bucket === 'needs') {
			const d = dueLabel(s.due);
			out.push(d === 'overdue' ? 'overdue' : d === 'now' ? 'now' : `due ${d}`);
		}
		const imp = expected(a, 'Importance');
		if (imp != null && imp >= 1.5)
			out.push(`${BY_NAME.Importance.items[Math.round(imp)].v} importance`);
		const why = (yes(a, 'Action needed?') ?? 0) >= T.action ? top(a, 'Urgency driver') : null;
		if (why && why.value !== 'None' && why.value !== 'Other' && why.value !== 'Deadline')
			out.push(lower(why.value));
		if (s.followUp) out.push('follow-up');
		if (s.code) out.push('contains a code');
		if (s.bucket === 'other' && !s.action) out.push('nothing to do');
		return out;
	});

	/** What makes it look suspicious, from the headers. */
	const signals = $derived.by(() => {
		if (!tr) return [];
		const f = tr.facts;
		const out: string[] = [];
		if (authFailed(f))
			out.push(
				`sender check failed (${Object.entries(f.auth ?? {})
					.filter(([, v]) => /fail/.test(v))
					.map(([k]) => k.toUpperCase())
					.join(', ')})`
			);
		for (const m of f.mismatch ?? [])
			out.push(`a link shows ${m.replace(' → ', ' but leads to ')}`);
		if (f.known === false) out.push('you have never written to this sender');
		return out;
	});

	/** The model's answer to a question, as text, with the runner-up when it was close. */
	function answer(name: string) {
		const q = BY_NAME[name];
		if (!tr || !(name in tr.answers)) return { text: 'not asked', close: '' };
		if (q.type === 'predicate') {
			const p = yes(tr.answers, name)!;
			return { text: `${p >= 0.5 ? 'Yes' : 'No'} ${pct(p >= 0.5 ? p : 1 - p)}`, close: '' };
		}
		const t = top(tr.answers, name)!;
		return {
			text: `${t.value} ${pct(t.p)}`,
			close: t.second && t.margin < 0.2 ? `or ${t.second.value} ${pct(t.second.p)}` : ''
		};
	}
	const options = (name: string) => {
		const q = BY_NAME[name];
		const items =
			q.type === 'predicate'
				? [
						{ value: 'true', label: 'Yes' },
						{ value: 'false', label: 'No' }
					]
				: q.items.map((i) => ({ value: i.v, label: i.v }));
		return [{ value: '', label: 'As the model said' }, ...items];
	};
	async function correct(name: string, v: string) {
		if (!tr) return;
		const value = v === '' ? null : BY_NAME[name].type === 'predicate' ? v === 'true' : v;
		tr.labels = await api<Triage['labels']>('/api/mail/triage/label', {
			method: 'POST',
			body: JSON.stringify({ msgid: tr.msgid, name, value })
		});
	}
	const labelled = $derived(tr ? Object.keys(tr.labels).length : 0);
</script>

{#if tr && s}
	{#if s.phishing >= T.warnPhishing}
		<div class="-mt-1 flex gap-2.5 rounded-[10px] border border-foreground/40 px-3 py-2.5 text-sm">
			<ShieldAlert class="mt-0.5 size-4 shrink-0" />
			<div class="min-w-0">
				<div class="font-medium">This may be phishing ({pct(s.phishing)})</div>
				<div class="text-muted-foreground">
					Don't open its links or attachments unless you are sure.{#if signals.length}
						{' '}Signs: {signals.join('; ')}.{/if}
				</div>
			</div>
		</div>
	{/if}
	<div class="-mt-2 flex items-center gap-2 text-[13px] text-muted-foreground">
		<span class="min-w-0 truncate">{line.join(' · ') || 'Triaged'}</span>
		<Popover.Root>
			<Popover.Trigger
				class="flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 hover:bg-muted hover:text-foreground"
				title="All answers of the triage"
				><Sparkles class="size-3.5" />Details{#if labelled}<Check
						class="size-3"
					/>{/if}</Popover.Trigger
			>
			<Popover.Content
				align="end"
				collisionPadding={16}
				class="max-h-[70vh] w-[540px] overflow-y-auto p-0"
			>
				<div class="flex items-baseline gap-2 border-b px-4 py-2.5">
					<span class="flex-1 text-[13px] font-medium">Triage</span>
					<span class="text-[11.5px] text-muted-foreground">{tr.model}</span>
				</div>
				<div
					class="grid grid-cols-[9rem_minmax(0,1fr)_11rem] items-center gap-x-3 gap-y-1 px-4 py-2.5 text-[13px]"
				>
					{#each QUESTIONS as q (q.name)}
						{@const a = answer(q.name)}
						{@const lab = tr.labels[q.name]}
						<span class="truncate text-muted-foreground" title={q.instructions}>{q.name}</span>
						<span class="min-w-0 truncate {lab != null ? 'text-muted-foreground line-through' : ''}"
							>{a.text}{#if a.close}<span class="text-muted-foreground"> {a.close}</span>{/if}</span
						>
						<AppSelect
							class="h-7 text-xs {lab != null ? 'font-medium' : 'text-muted-foreground'}"
							value={lab == null ? '' : String(lab)}
							options={options(q.name)}
							onchange={(v) => correct(q.name, v)}
							title="The right answer"
						/>
					{/each}
				</div>
				<p class="m-0 border-t px-4 py-2 text-[11.5px] text-muted-foreground">
					Corrected answers are kept with what the model was told, to measure and calibrate it.
				</p>
			</Popover.Content>
		</Popover.Root>
	</div>
{/if}
