import type { AstroCookies } from 'astro';
import { randomBytes, randomUUID } from 'node:crypto';
import { supabaseAdmin } from './supabase';
import type { ResolvedCart } from './cart';

/**
 * Draft orders.
 *
 * A row in `orders` with status 'draft' is created as soon as the visitor
 * reaches the message step, so their words and any audio have somewhere to live
 * before a payment exists. The Paystack webhook later flips the same row to
 * 'paid' — there is no copying between tables, so nothing can be lost in the
 * hand-off.
 *
 * Everything here uses the admin client. Orders have no row-level security
 * policies at all, so this is the only way to touch them, and none of it is
 * reachable from the browser.
 */

const SESSION_COOKIE = 'sid';
const SESSION_MAX_AGE = 60 * 60 * 24 * 14; // two weeks, matching the cart

export interface DraftItem {
	id: string;
	productName: string;
	variantLabel: string | null;
	quantity: number;
	lineTotalPesewas: number;
	image: string;
	slug: string;
}

export interface DraftOrder {
	id: string;
	reference: string;
	items: DraftItem[];
	subtotalPesewas: number;
}

/**
 * Read the browser's session token, minting one if absent.
 *
 * This identifies a basket, not a person — it grants no access to anything and
 * is never used for authentication. It exists so a visitor who reloads the
 * message step gets their own draft back instead of a new one.
 */
export function getSessionToken(cookies: AstroCookies): string {
	const existing = cookies.get(SESSION_COOKIE)?.value;
	if (existing && /^[0-9a-f-]{36}$/i.test(existing)) return existing;

	const token = randomUUID();
	cookies.set(SESSION_COOKIE, token, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: import.meta.env.PROD,
		maxAge: SESSION_MAX_AGE,
	});
	return token;
}

/** Human-facing order number. Short enough to read down a phone line. */
function newReference(): string {
	const stamp = Date.now().toString(36).toUpperCase();
	const noise = randomBytes(3).toString('hex').toUpperCase();
	return `FL-${stamp}-${noise}`;
}

/**
 * The order this browser is currently working on, if any.
 *
 * The single definition of "current", used by everything that needs to know.
 * It previously existed twice — once here and once in `getDraftOrder` — and the
 * two drifted: this one learned to reclaim a 'pending_payment' order and the
 * other did not. The result was a page that loaded the buyer's saved message
 * while every button acting on it answered "no order in progress". One function
 * so that cannot happen again.
 *
 * Why 'pending_payment' counts: an order sits there from the moment the buyer
 * is sent to Paystack until they pay. Excluding it hands a returning buyer a
 * brand new order while their message and recording stay on the old one — so
 * they pay for an order carrying no message at all.
 *
 * A paid order is never reclaimed: the webhook nulls `session_token`, so the
 * next purchase from the same browser correctly starts fresh.
 */
async function findCurrentOrder(
	sessionToken: string,
): Promise<{ id: string; reference: string; status: string } | null> {
	/*
	 * Ignore anything older than the cart cookie itself.
	 *
	 * Without this, a basket abandoned months ago is resurrected the moment its
	 * owner returns, complete with a message written for an occasion long past.
	 * Matching the cookie's own lifetime keeps the two from disagreeing.
	 */
	const cutoff = new Date();
	cutoff.setDate(cutoff.getDate() - 14);

	const { data, error } = await supabaseAdmin
		.from('orders')
		.select('id, reference, status')
		.eq('session_token', sessionToken)
		.in('status', ['draft', 'pending_payment'])
		.gte('created_at', cutoff.toISOString())
		// Newest first with limit(1) rather than `maybeSingle()`: rows stranded by
		// earlier behaviour can still make this match more than one, and
		// `maybeSingle` turns that into an error instead of an answer.
		.order('created_at', { ascending: false })
		.limit(1);

	if (error) throw new Error(`Draft lookup failed: ${error.message}`);
	return data?.[0] ?? null;
}

/**
 * Ensure a draft order exists for this session and that its items match the
 * cart exactly.
 *
 * Items are replaced wholesale rather than diffed. On a draft that is both
 * simpler and safer — a partial diff that goes wrong leaves an order whose
 * lines disagree with the basket, and the customer would pay the difference.
 */
