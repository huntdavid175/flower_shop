import type { APIRoute } from 'astro';
import { normalisePhone } from '../../lib/checkout';
import { supabaseAdmin } from '../../lib/supabase';

export const prerender = false;

/*
 * The contact form.
 *
 * Stores the enquiry rather than validating and dropping it. Someone writing to
 * a florist is usually asking about a date, a price or an order that has gone
 * wrong — losing that message costs the shop a customer and never announces
 * itself.
 */

const LIMITS = { name: 120, email: 254, phone: 40, message: 4000 };

export const POST: APIRoute = async ({ request, redirect }) => {
	const form = await request.formData();
	const text = (key: keyof typeof LIMITS) =>
		String(form.get(key) ?? '').trim().slice(0, LIMITS[key]);

	/*
	 * Honeypot. A field hidden from people but not from the crude bots that
	 * fill in every input they find. Anything in it is discarded, and we answer
	 * as though it worked — telling a bot it was caught only teaches it.
	 */
	if (String(form.get('website') ?? '').trim() !== '') {
		return redirect('/contact?sent=ok#get-in-touch', 303);
	}

	const name = text('name');
	const email = text('email').toLowerCase();
	const phone = text('phone');
	const message = text('message');

	/*
	 * Deliberately permissive on the address, matching the newsletter: the only
	 * proof an address works is delivering to it, and strict patterns mostly
	 * succeed at turning away real people with unusual addresses.
	 */
	const valid =
		name.length >= 2 &&
		/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) &&
		message.length >= 5;

	if (!valid) return redirect('/contact?sent=invalid#get-in-touch', 303);

	const { error } = await supabaseAdmin.from('contact_messages').insert({
		name,
		email,
		// Stored in the same +233 form as order phone numbers so the shop can
		// dial it, but kept as typed if it is not a Ghanaian mobile — an
		// international enquiry should not be thrown away for that.
		phone: phone ? (normalisePhone(phone) ?? phone) : null,
		message,
		marketing_consent: form.get('marketing') === 'on',
	});

	if (error) {
		// The sender must not be told "sent" when it was not.
		console.error('contact message failed to save', error);
		return redirect('/contact?sent=error#get-in-touch', 303);
	}

	return redirect('/contact?sent=ok#get-in-touch', 303);
};
