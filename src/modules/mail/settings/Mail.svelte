<script lang="ts">
	// Mail accounts as rows that open one at a time; "Add account" presets only fill in the servers.
	import * as Popover from '#lib/components/ui/popover/index.ts';
	import AppSelect from '#lib/components/app/AppSelect.svelte';
	import AccountMark from '#modules/mail/components/AccountMark.svelte';
	import { batch, create, db, featureOn, remove, update } from '#lib/data.svelte.ts';
	import { confirmAction } from '#lib/choice.svelte.ts';
	import { PRESETS, servers } from '#modules/mail/mail.ts';
	import { mail, syncMail } from '#modules/mail/mail.svelte.ts';
	import type { MailAccount } from '#lib/types.ts';
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';
	import Trash from '@lucide/svelte/icons/trash-2';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import Field from '#lib/components/settings/Field.svelte';
	import Row from '#lib/components/settings/Row.svelte';
	import Triage from './Triage.svelte';
	import { card, h2, input, quiet, soft, tabPanel, when } from '#lib/components/settings/styles.ts';

	const list = $derived(
		db.mail_accounts.all.toSorted((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''))
	);
	// an account that can't sign in is opened, so the new password can go in
	let open = $state<string | null>(db.mail_accounts.all.find((a) => a.error)?.id ?? null);

	const set = (id: string, p: Partial<MailAccount>) => update('mail_accounts', id, p, false);
	const queued = (id: string) =>
		db.mail_drafts.all.filter((d) => d.account === id && d.queued).length;

	// "Projects": by sender rules, or all mail to a group or a project
	const assignOptions = $derived([
		{ value: 'rules', label: 'Sorted by sender rules' },
		...[...new Set(db.projects.all.filter((p) => !p.archived && p.group).map((p) => p.group!))]
			.sort()
			.map((g) => ({ value: `group:${g}`, label: `All mail goes to group ${g}` })),
		...db.projects.all
			.filter((p) => !p.archived)
			.toSorted((a, b) => a.name.localeCompare(b.name))
			.map((p) => ({ value: `project:${p.id}`, label: `All mail goes to ${p.name}` }))
	]);
	const assignValue = (a: MailAccount) =>
		a.assign === 'group'
			? `group:${a.group}`
			: a.assign === 'project'
				? `project:${a.projectId}`
				: 'rules';
	function setAssign(id: string, v: string) {
		const [kind, ...rest] = v.split(':');
		const val = rest.join(':');
		set(id, {
			assign: kind === 'rules' ? null : kind,
			group: kind === 'group' ? val : null,
			projectId: kind === 'project' ? val : null
		} as never);
	}

	/** The password goes to the server only; the browser doesn't keep it. */
	async function setPassword(id: string, el: HTMLInputElement) {
		const password = el.value;
		el.value = '';
		if (!password) return;
		await set(id, { password });
		delete db.mail_accounts.items[id]?.password;
		mail.syncing[id] = true; // the server signs in with it right away
	}

	async function add(type: keyof typeof PRESETS) {
		const a = await create(
			'mail_accounts',
			{
				name: type === 'imap' ? 'Mail' : PRESETS[type].label,
				address: '',
				type,
				enabled: true,
				marker: (['outline', 'solid', 'grey'] as const)[list.length % 3],
				...(!list.some((x) => x.default) && { default: true })
			},
			false
		);
		open = a.id;
		requestAnimationFrame(() => document.getElementById(`acct-address-${a.id}`)?.focus());
	}

	const makeDefault = (id: string) =>
		batch(async () => {
			for (const a of list)
				if (a.default && a.id !== id) await set(a.id, { default: null } as never);
			await set(id, { default: true });
		});

	async function drop(a: MailAccount) {
		if (
			!(await confirmAction(
				`Remove “${a.name}”?`,
				'Its mail stays on the server; the copy in the planner is deleted.'
			))
		)
			return;
		await remove('mail_accounts', a.id, false);
		if (a.default && list[0]) await set(list[0].id, { default: true });
	}

	const typeLabel = (a: MailAccount) =>
		a.type === 'imap'
			? ['IMAP + SMTP', servers(a).imap?.host]
			: [PRESETS[a.type as 'gmail' | 'icloud']?.label ?? a.type, 'app password'];
	const hostPort = (s?: { host: string; port?: number }) =>
		s?.host ? `${s.host}${s.port ? `:${s.port}` : ''}` : '';
	const parseHost = (v: string) => {
		const [host, port] = v.trim().split(':');
		return host ? { host, ...(Number(port) && { port: Number(port) }) } : null;
	};