export async function syncDraftOrder(
	cookies: AstroCookies,
	cart: ResolvedCart,
): Promise<DraftOrder | null> {
	if (cart.lines.length === 0) return null;

	const sessionToken = getSessionToken(cookies);
	const existing = await findCurrentOrder(sessionToken);

	let orderId = existing?.id as string | undefined;
	let reference = existing?.reference as string | undefined;

	if (!orderId) {
		const { data: created, error: createError } = await supabaseAdmin
			.from('orders')
			.insert({
				reference: newReference(),
				status: 'draft',
				session_token: sessionToken,
				subtotal_pesewas: cart.subtotalPesewas,
				total_pesewas: cart.subtotalPesewas,
			})
			.select('id, reference')
			.single();

		if (createError) throw new Error(`Draft create failed: ${createError.message}`);
		orderId = created.id;
		reference = created.reference;
	}

	// Replace the lines. Deleting first means a removed cart item cannot linger.
	const { error: clearError } = await supabaseAdmin
		.from('order_items')
		.delete()
		.eq('order_id', orderId);
	if (clearError) throw new Error(`Draft clear failed: ${clearError.message}`);

	const { data: items, error: insertError } = await supabaseAdmin
		.from('order_items')
		.insert(
			cart.lines.map((line) => ({
				order_id: orderId,
				product_id: line.product.id,
				variant_id: line.variant.id,
				// Snapshots: what the customer is agreeing to, frozen here so a
				// later price change cannot rewrite it.
				product_name: line.product.name,
				variant_label: line.variant.label,
				unit_price_pesewas: line.variant.pricePesewas,
				quantity: line.quantity,
				line_total_pesewas: line.lineTotalPesewas,
			})),
		)
		.select('id, product_name, variant_label, quantity, line_total_pesewas');

	if (insertError) throw new Error(`Draft items failed: ${insertError.message}`);

	/*
	 * Only re-price a row that is still a draft.
	 *
	 * A 'pending_payment' order has a live Paystack transaction against its
	 * total. Rewriting that total while the buyer sits on the payment page would
	 * make the settlement amount check fail against the very amount they just
	 * paid — money taken, order stuck unpaid. The next completed checkout calls
	 * `saveCheckoutDetails`, which recomputes everything from the current cart
	 * anyway, so nothing is lost by leaving it alone here.
	 */
	if ((existing?.status ?? 'draft') === 'draft') {
		const { error: totalError } = await supabaseAdmin
			.from('orders')
			.update({
				subtotal_pesewas: cart.subtotalPesewas,
				total_pesewas: cart.subtotalPesewas,
			})
			.eq('id', orderId)
			.eq('status', 'draft');
		if (totalError) throw new Error(`Draft total failed: ${totalError.message}`);
	}

	// Pair each stored item back to its cart line so the page can show the
	// photograph, which the order tables deliberately do not duplicate.
	const decorated: DraftItem[] = (items ?? []).map((item, index) => ({
		id: item.id,
		productName: item.product_name,
		variantLabel: item.variant_label,
		quantity: item.quantity,
		lineTotalPesewas: item.line_total_pesewas,
		image: cart.lines[index]?.product.image ?? '',
		slug: cart.lines[index]?.product.slug ?? '',
	}));

	return {
		id: orderId!,
		reference: reference!,
		items: decorated,
		subtotalPesewas: cart.subtotalPesewas,
	};
}

/** Find this session's draft without touching it. */
export async function getDraftOrder(
	cookies: AstroCookies,
): Promise<{ id: string; reference: string } | null> {
	/*
	 * Reads the cookie rather than minting one, unlike `syncDraftOrder`. A
	 * visitor with no session has no order, and a GET should not be creating
	 * identities as a side effect.
	 */
	const sessionToken = cookies.get(SESSION_COOKIE)?.value;
	if (!sessionToken) return null;

	return findCurrentOrder(sessionToken);
}

export interface StoredMessage {
	id: string;
	orderItemId: string | null;
	body: string | null;
	voiceKind: 'none' | 'recorded' | 'uploaded' | 'tts';
	audioPath: string | null;
	playToken: string;
}

