import type { APIRoute } from 'astro';
import { isValidWebhookSignature } from '../../../lib/paystack';
import { settleOrder } from '../../../lib/settle';

export const prerender = false;

/*
 * Paystack's server-to-server notification.
 *
 * This is the authority on whether an order is paid, because it arrives whether
 * or not the buyer's browser ever comes back — people close the tab the moment
 * their money leaves. The callback page settles too, but only as a courtesy so
 * the buyer sees "paid" immediately; if it never runs, this still does.
 *
 * The money checks live in `settleOrder`, shared with that page.
 */

export const POST: APIRoute = async ({ request }) => {
	/*
	 * Read the body as text, not JSON.
	 *
	 * The signature covers the exact bytes Paystack sent. Parsing and
	 * re-serialising rewrites key order and whitespace, so the digest stops
	 * matching and every genuine webhook would look like a forgery.
	 */
	const raw = await request.text();

	if (!isValidWebhookSignature(raw, request.headers.get('x-paystack-signature'))) {
		// Terse on purpose: someone probing this should learn nothing.
		console.warn('paystack webhook rejected: bad signature');
		return new Response('Invalid signature', { status: 401 });
	}

	let event: { event?: string; data?: Record<string, any> };
	try {
		event = JSON.parse(raw);
	} catch {
		return new Response('Malformed payload', { status: 400 });
	}

	// Refunds, transfers and the rest are acknowledged so Paystack stops
	// retrying, but change nothing here.
	if (event.event !== 'charge.success') {
		return new Response('Ignored', { status: 200 });
	}

	const reference = String(event.data?.reference ?? '');
	if (!reference) return new Response('No reference', { status: 400 });

	const result = await settleOrder(reference);

	switch (result.outcome) {
		case 'paid':
			if (result.newly) {
				// The single moment an order becomes real. A confirmation email and
				// the shop's own notification belong here — `newly` is true for
				// exactly one delivery, so nothing fires twice.
				console.log(`order ${reference} paid — ${result.amountPesewas} pesewas`);
			}
			return new Response('OK', { status: 200 });

		case 'unknown_order':
			// Not a 200: we may simply not have written the order yet, and a 200
			// would tell Paystack to stop retrying.
			console.error('paystack webhook: unknown order reference', reference);
			return new Response('Unknown order', { status: 404 });

		case 'unavailable':
			// Our outage, not a bad payment — ask to be told again.
			console.error('paystack verify failed', result.reason);
			return new Response('Verification failed', { status: 500 });

		case 'mismatch':
			console.error(
				`PAYMENT MISMATCH on ${reference}: paid ${result.paidPesewas}, order is ${result.expectedPesewas}. Not marking paid.`,
			);
			// 200: retrying cannot change the amount. This needs a human.
			return new Response('Amount mismatch', { status: 200 });

		case 'not_successful':
			return new Response('Not successful', { status: 200 });
	}
};

/* Paystack only ever POSTs here. */
export const GET: APIRoute = () => new Response('Not found', { status: 404 });
