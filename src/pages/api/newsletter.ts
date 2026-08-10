import type { APIRoute } from 'astro';

export const prerender = false;

/**
 * Newsletter sign-up.
 *
 * Validates and bounces back with a status. It does NOT store the address yet —
 * that lands with the Supabase work, at which point this becomes an insert into
 * a `subscribers` table with a unique index on the email.
 */
export const POST: APIRoute = async ({ request, redirect }) => {
	const form = await request.formData();
	const email = String(form.get('email') ?? '')
		.trim()
		.toLowerCase();

	/*
	 * Deliberately permissive. The only reliable proof an address works is
	 * delivering to it, so this rejects obvious junk and nothing more — strict
	 * patterns mostly succeed at turning away real people with unusual addresses.
	 */
	const looksLikeEmail = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
	const isValid = looksLikeEmail && email.length <= 254;

	return redirect(
		`${backTo(request)}?newsletter=${isValid ? 'ok' : 'invalid'}#newsletter`,
		303,
	);
};

/**
 * Return the path the form was submitted from, so the footer's confirmation
 * appears on the page the visitor was actually reading.
 *
 * The referer is checked against our own origin first: redirecting to an
 * attacker-supplied header is a classic open-redirect, and the header is
 * trivially forged.
 */
function backTo(request: Request): string {
	const referer = request.headers.get('referer');
	if (!referer) return '/';

	try {
		const url = new URL(referer);
		return url.origin === new URL(request.url).origin ? url.pathname : '/';
	} catch {
		return '/';
	}
}
