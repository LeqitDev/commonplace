<script lang="ts">
	// Body of one message: text in the app's typography (markdown-like: lists, tables, and for text
	// made from HTML also bold, italic and links), HTML in a sandboxed iframe
	// (no scripts; remote content blocked until "Show images").
	import type { MailMessage } from '#lib/types.ts';
	import { findDates, laterAt, type FoundDate } from '#modules/mail/dates.ts';
	import { mailBlocks, mailInline, type MailSeg } from '#modules/mail/mail.ts';
	import * as DropdownMenu from '#lib/components/ui/dropdown-menu/index.ts';
	import { format } from 'date-fns';
	import SquareCheck from '@lucide/svelte/icons/square-check';
	import CalendarIcon from '@lucide/svelte/icons/calendar';
	import Clock from '@lucide/svelte/icons/clock';

	let {
		message,
		ondate
	}: {
		message: MailMessage;
		/** A date in the text was chosen: a task due then, an event then, or bring the mail back then. */
		ondate?: (d: FoundDate, kind: 'task' | 'event' | 'later') => void;
	} = $props();
	const day = (d: Date) => format(d, 'EEE d MMM');
	const dayTime = (d: Date) => format(d, 'EEE d MMM, HH:mm');
	let showImages = $state(false);
	// simple HTML is read as text; this brings the frame back
	let original = $state(false);
	const framed = $derived(!!message.html && (!message.simple || original));
	let frame = $state<HTMLIFrameElement>();
	let height = $state(120);

	const remote = $derived(
		!!message.html &&
			/(src|background|srcset)\s*=\s*["']?\s*(https?:)?\/\/|url\(\s*["']?\s*(https?:)?\/\//i.test(
				message.html
			)
	);

	const srcdoc = $derived.by(() => {
		if (!message.html) return '';
		const ext = showImages ? ' https: http:' : '';
		const csp = `default-src 'none'; img-src 'self' data:${ext}; style-src 'unsafe-inline'${ext}; font-src data:${ext}; media-src 'none'`;
		return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><base target="_blank"><style>html{color-scheme:light}html,body{height:auto!important;min-height:0!important}body{margin:0;padding:16px;font:14px/1.5 system-ui,sans-serif;color:#171717;background:#fff;overflow-wrap:anywhere}img{max-width:100%;height:auto}</style></head><body>${message.html}</body></html>`;
	});

	// same-origin (but no scripts), so the height can be measured and followed
	$effect(() => {
		const f = frame;
		if (!f) return;
		let ro: ResizeObserver | undefined;
		// as high as the document, plus what the frame takes from it: its border (the frame is a
		// border-box) and a horizontal scrollbar. Without them the document scrolls by a few pixels.
		const fit = () => {
			const doc = f.contentDocument;
			const root = doc?.documentElement;
			if (!root) return;
			const need = Math.max(root.scrollHeight, Math.ceil(root.getBoundingClientRect().height));
			const bar = Math.max(0, (f.contentWindow?.innerHeight ?? 0) - root.clientHeight);
			height = Math.max(60, need + bar + (f.offsetHeight - f.clientHeight));
		};
		const measure = () => {
			const doc = f.contentDocument;
			if (!doc?.documentElement) return;
			fit();
			ro?.disconnect();
			ro = new ResizeObserver(fit);
			ro.observe(doc.body ?? doc.documentElement);
		};
		f.addEventListener('load', measure);
		// already loaded before this ran: the height would stay at its first 120px
		if (f.contentDocument?.readyState === 'complete' && f.contentDocument.body?.childNodes.length)
			measure();
		return () => {
			f.removeEventListener('load', measure);
			ro?.disconnect();
		};
	});

	const blocks = $derived(mailBlocks(message.text ?? '', message.md));
	const URL_RE = /(https?:\/\/[^\s<>"')\]]+)/g;
	// dates in our own text, measured from when the mail was sent ("tomorrow" = the day after it)
	type Seg = { s: string; url?: boolean; date?: FoundDate };
	function segments(text: string, quote: boolean): Seg[] {
		const out: Seg[] = [];
		const push = (s: string) =>
			s.split(URL_RE).forEach((p, j) => p && out.push(j % 2 ? { s: p, url: true } : { s: p }));
		let at = 0;
		for (const d of quote || !ondate ? [] : findDates(text, new Date(message.date))) {
			if (d.index < at) continue;
			push(text.slice(at, d.index));
			out.push({ s: d.text, date: d });
			at = d.index + d.text.length;
		}
		push(text.slice(at));
		return out;
	}
	const host = (u: string) => {
		try {
			return new URL(/^www\./i.test(u) ? `https://${u}` : u).host.replace(/^www\./, '');
		} catch {
			return '';
		}
	};
	/** A link that reads like an address but leads to another site: where it really goes. */
	const elsewhere = (g: MailSeg) => {
		const s = g.s.trim();
		const to = host(g.href!);
		return /^(https?:\/\/|www\.)\S+$/i.test(s) && host(s) !== to ? to : '';
	};
</script>

{#snippet plain(text: string, quote: boolean)}
	{#each segments(text, quote) as g, j (j)}
		{#if g.url}<a
				href={g.s}
				target="_blank"
				rel="noopener noreferrer"
				class="underline underline-offset-2">{g.s}</a
			>{:else if g.date}{@render dateMenu(g.s, g.date)}{:else}{g.s}{/if}
	{/each}
{/snippet}

<!-- a found date: what to make of it -->
{#snippet dateMenu(text: string, d: FoundDate)}
	{@const later = laterAt(d)}
	<DropdownMenu.Root
		><DropdownMenu.Trigger
			class="border-b-[1.5px] border-dotted border-muted-foreground font-medium hover:border-foreground data-[state=open]:border-foreground"
			title="Make a task or event from this date">{text}</DropdownMenu.Trigger
		><DropdownMenu.Content align="start" class="w-64">
			<DropdownMenu.Item onSelect={() => ondate?.(d, 'task')}>
				<SquareCheck />Task due {day(d.date)}
			</DropdownMenu.Item>
			<DropdownMenu.Item onSelect={() => ondate?.(d, 'event')}>
				<CalendarIcon />Event {d.time ? dayTime(d.date) : `${day(d.date)}, all day`}
			</DropdownMenu.Item>
			{#if later > new Date()}
				<DropdownMenu.Item onSelect={() => ondate?.(d, 'later')}>
					<Clock />Bring back {dayTime(later)}
				</DropdownMenu.Item>
			{/if}
		</DropdownMenu.Content></DropdownMenu.Root
	>
{/snippet}

<!-- bold, italic and links exist only in text made from HTML (`md`) -->
{#snippet run(text: string, quote: boolean)}
	{#each mailInline(text, message.md) as g, j (j)}
		{#if g.href}<a
				href={g.href}
				title={g.href}
				target="_blank"
				rel="noopener noreferrer"
				class={['underline underline-offset-2', g.bold && 'font-medium', g.em && 'italic']}>{g.s}</a
			>{#if elsewhere(g)}<span class="text-muted-foreground">{` (${elsewhere(g)})`}</span
				>{/if}{:else if g.bold || g.em}<span class={[g.bold && 'font-medium', g.em && 'italic']}
				>{@render plain(g.s, quote)}</span
			>{:else}{@render plain(g.s, quote)}{/if}
	{/each}
{/snippet}

{#if message.simple}
	<div class="mb-2 text-xs text-muted-foreground">
		<button
			class="underline-offset-2 hover:text-foreground hover:underline"
			onclick={() => (original = !original)}>{original ? 'Show as text' : 'Show original'}</button
		>{#if message.pictures && !original}<span
				>{' · '}{message.pictures === 1 ? '1 picture' : `${message.pictures} pictures`} not shown</span
			>{/if}
	</div>
{/if}
{#if framed}
	{#if remote && !showImages}
		<div class="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
			Remote images are blocked.
			<button
				class="font-medium text-foreground underline-offset-2 hover:underline"
				onclick={() => (showImages = true)}>Show images</button
			>
		</div>
	{/if}
	<iframe
		bind:this={frame}
		title="Message"
		class="w-full rounded-lg border bg-white"
		style:height="{height}px"
		sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
		{srcdoc}
	></iframe>
{:else if message.text}
	<div class="flex max-w-[80ch] flex-col gap-3 text-[14.5px] leading-relaxed">
		{#each blocks as b, i (i)}
			{#if b.kind === 'table'}
				<div class="overflow-x-auto">
					<table class="border-collapse text-[13.5px] leading-snug">
						<tbody>
							{#each b.rows as r, n (n)}
								<tr class="border-b border-line2 last:border-0 {n ? '' : 'font-medium'}">
									{#each r as c, k (k)}
										<td class="py-1.5 pr-5 align-top last:pr-0">{@render run(c, false)}</td>
									{/each}
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{:else if b.kind === 'list'}
				<div class="flex flex-col gap-0.5">
					{#each b.items as it, n (n)}
						<div class="flex gap-2" style:padding-left="{it.depth * 1.25}rem">
							<span class="min-w-3 shrink-0 text-right text-muted-foreground tabular-nums"
								>{it.marker}</span
							>
							<span class="min-w-0 break-words whitespace-pre-wrap"
								>{@render run(it.text, false)}</span
							>
						</div>
					{/each}
				</div>
			{:else if b.kind === 'head'}
				<p class="m-0 font-medium break-words {b.level === 1 ? 'text-base' : ''}">
					{@render run(b.text, false)}
				</p>
			{:else}
				<p
					class="m-0 break-words whitespace-pre-wrap {b.quote
						? 'border-l-2 pl-3 text-muted-foreground'
						: ''}"
				>
					{@render run(b.text, b.quote)}
				</p>
			{/if}
		{/each}
	</div>
{:else if message.missing}
	<p class="text-sm text-muted-foreground">
		This message couldn't be loaded from the server. {message.snippet}
	</p>
{:else}
	<p class="text-sm text-muted-foreground">(no text)</p>
{/if}
