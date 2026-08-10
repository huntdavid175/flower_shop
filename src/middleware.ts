import { defineMiddleware } from 'astro:middleware';
import { getStaffMember } from './lib/auth';

/*
 * One gate in front of the whole admin.
 *
 * Deliberately not a check repeated at the top of each admin page: that pattern
 * works until someone adds a page and forgets, and the page that gets forgotten
 * is never the harmless one. Anything under /admin is closed unless this opens
 * it, so a new file is protected before it is written.
 *
 * The staff member is put on `locals` so pages do not each re-run the lookup.
 */

const LOGIN = '/admin/login';

export const onRequest = defineMiddleware(async (context, next) => {
	const { pathname } = context.url;

	if (!pathname.startsWith('/admin') && !pathname.startsWith('/api/admin')) {
		return next();
	}

	const staff = await getStaffMember(context.cookies, context.request);
	context.locals.staff = staff;

	// The login page itself must stay reachable, or there is no way in.
	if (pathname === LOGIN) {
		// Already signed in? Nothing to do here.
		if (staff) return context.redirect('/admin', 302);
		return next();
	}

	if (!staff) {
		/*
		 * API routes get a status code, not a redirect to an HTML page — a
		 * `fetch` receiving 200 and a login form is far more confusing to debug
		 * than a plain 401.
		 */
		if (pathname.startsWith('/api/admin')) {
			return new Response(JSON.stringify({ error: 'Not signed in.' }), {
				status: 401,
				headers: { 'Content-Type': 'application/json' },
			});
		}

		// Come back here once they have signed in, so a bookmarked order does
		// not dump them on the dashboard.
		const next_ = encodeURIComponent(pathname + context.url.search);
		return context.redirect(`${LOGIN}?next=${next_}`, 302);
	}

	return next();
});
