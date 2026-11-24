<script lang="ts">
	import * as AlertDialog from '#lib/components/ui/alert-dialog/index.ts';
	import { buttonVariants } from '#lib/components/ui/button/index.ts';
	import { Input } from '#lib/components/ui/input/index.ts';
	import { choice } from '#lib/choice.svelte.ts';
	import Trash from '@lucide/svelte/icons/trash-2';

	let inputEl: HTMLInputElement | null = $state(null);

	function done(v: string | null) {
		choice.resolve?.(v);
		choice.resolve = null;
		choice.open = false;
	}
	// the last option is the primary (ink) button, others are outlined; with several options
	// "Cancel" steps back to a plain text button
	const several = $derived(choice.options.length > 1);
</script>

<AlertDialog.Root bind:open={choice.open} onOpenChange={(o) => !o && done(null)}>
	<AlertDialog.Content
		class="gap-1.5 rounded-[14px] p-5 sm:max-w-[420px]"
		onOpenAutoFocus={(e) => {
			if (!inputEl) return; // prompt mode: start in the text field
			e.preventDefault();
			inputEl.focus();
		}}
	>
		<AlertDialog.Header class="gap-1.5 text-left">
			<AlertDialog.Title class="text-[15px] font-semibold">{choice.title}</AlertDialog.Title>
			{#if choice.description}<AlertDialog.Description class="text-[13px]"
					>{choice.description}</AlertDialog.Description
				>{/if}
		</AlertDialog.Header>
		{#if choice.input !== null}
			<Input
				class="mt-2"
				bind:ref={inputEl}
				bind:value={choice.input}
				placeholder={choice.placeholder}
				onkeydown={(e) => {
					if (e.key !== 'Enter') return;
					e.preventDefault(); // else the Enter re-activates the trigger that gets focus back
					done(choice.options[0]?.value ?? null);
				}}
			/>
		{/if}
		<AlertDialog.Footer class="mt-3.5 flex-row justify-end gap-2">
			<AlertDialog.Cancel
				class={buttonVariants({ variant: several ? 'ghost' : 'outline' }) +
					(several ? ' text-muted-foreground' : '')}
				onclick={() => done(null)}>Cancel</AlertDialog.Cancel
			>
			{#each choice.options as o, i (o.value)}
				<AlertDialog.Action
					class={buttonVariants({
						variant: i === choice.options.length - 1 ? 'default' : 'outline'
					})}
					onclick={() => done(o.value)}
					>{#if o.destructive && several}<Trash />{/if}{o.label}</AlertDialog.Action
				>
			{/each}
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
