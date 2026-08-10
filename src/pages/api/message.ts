import type { APIRoute } from 'astro';
import { getDraftOrder, saveMessages } from '../../lib/orders';
import { supabaseAdmin } from '../../lib/supabase';

export const prerender = false;

const MAX_BODY = 2000;

/**
 * Save the gift message(s) on the current draft order.
 *
 * `scope=order` stores one message for everything; `scope=item` stores one per
 * bouquet, keyed by order_item id.
 */
export const POST: APIRoute = async ({ request, cookies, redirect }) => {
	const draft = await getDraftOrder(cookies);
	// No draft means the basket was emptied or the session expired. Send them
	// back rather than silently doing nothing.
	if (!draft) return redirect('/cart', 303);

	const form = await request.formData();
	const scope = form.get('scope') === 'item' ? 'item' : 'order';

	let entries: Array<{ orderItemId: string | null; body: string }> = [];

	if (scope === 'order') {
		entries = [{ orderItemId: null, body: readBody(form.get('message')) }];
	} else {
		/*
		 * The item ids arrive from the browser, so each is checked against the
		 * ones actually on this draft. Without that, a crafted form could attach
		 * a message to somebody else's order.
		 */
		const { data: owned, error } = await supabaseAdmin
			.from('order_items')
			.select('id')
			.eq('order_id', draft.id);
		if (error) throw new Error(`Item lookup failed: ${error.message}`);

		const allowed = new Set((owned ?? []).map((row) => row.id as string));

		entries = form
			.getAll('itemId')
			.map(String)
			.filter((id) => allowed.has(id))
			.map((id) => ({
				orderItemId: id,
				body: readBody(form.get(`message-${id}`)),
			}));
	}

	await saveMessages(draft.id, entries);

	return redirect('/order/checkout', 303);
};

function readBody(value: FormDataEntryValue | null): string {
	return String(value ?? '')
		.trim()
		.slice(0, MAX_BODY);
}
