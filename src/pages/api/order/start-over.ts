import type { APIRoute } from 'astro';
import { clearCart } from '../../../lib/cart';
import { abandonCurrentOrder, clearSession } from '../../../lib/orders';

export const prerender = false;

/*
 * Put everything back to a clean slate: empty basket, no message, no recording,
 * no order in progress.
 *
 * POST rather than a link, because it throws away the buyer's work. A GET can
 * be fired by a prefetching browser or a link in a chat app, and a basket that
 * empties itself because someone hovered a message is not a bug anyone enjoys
 * diagnosing.
 */
export const POST: APIRoute = async ({ cookies, redirect }) => {
	await abandonCurrentOrder(cookies);
	clearCart(cookies);
	// A fresh session token too, so nothing at all links the next visit to the
	// order just walked away from.
	clearSession(cookies);

	return redirect('/shop', 303);
};
