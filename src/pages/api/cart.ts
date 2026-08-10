import type { APIRoute } from 'astro';
import {
	addLine,
	readCart,
	removeLine,
	setQuantity,
	writeCart,
} from '../../lib/cart';

export const prerender = false;

/**
 * The single place the cart is mutated.
 *
 * Everything here comes from a form the customer controls, so each field is
 * validated rather than trusted. Responds with a redirect (303) so a refresh
 * after submitting does not repeat the action.
 */
export const POST: APIRoute = async ({ request, cookies, redirect }) => {
	const form = await request.formData();
	const action = String(form.get('action') ?? '');

	let lines = readCart(cookies);

	switch (action) {
		case 'add': {
			lines = addLine(
				lines,
				String(form.get('variantId') ?? ''),
				Number(form.get('quantity') ?? 1),
			);
			break;
		}
		case 'update': {
			lines = setQuantity(
				lines,
				Number(form.get('index')),
				Number(form.get('quantity')),
			);
			break;
		}
		case 'remove': {
			lines = removeLine(lines, Number(form.get('index')));
			break;
		}
		default:
			return redirect('/cart', 303);
	}

	writeCart(cookies, lines);

	/*
	 * Where to go next is chosen by the form, not by a URL the customer can
	 * point anywhere: an open redirect here would let a crafted "add to cart"
	 * link bounce someone to another site after they submit.
	 */
	const destination = String(form.get('then') ?? '');
	if (destination === 'message') return redirect('/order/message', 303);
	if (destination === 'back') {
		const referer = request.headers.get('referer');
		if (referer) {
			try {
				const url = new URL(referer);
				if (url.origin === new URL(request.url).origin) {
					return redirect(`${url.pathname}?added=1`, 303);
				}
			} catch {
				// fall through to /cart
			}
		}
	}
	return redirect('/cart', 303);
};
