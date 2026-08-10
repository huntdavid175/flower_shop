import { createClient } from '@supabase/supabase-js';
import {
	PUBLIC_SUPABASE_PUBLISHABLE_KEY,
	PUBLIC_SUPABASE_URL,
} from 'astro:env/client';
import { SUPABASE_SECRET_KEY } from 'astro:env/server';

/*
 * Two clients, deliberately.
 *
 * `supabase` uses the publishable key and is subject to row-level security, so
 * it can only ever read published catalog rows. Catalog queries use it even
 * though they run on the server — least privilege means a mistake in a product
 * query cannot accidentally expose an order.
 *
 * `supabaseAdmin` uses the secret key, which bypasses RLS entirely. Reserved
 * for order and message work. Importing it into anything that runs in the
 * browser is a build error, because SUPABASE_SECRET_KEY is declared
 * `access: 'secret'` in astro.config.mjs.
 */

const options = {
	auth: {
		// No user sessions: checkout is guest-only, so there is nothing to persist
		// or refresh, and skipping it avoids needless storage access on the server.
		persistSession: false,
		autoRefreshToken: false,
	},
} as const;

export const supabase = createClient(
	PUBLIC_SUPABASE_URL,
	PUBLIC_SUPABASE_PUBLISHABLE_KEY,
	options,
);

export const supabaseAdmin = createClient(
	PUBLIC_SUPABASE_URL,
	SUPABASE_SECRET_KEY,
	options,
);