export async function getMessages(orderId: string): Promise<StoredMessage[]> {
	const { data, error } = await supabaseAdmin
		.from('order_messages')
		.select('id, order_item_id, body, voice_kind, audio_path, play_token')
		.eq('order_id', orderId);

	if (error) throw new Error(`Message lookup failed: ${error.message}`);
	return (data ?? []).map((row) => ({
		id: row.id,
		orderItemId: row.order_item_id,
		body: row.body,
		voiceKind: row.voice_kind,
		audioPath: row.audio_path,
		playToken: row.play_token,
	}));
}

/**
 * The token behind the QR code.
 *
 * 32 hex characters from a CSPRNG — not derived from the order in any way. The
 * playback page is necessarily unauthenticated (the recipient is a stranger
 * holding a printed card), so unguessability is the only thing standing between
 * a private message and anyone who fancies walking the URL space.
 */
export function newPlayToken(): string {
	return randomBytes(16).toString('hex');
}

/**
 * Save the written messages on a draft.
 *
 * Upsert rather than replace: a recording may already be attached, and
 * deleting the row to rewrite the words would take the audio with it. Rows
 * whose target is no longer in scope are removed first — that is what happens
 * when someone switches from per-bouquet back to one message for everything,
 * and dropping their audio along with them is the correct outcome.
 */
export async function saveMessages(
	orderId: string,
	entries: Array<{ orderItemId: string | null; body: string }>,
): Promise<void> {
	const targets = entries.map((entry) => entry.orderItemId);
	const keepOrderWide = targets.includes(null);
	const keepItemIds = targets.filter((id): id is string => id !== null);

	// Remove out-of-scope rows, and their audio with them.
	const stale = (await getMessages(orderId)).filter((message) =>
		message.orderItemId === null ? !keepOrderWide : !keepItemIds.includes(message.orderItemId),
	);
	for (const message of stale) {
		if (message.audioPath) await deleteAudioObject(message.audioPath);
	}
	if (stale.length > 0) {
		const { error } = await supabaseAdmin
			.from('order_messages')
			.delete()
			.in(
				'id',
				stale.map((message) => message.id),
			);
		if (error) throw new Error(`Message cleanup failed: ${error.message}`);
	}

	for (const entry of entries) {
		await upsertMessage(orderId, entry.orderItemId, { body: entry.body.trim().slice(0, 2000) });
	}
}

/**
 * Create or update one message row.
 *
 * Written as a read-then-write rather than a Postgres upsert because the
 * uniqueness is enforced by two *partial* indexes, which `on conflict` cannot
 * target. Concurrency is not a concern: a single visitor edits their own draft.
 */
export async function upsertMessage(
	orderId: string,
	orderItemId: string | null,
	fields: Partial<{
		body: string;
		voiceKind: 'none' | 'recorded' | 'uploaded' | 'tts';
		audioPath: string | null;
		audioMime: string | null;
		audioSeconds: number | null;
	}>,
): Promise<StoredMessage> {
	let query = supabaseAdmin
		.from('order_messages')
		.select('id, order_item_id, body, voice_kind, audio_path, play_token')
		.eq('order_id', orderId);
	query = orderItemId === null ? query.is('order_item_id', null) : query.eq('order_item_id', orderItemId);

	const { data: existing, error: findError } = await query.maybeSingle();
	if (findError) throw new Error(`Message lookup failed: ${findError.message}`);

	const patch: Record<string, unknown> = {};
	if (fields.body !== undefined) patch.body = fields.body;
	if (fields.voiceKind !== undefined) patch.voice_kind = fields.voiceKind;
	if (fields.audioPath !== undefined) patch.audio_path = fields.audioPath;
	if (fields.audioMime !== undefined) patch.audio_mime = fields.audioMime;
	if (fields.audioSeconds !== undefined) patch.audio_seconds = fields.audioSeconds;

	if (existing) {
		// Callers use an empty patch purely to guarantee the row exists (the
		// upload endpoint needs its id to name the audio object). An empty
		// PostgREST update touches no columns and returns no rows, which makes
		// `.single()` fail — so there is nothing to send.
		if (Object.keys(patch).length === 0) return toStoredMessage(existing);

		const { data, error } = await supabaseAdmin
			.from('order_messages')
			.update(patch)
			.eq('id', existing.id)
			.select('id, order_item_id, body, voice_kind, audio_path, play_token')
			.single();
		if (error) throw new Error(`Message update failed: ${error.message}`);
		return toStoredMessage(data);
	}

	const { data, error } = await supabaseAdmin
		.from('order_messages')
		.insert({
			order_id: orderId,
			order_item_id: orderItemId,
			body_source: 'typed',
			voice_kind: 'none',
			play_token: newPlayToken(),
			...patch,
		})
		.select('id, order_item_id, body, voice_kind, audio_path, play_token')
		.single();
	if (error) throw new Error(`Message insert failed: ${error.message}`);
	return toStoredMessage(data);
}

