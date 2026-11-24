// Flashcard scheduling: FSRS (ts-fsrs) with only two answers, "again" and "good".
import {
	createEmptyCard,
	fsrs,
	generatorParameters,
	Rating,
	type Card as FsrsCard,
	type State
} from 'ts-fsrs';
import type { Card } from '#lib/types.ts';

// One 1-minute (re)learning step: "again" = see it again in a minute, "good" = done for this
// session (new card → days, after "again" → 1 day). FSRS's default steps (1m, 10m) need two
// "good"s before a card leaves the session, which reads as "good does nothing" with 2 buttons.
const scheduler = fsrs(generatorParameters({ learning_steps: ['1m'], relearning_steps: ['1m'] }));

export const isDue = (c: Pick<Card, 'due'>, now = new Date()) => !c.due || new Date(c.due) <= now;

/** The patch to store after answering a card. */
export function review(c: Card, good: boolean, now = new Date()): Pick<Card, 'due' | 'srs'> {
	const current = c.srs
		? ({
				...c.srs,
				state: c.srs.state as State,
				due: new Date(c.due ?? now),
				last_review: c.srs.last_review ? new Date(c.srs.last_review) : undefined
			} satisfies FsrsCard)
		: createEmptyCard(now);
	const { card } = scheduler.next(current, now, good ? Rating.Good : Rating.Again);
	const { due, last_review, ...rest } = card;
	return {
		due: due.toISOString(),
		srs: { ...rest, state: Number(rest.state), last_review: last_review?.toISOString() }
	};
}

export const BOX_MARKER = '%box_content%';

/** Wrap a card box (front or back) in the first non-empty template: the content replaces
 *  every `%box_content%`; a template without the marker is a preamble put before the content. */
export function applyTemplate(content: string, ...templates: (string | null | undefined)[]) {
	if (!content.trim()) return '';
	const tpl = templates.find((t) => t?.trim());
	if (!tpl) return content;
	// replacer function: `$&` / `$$` in Typst math must stay literal
	return tpl.includes(BOX_MARKER)
		? tpl.replaceAll(BOX_MARKER, () => content)
		: `${tpl}\n${content}`;
}
