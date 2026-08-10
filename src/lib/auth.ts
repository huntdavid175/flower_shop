import type { AstroCookies } from 'astro';
import { createServerClient } from '@supabase/ssr';
import {
	PUBLIC_SUPABASE_URL,
	PUBLIC_SUPABASE_PUBLISHABLE_KEY,
} from 'astro:env/client';
import { supabaseAdmin } from './supabase';

/*
 * Admin sign-in.
 *
 * Two separate questions, deliberately kept apart:
 *
 *   1. Is this a real, signed-in Supabase user?   — answered by the session
 *   2. Is that user allowed in here?              — answered by the staff table
 *
 * Conflating them is the classic hole: `auth.users` is a shared pool, and the
 * day the shop adds customer accounts, "has a session" would silently become
 * "can read every order". Membership is a row in `staff`, checked on every
 * request.
 */

export interface StaffMember {
	userId: string;
	email: string;
	name: string | null;
	role: 'staff' | 'owner';
}

/**
 * A Supabase client that keeps its session in cookies.
 *
 * The publishable key is used here, not the secret one: this client acts as the
 * signed-in person and must stay subject to row-level security. Anything that
 * needs to see across all orders uses `supabaseAdmin`, after this has confirmed
 * who is asking.
 */
export function createAuthClient(cookies: AstroCookies, request: Request) {
	return createServerClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
		cookies: {
			/*
			 * Parsed from the raw header rather than through `AstroCookies`, which
			 * has no `getAll()` — it can only be asked about a name it already
			 * knows, and Supabase splits large sessions across numbered chunks
			 * (`sb-…-auth-token.0`, `.1`) whose names we cannot predict.
			 */
			getAll() {
				const header = request.headers.get('cookie') ?? '';
				if (!header) return [];
				return header
					.split(';')
					.map((pair) => {
						const eq = pair.indexOf('=');
						if (eq === -1) return null;
						return {
							name: pair.slice(0, eq).trim(),
							value: decodeURIComponent(pair.slice(eq + 1).trim()),
						};
					})
					.filter((cookie): cookie is { name: string; value: string } => cookie !== null);
			},
			setAll(toSet) {
				for (const { name, value, options } of toSet) {
					cookies.set(name, value, {
						...options,
						path: '/',
						httpOnly: true,
						sameSite: 'lax',
						secure: import.meta.env.PROD,
					});
				}
			},
		},
	});
}

/**
 * The signed-in staff member, or null.
 *
 * Uses `getUser()` rather than `getSession()`. `getSession` reads the cookie and
 * trusts what it finds; `getUser` asks the auth server to validate the token, so
 * a hand-edited cookie fails here instead of being believed.
 */
export async function getStaffMember(
	cookies: AstroCookies,
	request: Request,
): Promise<StaffMember | null> {
	const client = createAuthClient(cookies, request);

	const {
		data: { user },
		error,
	} = await client.auth.getUser();
	if (error || !user) return null;

	// Secret key on purpose: the staff row is the authority on access, and it
	// must be readable even before we know whether this user is allowed to read
	// anything at all.
	const { data: staff } = await supabaseAdmin
		.from('staff')
		.select('user_id, email, name, role, is_active')
		.eq('user_id', user.id)
		.maybeSingle();

	// Revoking access is flipping `is_active`, and it has to take effect on the
	// next request rather than whenever their session happens to expire.
	if (!staff || !staff.is_active) return null;

	return {
		userId: staff.user_id,
		email: staff.email,
		name: staff.name,
		role: staff.role,
	};
}

export async function signOut(
	cookies: AstroCookies,
	request: Request,
): Promise<void> {
	await createAuthClient(cookies, request).auth.signOut();
}