function toStoredMessage(row: any): StoredMessage {
	return {
		id: row.id,
		orderItemId: row.order_item_id,
		body: row.body,
		voiceKind: row.voice_kind,
		audioPath: row.audio_path,
		playToken: row.play_token,
	};
}

/** Remove an object from the private audio bucket, ignoring a missing file. */
export async function deleteAudioObject(path: string): Promise<void> {
	await supabaseAdmin.storage.from(AUDIO_BUCKET).remove([path]);
}

export const AUDIO_BUCKET = 'voice-messages';

/* ------------------------------------------------------------------ */
/* Checkout                                                            */
/* ------------------------------------------------------------------ */

export interface OrderMoney {
	subtotalPesewas: number;
	deliveryFeePesewas: number;
	totalPesewas: number;
}

/**
 * Write the delivery details and freeze the money onto the order.
 *
 * The amounts are passed in already recomputed from the database — never from
 * the submitted form — and are stored here so that a later price change or an
 * edited zone fee cannot alter what an existing order says it charged.
 *
 * Status moves to 'pending_payment'. It does *not* move to 'paid': only the
 * verified webhook does that.
 */
export async function saveCheckoutDetails(
	orderId: string,
	details: {
		buyerName: string;
		buyerEmail: string;
		buyerPhone: string;
		recipientName: string;
		recipientPhone: string;
		deliveryAddress: string;
		deliveryNotes: string;
		deliveryZoneId: string;
		deliveryDate: string;
		deliverySlot: string;
	},
	money: OrderMoney,
): Promise<void> {
	const { error } = await supabaseAdmin
		.from('orders')
		.update({
			buyer_name: details.buyerName,
			buyer_email: details.buyerEmail,
			buyer_phone: details.buyerPhone,
			recipient_name: details.recipientName,
			recipient_phone: details.recipientPhone,
			delivery_address: details.deliveryAddress,
			delivery_notes: details.deliveryNotes || null,
			delivery_zone_id: details.deliveryZoneId,
			delivery_date: details.deliveryDate,
			delivery_slot: details.deliverySlot,
			subtotal_pesewas: money.subtotalPesewas,
			delivery_fee_pesewas: money.deliveryFeePesewas,
			total_pesewas: money.totalPesewas,
			status: 'pending_payment',
			updated_at: new Date().toISOString(),
		})
		.eq('id', orderId)
		// A paid order is finished. Re-submitting the checkout form must never
		// rewrite the address or the amount on something already settled.
		.in('status', ['draft', 'pending_payment']);

	if (error) throw new Error(`Could not save checkout details: ${error.message}`);
}

export interface OrderSummary {
	id: string;
	reference: string;
	status: string;
	buyerEmail: string | null;
	recipientName: string | null;
	deliveryDate: string | null;
	deliverySlot: string | null;
	subtotalPesewas: number;
	deliveryFeePesewas: number;
	totalPesewas: number;
	paidAt: string | null;
}

function toSummary(row: Record<string, any>): OrderSummary {
	return {
		id: row.id,
		reference: row.reference,
		status: row.status,
		buyerEmail: row.buyer_email,
		recipientName: row.recipient_name,
		deliveryDate: row.delivery_date,
		deliverySlot: row.delivery_slot,
		subtotalPesewas: row.subtotal_pesewas,
		deliveryFeePesewas: row.delivery_fee_pesewas,
		totalPesewas: row.total_pesewas,
		paidAt: row.paid_at,
	};
}

