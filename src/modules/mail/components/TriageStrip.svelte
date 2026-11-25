<script lang="ts">
	// What the triage says about a conversation: the summary model's sentence (if one is set up), one
	// line ("Orders · Pay · due Mon · High importance") whose tab opens "Move sender to …", a warning
	// when it may be phishing (with "Not phishing"), the one-time code to copy, DHL parcels, and every
	// answer in a popover, where it can be corrected (labels: scripts/triage-eval.ts).
	import { toast } from 'svelte-sonner';
	import * as Popover from '#lib/components/ui/popover/index.ts';
	import * as DropdownMenu from '#lib/components/ui/dropdown-menu/index.ts';
	import AppSelect from '#lib/components/app/AppSelect.svelte';
	import { api } from '#lib/data.svelte.ts';
	import { mail } from '#modules/mail/mail.svelte.ts';
	import { copyCode } from '#modules/mail/triage/triage.svelte.ts';
	import {
		BY_NAME,
		QUESTIONS,
		TABS,
		T,
		codeExpired,
		dueLabel,
		effective,
		expected,
		parcelHref,
		parcelLabel,
		signals as signalsOf,
		summary,
		top,
		yes,
		type Answers,
		type Facts,
		type Labels,
		type Parcel,
		type Tab
	} from '#modules/mail/triage/triage.ts';
	import ShieldAlert from '@lucide/svelte/icons/shield-alert';
	import Sparkles from '@lucide/svelte/icons/list-checks';
	import Check from '@lucide/svelte/icons/check';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import KeyRound from '@lucide/svelte/icons/key-round';
	import Copy from '@lucide/svelte/icons/copy';
	import Package from '@lucide/svelte/icons/package';
	import { untrack } from 'svelte';

	let { thread }: { thread: string } = $props();

	type Triage = {
		msgid: string;
		received: string;
		at: string;
		model: string;
		facts: Facts;
		answers: Answers;
		labels: Labels;
		tab: string;
		code: string | null;
		summary: string | null;
		from: string;
		rule: Tab | null;
		parcels: Parcel[];
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

	const s = $derived(
		tr && summary(tr.answers, tr.facts, tr.at, { labels: tr.labels, rule: tr.rule })
	);
	const eff = $derived(tr ? effective(tr.answers, tr.facts) : {});
	const pct = (p: number) => `${Math.round(p * 100)}%`;
	const lower = (v: string) => v.charAt(0).toLowerCase() + v.slice(1);
	const tabLabel = (id: string) => TABS.find((t) => t.id === id)?.label ?? id;

	const line = $derived.by(() => {
		if (!tr || !s) return [];
		const a = eff;
		const out: string[] = [];
		const cat = top(a, 'Category');
		if (cat && cat.value !== 'Other' && !/^(Newsletter|Advertisement|Transactions)/.test(cat.value))
			out.push(cat.value);
		if (s.action) out.push(s.action);
		if (s.late) out.push('too late');
		else if (s.due) {
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
		if (s.code && !tr.code) out.push('contains a code');
		return out;
	});

	/** What makes it look suspicious: only real signs (a sender who is new to you isn't one). */
	const signals = $derived.by(() => {
		if (!tr) return [];
		const out = signalsOf(tr.facts);
		if (!out.length && tr.facts.foreign?.length)
			out.push(`links lead to ${tr.facts.foreign.join(', ')}, not to the sender's site`);
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
		tr.labels = await api<Labels>('/api/mail/triage/label', {
			method: 'POST',
			body: JSON.stringify({ msgid: tr.msgid, name, value })
		});
	}
	const labelled = $derived(tr ? Object.keys(tr.labels).length : 0);

	/** Mail of this sender goes to `tab` from now on (null: the triage decides again). */
	async function moveSender(tab: Tab | null) {
		if (!tr?.from) return;
		const from = tr.from;
		const before = tr.rule;
		const send = (t: Tab | null) =>
			api<{ moved: number }>('/api/mail/triage/sender', {
				method: 'POST',
				body: JSON.stringify({ address: from, tab: t })
			});
		await send(tab);
		if (tr?.from === from) tr.rule = tab;
		toast.success(
			tab ? `Mail from ${from} goes to ${tabLabel(tab)}` : `The triage sorts ${from} again`,
			{
				action: {
					label: 'Undo',
					onClick: () =>
						void send(before).then(() => {
							if (tr?.from === from) tr.rule = before;
						})
				}
			}
		);
	}
</script>

{#if tr && s}
	{#if s.warn}
		<div class="-mt-1 flex gap-2.5 rounded-[10px] border border-foreground/40 px-3 py-2.5 text-sm">
			<ShieldAlert class="mt-0.5 size-4 shrink-0" />
			<div class="min-w-0 flex-1">
				<div class="font-medium">This may be phishing ({pct(s.phishing)})</div>
				<div class="text-muted-foreground">
					Don't open its links or attachments unless you are sure.{#if signals.length}
						{' '}Signs: {signals.join('; ')}.{/if}
				</div>
			</div>
			<button
				class="h-7 shrink-0 self-start rounded-md border border-line2 px-2 text-[12.5px] hover:bg-muted"
				title="The triage was wrong: no warning for this mail"
				onclick={() => correct('Phishing', 'false')}>Not phishing</button
			>
		</div>
	{/if}
	{#if tr.summary}<p class="-mt-1 mb-0 text-[13.5px]">{tr.summary}</p>{/if}
	<div class="-mt-2 flex items-center gap-2 text-[13px] text-muted-foreground">
		<DropdownMenu.Root>
			<DropdownMenu.Trigger
				class="-ml-1.5 flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 text-foreground hover:bg-muted"
				title="Inbox tab{tr.rule ? ' (your rule for this sender)' : ''}"
				>{tabLabel(s.tab)}{#if tr.rule}<span class="text-muted-foreground">·&nbsp;rule</span
					>{/if}<ChevronDown class="size-3 text-muted-foreground" /></DropdownMenu.Trigger
			>
			<DropdownMenu.Content align="start" class="w-56">
				<DropdownMenu.Label class="truncate text-xs font-normal text-muted-foreground"
					>Move mail from {tr.from || 'this sender'} to</DropdownMenu.Label
				>
				{#each TABS as t (t.id)}
					<DropdownMenu.Item disabled={!tr.from} onSelect={() => moveSender(t.id)}>
						<span class="flex-1">{t.label}</span>
						{#if tr.rule === t.id}<Check class="size-3.5" />{/if}
					</DropdownMenu.Item>
				{/each}
				{#if tr.rule}
					<DropdownMenu.Separator />
					<DropdownMenu.Item onSelect={() => moveSender(null)}
						>Let the triage decide</DropdownMenu.Item
					>
				{/if}
			</DropdownMenu.Content>
		</DropdownMenu.Root>
		<span class="min-w-0 flex-1 truncate">{line.join(' · ')}</span>
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
	{#if tr.code || tr.parcels.length}
		<div
			class="-mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-muted-foreground"
		>
			{#if tr.code}
				{@const old = codeExpired(tr.received)}
				<button
					class="flex h-7 items-center gap-1.5 rounded-md border border-line2 px-2 hover:bg-muted hover:text-foreground"
					title={old ? 'Probably expired (older than 30 minutes): copy anyway' : 'Copy the code'}
					onclick={() => copyCode(tr!.code!)}
					><KeyRound class="size-3.5" /><span
						class="font-mono text-foreground {old ? 'line-through' : ''}">{tr.code}</span
					><Copy class="size-3" /></button
				>
			{/if}
			{#each tr.parcels as p (p.number)}
				<a
					class="flex min-w-0 items-center gap-1.5 hover:text-foreground"
					href={parcelHref(p.number)}
					target="_blank"
					rel="noopener noreferrer"
					title="Open at DHL ({p.number})"
					><Package class="size-3.5 shrink-0" /><span class="text-foreground">DHL</span>
					<span>{parcelLabel(p)}</span>{#if p.status}<span class="min-w-0 truncate"
							>· {p.status}{#if p.location}, {p.location}{/if}</span
						>{/if}</a
				>
			{/each}
		</div>
	{/if}
{/if}
