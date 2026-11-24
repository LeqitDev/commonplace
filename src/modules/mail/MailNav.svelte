<script lang="ts">
	// Sidebar: the unread count and the accounts under "Mail".
	import { page } from '$app/state';
	import * as Sidebar from '#lib/components/ui/sidebar/index.ts';
	import AccountMark from './components/AccountMark.svelte';
	import { accounts, unread } from './mail.svelte.ts';
	import { toggle, tree } from '#lib/tree-state.svelte.ts';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import Inbox from '@lucide/svelte/icons/inbox';

	const accs = $derived(accounts());
	const open = $derived(!tree.collapsed.mail);
</script>

{#if accs.length}
	<Sidebar.MenuAction
		title={open ? 'Hide accounts' : 'Show accounts'}
		onclick={() => toggle('mail')}
		><ChevronRight class="transition-transform {open ? 'rotate-90' : ''}" /></Sidebar.MenuAction
	>
{/if}
{#if unread() && (!open || !accs.length)}<Sidebar.MenuBadge
		class="right-7 text-[11px] font-normal text-muted-foreground tabular-nums"
		>{unread()}</Sidebar.MenuBadge
	>{/if}
{#if open && accs.length}
	<Sidebar.MenuSub>
		{#each [null, ...accs] as a (a?.id ?? 'all')}
			{@const href = a ? `/mail/${a.id}` : '/mail'}
			{@const n = unread(a?.id ?? null)}
			<Sidebar.MenuSubItem>
				<Sidebar.MenuSubButton {href} isActive={page.url.pathname === href}>
					{#if a}<AccountMark account={a} />{:else}<Inbox />{/if}
					<span class="flex-1 truncate">{a ? a.name : 'All inboxes'}</span>
					{#if n}<span class="text-[11px] text-muted-foreground tabular-nums">{n}</span>{/if}
				</Sidebar.MenuSubButton>
			</Sidebar.MenuSubItem>
		{/each}
	</Sidebar.MenuSub>
{/if}