const SUMMARY_COLUMNS =
	'id, reference, status, buyer_email, recipient_name, delivery_date, delivery_slot, subtotal_pesewas, delivery_fee_pesewas, total_pesewas, paid_at';

export async function getOrderByReference(
	reference: string,
): Promise<OrderSummary | null> {
	const { data, error } = await supabaseAdmin
		.from('orders')
		.select(SUMMARY_COLUMNS)
		.eq('reference', reference)
		.maybeSingle();

	if (error) throw new Error(`Order lookup failed: ${error.message}`);
	return data ? toSummary(data) : null;
}

/**
 * Mark an order paid. Safe to call repeatedly.
 *
 * Paystack retries webhooks until it gets a 200, and sends the same event more
 * than once in normal operation, so this has to be idempotent. The status guard
 * in the `update` does that work: the second delivery matches no rows and
 * changes nothing, rather than overwriting `paid_at` with a later timestamp.
 *
 * Returns true only for the delivery that actually caused the transition, which
 * is the one safe place to hang side effects like a confirmation email.
 */
export async function markOrderPaid(
	reference: string,
	paystackReference: string,
	paidAt: string,
): Promise<boolean> {
	const { data, error } = await supabaseAdmin
		.from('orders')
		.update({
			status: 'paid',
			paystack_reference: paystackReference,
			paid_at: paidAt,
			// The draft belonged to a browser session; a paid order belongs to the
			// shop. Clearing this stops a later visitor on the same cookie from
			// picking the order back up as their draft.
			session_token: null,
			updated_at: new Date().toISOString(),
		})
		.eq('reference', reference)
		.in('status', ['draft', 'pending_payment'])
		.select('id');

	if (error) throw new Error(`Could not mark order paid: ${error.message}`);
	return (data ?? []).length > 0;
}

/**
 * Walk away from the order this browser is working on.
 *
 * What happens depends on how far it got, and the distinction matters more than
 * it looks:
 *
 *   draft            — no payment was ever started, so the row is deleted
 *                      outright, taking its items and messages with it by
 *                      cascade. Audio has to go first: storage objects are not
 *                      foreign keys and would otherwise be orphaned, paid for
 *                      forever with nothing pointing at them.
 *
 *   pending_payment  — a live Paystack transaction exists against this
 *                      reference. Deleting it would mean a buyer who pays from
 *                      a tab they left open has their money taken while the
 *                      webhook finds no order to settle. So the row is kept and
 *                      merely detached from the browser: `session_token` is
 *                      nulled, which is exactly what `markOrderPaid` ignores
 *                      and what `findCurrentOrder` matches on. A late payment
 *                      still settles; the shopper still gets a clean slate.
 */
export async function abandonCurrentOrder(
	cookies: AstroCookies,
): Promise<'deleted' | 'detached' | 'nothing'> {
	const sessionToken = cookies.get(SESSION_COOKIE)?.value;
	if (!sessionToken) return 'nothing';

	const current = await findCurrentOrder(sessionToken);
	if (!current) return 'nothing';

	if (current.status === 'draft') {
		for (const message of await getMessages(current.id)) {
			if (message.audioPath) await deleteAudioObject(message.audioPath);
		}

		const { error } = await supabaseAdmin
			.from('orders')
			.delete()
			.eq('id', current.id)
			// Re-checked at the moment of deletion: between the read above and
			// here, a payment could have arrived and moved it on.
			.eq('status', 'draft');

		if (error) throw new Error(`Could not abandon the order: ${error.message}`);
		return 'deleted';
	}

	const { error } = await supabaseAdmin
		.from('orders')
		.update({ session_token: null, updated_at: new Date().toISOString() })
		.eq('id', current.id)
		.eq('status', 'pending_payment');

	if (error) throw new Error(`Could not release the order: ${error.message}`);
	return 'detached';
}

/** Forget the browser's session entirely, so the next visit starts clean. */
export function clearSession(cookies: AstroCookies): void {
	cookies.delete(SESSION_COOKIE, { path: '/' });
}
