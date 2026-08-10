import type { APIRoute } from 'astro';
import { signOut } from '../../../lib/auth';

export const prerender = false;

/*
 * POST rather than a link.
 *
 * A GET /sign-out can be triggered by anything that renders a URL — an <img>
 * in an email, a prefetching browser — and signing someone out mid-task is a
 * small denial of service. Astro's origin check covers the form post.
 */
export const POST: APIRoute = async ({ cookies, redirect, request }) => {
	await signOut(cookies, request);
	return redirect('/admin/login', 303);
};
