<script lang="ts">
	// Project page: mail from these senders belongs to the project.
	import { db, update } from '#lib/data.svelte.ts';
	import type { Project } from '#lib/types.ts';
	import X from '@lucide/svelte/icons/x';

	let { project: p }: { project: Project } = $props();

	const setSenders = (senders: string[]) =>
		update('projects', p.id, { senders: senders.length ? senders : null } as never);
	function addSender(e: KeyboardEvent & { currentTarget: HTMLInputElement }) {
		if (e.key !== 'Enter') return;
		const v = e.currentTarget.value.trim().toLowerCase();
		e.currentTarget.value = '';
		if (v && !p.senders?.includes(v)) setSenders([...(p.senders ?? []), v]);
	}
</script>

{#if db.mail_accounts.all.length}
	<section>
		<h2 class="mb-2 text-xs font-medium text-muted-foreground uppercase">Mail from</h2>
		<div class="flex flex-wrap items-center gap-2">
			{#each p.senders ?? [] as s (s)}
				<span class="group flex items-center rounded-md border py-1 pl-2.5 text-sm">
					{s}
					<button
						class="px-1.5 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground focus-visible:opacity-100"
						title="Remove"
						onclick={() => setSenders(p.senders!.filter((x) => x !== s))}
						><X class="size-3" /></button
					>
				</span>
			{/each}
			<input
				class="h-8 w-56 rounded-md border border-input bg-transparent px-2 text-sm"
				placeholder="address or @domain, Enter"
				onkeydown={addSender}
			/>
		</div>
		<p class="mt-1 text-xs text-muted-foreground">
			Mail from these senders belongs to this project.
		</p>
	</section>
{/if}
