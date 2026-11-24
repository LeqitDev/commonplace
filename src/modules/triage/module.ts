// Mail triage with a model on this computer. Its code lives with mail (src/modules/mail/triage),
// whose page and settings show it while this module is on; this manifest only starts the worker.
import type { ClientModule } from '#lib/modules.ts';
import { startModule } from '#modules/mail/triage/triage.svelte.ts';

export default { id: 'triage', start: startModule } satisfies ClientModule;
