import { enabledAccounts } from '#modules/mail/server/mail.ts';
import { contacts } from '#modules/mail/server/mailstore.ts';
import type { RequestHandler } from './$types';

// Addresses seen in the mail cache, for the To/Cc fields.
export const GET: RequestHandler = ({ url }) =>
	Response.json(contacts(url.searchParams.get('q') ?? '', enabledAccounts()));