</script>

<div role="tabpanel" aria-labelledby="h-mail" class={tabPanel}>
	<div class="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 pr-9">
		<h2 id="h-mail" class={h2}>Mail</h2>
		<span class="text-muted-foreground">Checked every 5 minutes and when the tab gets focus.</span>
	</div>
	{#if list.length}
		<div class={card}>
			{#each list as a (a.id)}
				{@const syncing = !!mail.syncing[a.id]}
				{@const n = queued(a.id)}
				{@const [type, detail] = typeLabel(a)}
				<Row
					data-account={a.id}
					label={a.name}
					open={open === a.id}
					ontoggle={() => (open = open === a.id ? null : a.id)}
					enabled={a.enabled !== false}
					onenabled={(v) => set(a.id, { enabled: v })}
				>
					{#snippet head()}
						<AccountMark account={a} class="size-5 rounded-[5px] text-[11px]" />
						<span class="font-medium whitespace-nowrap">{a.name}</span>
						{#if a.default}
							<span
								class="flex h-5.5 shrink-0 items-center rounded-full bg-muted px-2 text-[11.5px]"
								>Default</span
							>
						{/if}
						<span class="min-w-0 flex-1 truncate text-muted-foreground">{a.address}</span>
						{#if syncing}
							<span
								role="status"
								class="flex items-center gap-1.5 text-[11.5px] text-muted-foreground"
								><LoaderCircle class="size-3.5 animate-spin" />Syncing…</span
							>
						{:else if a.error}
							<span
								class="flex min-w-0 shrink items-center gap-1.5 text-[11.5px] font-medium whitespace-nowrap"
								title={a.error}
								><TriangleAlert class="size-3.5 shrink-0" /><span class="truncate"
									>{a.errorSince ? `Failing since ${when(a.errorSince)}` : 'Sync failed'}</span
								></span
							>
						{:else}
							<span class="text-[11.5px] whitespace-nowrap text-muted-foreground tabular-nums">
								{a.lastSync
									? `Synced ${when(a.lastSync)}`
									: a.enabled === false
										? 'Off'
										: 'Not synced yet'}{n ? ` · ${n} waiting to be sent` : ''}
							</span>
						{/if}
					{/snippet}

					{#if a.error && !syncing}
						<div class="flex items-center gap-2 rounded-lg bg-muted px-3 py-2">
							<TriangleAlert class="size-4 shrink-0" />
							<span class="min-w-0 font-medium"
								>{a.error}.{a.lastSync ? ' Mail from before is still shown.' : ''}</span
							>
						</div>
					{/if}
					<div
						class="grid grid-cols-[repeat(auto-fit,minmax(min(250px,100%),1fr))] gap-x-5 gap-y-2"
					>
						<Field label="Name" for="acct-name-{a.id}">
							<div class="flex gap-1.5">
								<Popover.Root>
									<Popover.Trigger class="shrink-0 rounded-lg" aria-label="Change marker">
										<AccountMark account={a} class="size-8.5 rounded-lg text-[13px]" />
									</Popover.Trigger>
									<Popover.Content class="flex w-56 flex-col gap-2 p-3" align="start">
										<label class="flex items-center gap-2 text-xs text-muted-foreground">
											Letter
											<input
												class="{input} h-8 w-12 text-center"
												maxlength="1"
												value={a.letter ?? ''}
												placeholder={a.name.charAt(0)}
												onchange={(e) =>
													set(a.id, { letter: e.currentTarget.value.trim() || null } as never)}
											/>
										</label>
										<div class="flex gap-1">
											{#each ['outline', 'solid', 'grey'] as const as m (m)}
												<button
													class="flex flex-1 items-center gap-1.5 rounded-md px-1.5 py-1 text-xs hover:bg-muted {(a.marker ??
														'outline') === m
														? 'bg-muted'
														: ''}"
													onclick={() => set(a.id, { marker: m })}
													><AccountMark account={{ ...a, marker: m }} />{m}</button
												>
											{/each}
										</div>
									</Popover.Content>
								</Popover.Root>
								<input
									id="acct-name-{a.id}"
									class="{input} flex-1"
									value={a.name}
									onchange={(e) => set(a.id, { name: e.currentTarget.value.trim() || a.name })}
								/>
							</div>
						</Field>
						<Field label="Type">
							<span class="truncate"
								>{type}{#if detail}<span class="text-muted-foreground">{` · ${detail}`}</span
									>{/if}</span
							>
						</Field>
						<Field label="Address" for="acct-address-{a.id}">
							<input
								id="acct-address-{a.id}"
								class={input}
								type="email"
								value={a.address}
								placeholder="you@example.org"
								onchange={(e) => set(a.id, { address: e.currentTarget.value.trim() })}
							/>
						</Field>
						<Field label="Your name" for="acct-sender-{a.id}">
							<input
								id="acct-sender-{a.id}"
								class={input}
								value={a.sender ?? ''}
								placeholder="shown when you send"
								onchange={(e) =>
									set(a.id, { sender: e.currentTarget.value.trim() || null } as never)}
							/>
						</Field>
						{#if a.type === 'imap'}
							<Field label="IMAP" for="acct-imap-{a.id}">
								<input
									id="acct-imap-{a.id}"
									class={input}
									value={hostPort(a.imap)}
									placeholder="mail.example.org:993"
									onchange={(e) => set(a.id, { imap: parseHost(e.currentTarget.value) } as never)}
								/>
							</Field>
							<Field label="SMTP" for="acct-smtp-{a.id}">
								<input
									id="acct-smtp-{a.id}"
									class={input}
									value={hostPort(a.smtp)}
									placeholder="mail.example.org:587"
									onchange={(e) => set(a.id, { smtp: parseHost(e.currentTarget.value) } as never)}
								/>
							</Field>
							<Field label="Username" for="acct-user-{a.id}">
								<input
									id="acct-user-{a.id}"
									class={input}
									value={a.username ?? ''}
									placeholder={a.address || 'the address'}
									autocomplete="off"
									onchange={(e) =>
										set(a.id, { username: e.currentTarget.value.trim() || null } as never)}
								/>
							</Field>
						{/if}
						<Field label="Password" for="acct-pass-{a.id}">
							<input
								id="acct-pass-{a.id}"
								class="{input} {a.error ? 'border-[1.5px] border-foreground' : ''}"
								type="password"
								autocomplete="new-password"
								placeholder={a.error
									? `Enter a new ${a.type === 'imap' ? 'password' : 'app password'}`
									: a.lastSync
										? 'unchanged'
										: a.type === 'imap'
											? 'Password'
											: 'App password'}
								onchange={(e) => setPassword(a.id, e.currentTarget)}
							/>
						</Field>
						<Field label="Projects">
							<AppSelect
								value={assignValue(a)}
								options={assignOptions}
								onchange={(v) => setAssign(a.id, v)}
							/>
						</Field>
						<Field label="Show">
							<AppSelect
								value={a.show ?? 'projects'}
								options={[
									{ value: 'projects', label: 'Only in its projects' },
									{ value: 'always', label: 'Always' },
									{ value: 'all', label: 'Only in “All projects”' }
								]}
								onchange={(v) => set(a.id, { show: v as MailAccount['show'] })}
							/>
						</Field>
					</div>
					<div class="flex items-center gap-2 border-t pt-2.5">
						<button
							class={soft}
							disabled={syncing || a.enabled === false}
							onclick={() => syncMail(a.id)}>{a.error ? 'Retry' : 'Sync now'}</button
						>
						{#if !a.default}
							<button class={quiet} onclick={() => makeDefault(a.id)}>Make default</button>
						{/if}
						<span class="flex-1"></span>
						<button class={quiet} onclick={() => drop(a)}><Trash />Remove</button>
					</div>
				</Row>
			{/each}
		</div>
	{/if}
	<div class="flex flex-wrap items-center gap-2">
		<span class="mr-1 text-muted-foreground">Add account</span>
		{#each Object.entries(PRESETS) as [type, p] (type)}
			<button
				class="h-8.5 rounded-lg border border-line2 px-3 font-medium hover:bg-muted"
				onclick={() => add(type as keyof typeof PRESETS)}>{p.label}</button
			>
		{/each}
	</div>
	<p class="m-0 text-[11.5px] text-muted-foreground">
		A preset only fills in the servers. Gmail and iCloud need an app password (see the README).
		Passwords are stored on your server, never in the browser.
	</p>
	{#if featureOn('triage')}<Triage />{/if}
</div>
