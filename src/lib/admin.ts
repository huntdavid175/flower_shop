import { AUDIO_BUCKET } from './orders';
import { supabaseAdmin } from './supabase';

/*
 * Reading and moving orders, for the shop's own screens.
 *
 * Everything here uses the secret key and so sees every row. That is only safe
 * because the middleware has already established that the caller is active
 * staff — nothing in this file re-checks, and nothing in it should be reachable
 * from a page that is not behind that gate.
 */

/** Statuses the shop works through, in the order they happen. */
export const FULFILMENT_FLOW = [
	'paid',
	'preparing',
	'out_for_delivery',
	'delivered',
] as const;

export const STATUS_LABELS: Record<string, string> = {
	draft: 'Not finished',
	pending_payment: 'Awaiting payment',
	paid: 'Paid',
	preparing: 'Preparing',
	out_for_delivery: 'Out for delivery',
	delivered: 'Delivered',
	cancelled: 'Cancelled',
	refunded: 'Refunded',
};

/*
 * What may follow what.
 *
 * An explicit map rather than "any status to any status": without it, a mis-tap
 * can move a delivered order back to preparing, or mark an unpaid order
 * delivered. `cancelled` stays reachable from anything still in progress
 * because real orders do fall through at any point.
 */
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
	paid: ['preparing', 'cancelled'],
	preparing: ['out_for_delivery', 'paid', 'cancelled'],
	out_for_delivery: ['delivered', 'preparing', 'cancelled'],
	delivered: ['refunded'],
	cancelled: ['refunded'],
	// Unpaid orders are not the shop's to advance — payment moves them.
	draft: [],
	pending_payment: ['cancelled'],
	refunded: [],
};

export function allowedNextStatuses(current: string): string[] {
	return ALLOWED_TRANSITIONS[current] ?? [];
}

export interface OrderListRow {
	reference: string;
	status: string;
	buyerName: string | null;
	recipientName: string | null;
	deliveryDate: string | null;
	deliverySlot: string | null;
	totalPesewas: number;
	itemCount: number;
	hasVoice: boolean;
	paidAt: string | null;
	createdAt: string;
}

export interface ListOptions {
	status?: string;
	limit?: number;
	offset?: number;
}

export async function listOrders(
	options: ListOptions = {},
): Promise<{ rows: OrderListRow[]; total: number }> {
	const limit = Math.min(Math.max(options.limit ?? 25, 1), 100);
	const offset = Math.max(options.offset ?? 0, 0);

	let query = supabaseAdmin
		.from('orders')
		.select(
			'reference, status, buyer_name, recipient_name, delivery_date, delivery_slot, total_pesewas, paid_at, created_at, order_items(count), order_messages(audio_path)',
			{ count: 'exact' },
		)
		.order('created_at', { ascending: false })
		.range(offset, offset + limit - 1);

	if (options.status && options.status !== 'all') {
		query = query.eq('status', options.status);
	} else {
		/*
		 * Hide drafts by default.
		 *
		 * Every visitor who reaches the message step creates one, so they vastly
		 * outnumber real orders. Someone browsing a shop is not an order, and
		 * burying the paid ones under abandoned baskets makes the screen useless.
		 */
		query = query.neq('status', 'draft');
	}

	const { data, error, count } = await query;
	if (error) throw new Error(`Could not list orders: ${error.message}`);

	const rows = (data ?? []).map((row: any) => ({
		reference: row.reference,
		status: row.status,
		buyerName: row.buyer_name,
		recipientName: row.recipient_name,
		deliveryDate: row.delivery_date,
		deliverySlot: row.delivery_slot,
		totalPesewas: row.total_pesewas,
		itemCount: row.order_items?.[0]?.count ?? 0,
		hasVoice: (row.order_messages ?? []).some((m: any) => m.audio_path),
		paidAt: row.paid_at,
		createdAt: row.created_at,
	}));

	return { rows, total: count ?? rows.length };
}

export interface AdminOrderItem {
	id: string;
	productName: string;
	variantLabel: string | null;
	quantity: number;
	unitPricePesewas: number;
	lineTotalPesewas: number;
}

export interface AdminOrderMessage {
	id: string;
	orderItemId: string | null;
	body: string | null;
	voiceKind: string;
	playToken: string;
	audioPath: string | null;
	audioSeconds: number | null;
	/** Short-lived link for the shop to listen to the recording. */
	audioUrl: string | null;
}

export interface AdminOrder {
	id: string;
	reference: string;
	status: string;
	buyerName: string | null;
	buyerEmail: string | null;
	buyerPhone: string | null;
	recipientName: string | null;
	recipientPhone: string | null;
	deliveryAddress: string | null;
	deliveryNotes: string | null;
	deliveryZone: string | null;
	deliveryDate: string | null;
	deliverySlot: string | null;
	subtotalPesewas: number;
	deliveryFeePesewas: number;
	totalPesewas: number;
	paystackReference: string | null;
	paidAt: string | null;
	createdAt: string;
	items: AdminOrderItem[];
	messages: AdminOrderMessage[];
}

export async function getAdminOrder(
	reference: string,
): Promise<AdminOrder | null> {
	const { data, error } = await supabaseAdmin
		.from('orders')
		.select(
			`id, reference, status, buyer_name, buyer_email, buyer_phone,
			 recipient_name, recipient_phone, delivery_address, delivery_notes,
			 delivery_date, delivery_slot, subtotal_pesewas, delivery_fee_pesewas,
			 total_pesewas, paystack_reference, paid_at, created_at,
			 delivery_zones ( name ),
			 order_items ( id, product_name, variant_label, quantity, unit_price_pesewas, line_total_pesewas ),
			 order_messages ( id, order_item_id, body, voice_kind, play_token, audio_path, audio_seconds )`,
		)
		.eq('reference', reference)
		.maybeSingle();

	if (error) throw new Error(`Could not load order: ${error.message}`);
	if (!data) return null;

	const row = data as any;

	/*
	 * Sign each recording for playback.
	 *
	 * The bucket is private, so even the shop's own screen needs a signed link.
	 * Short-lived on purpose: this URL ends up in the admin's HTML, and an hour
	 * is long enough to listen while it is open and short enough that a stale
	 * copy is worthless.
	 */
	const messages: AdminOrderMessage[] = await Promise.all(
		(row.order_messages ?? []).map(async (message: any) => {
			let audioUrl: string | null = null;
			if (message.audio_path) {
				const { data: signed } = await supabaseAdmin.storage
					.from(AUDIO_BUCKET)
					.createSignedUrl(message.audio_path, 60 * 60);
				audioUrl = signed?.signedUrl ?? null;
			}
			return {
				id: message.id,
				orderItemId: message.order_item_id,
				body: message.body,
				voiceKind: message.voice_kind,
				playToken: message.play_token,
				audioPath: message.audio_path,
				audioSeconds: message.audio_seconds,
				audioUrl,
			};
		}),
	);

	return {
		id: row.id,
		reference: row.reference,
		status: row.status,
		buyerName: row.buyer_name,
		buyerEmail: row.buyer_email,
		buyerPhone: row.buyer_phone,
		recipientName: row.recipient_name,
		recipientPhone: row.recipient_phone,
		deliveryAddress: row.delivery_address,
		deliveryNotes: row.delivery_notes,
		deliveryZone: row.delivery_zones?.name ?? null,
		deliveryDate: row.delivery_date,
		deliverySlot: row.delivery_slot,
		subtotalPesewas: row.subtotal_pesewas,
		deliveryFeePesewas: row.delivery_fee_pesewas,
		totalPesewas: row.total_pesewas,
		paystackReference: row.paystack_reference,
		paidAt: row.paid_at,
		createdAt: row.created_at,
		items: (row.order_items ?? []).map((item: any) => ({
			id: item.id,
			productName: item.product_name,
			variantLabel: item.variant_label,
			quantity: item.quantity,
			unitPricePesewas: item.unit_price_pesewas,
			lineTotalPesewas: item.line_total_pesewas,
		})),
		messages,
	};
}

/**
 * Move an order along. Refuses a transition the flow does not allow.
 *
 * The current status is re-read and re-checked inside the update rather than
 * trusted from the form: two people working the same order on two phones is
 * ordinary in a shop, and the second tap must not undo the first.
 */
export async function updateOrderStatus(
	reference: string,
	nextStatus: string,
): Promise<{ ok: true; status: string } | { ok: false; reason: string }> {
	const { data: current, error: readError } = await supabaseAdmin
		.from('orders')
		.select('status')
		.eq('reference', reference)
		.maybeSingle();

	if (readError) throw new Error(`Order lookup failed: ${readError.message}`);
	if (!current) return { ok: false, reason: 'That order no longer exists.' };

	if (!allowedNextStatuses(current.status).includes(nextStatus)) {
		return {
			ok: false,
			reason: `An order that is "${STATUS_LABELS[current.status] ?? current.status}" cannot become "${STATUS_LABELS[nextStatus] ?? nextStatus}".`,
		};
	}

	const { data, error } = await supabaseAdmin
		.from('orders')
		.update({ status: nextStatus, updated_at: new Date().toISOString() })
		.eq('reference', reference)
		// Guards the gap between reading the status above and writing it here.
		.eq('status', current.status)
		.select('status');

	if (error) throw new Error(`Could not update the order: ${error.message}`);
	if (!data || data.length === 0) {
		return { ok: false, reason: 'Someone else changed this order first — reload to see where it is now.' };
	}

	return { ok: true, status: nextStatus };
}

/* ------------------------------------------------------------------ */
/* Reports                                                             */
/* ------------------------------------------------------------------ */

export interface SalesReport {
	from: string;
	to: string;
	orderCount: number;
	revenuePesewas: number;
	deliveryPesewas: number;
	refundedPesewas: number;
	refundedCount: number;
	averageOrderPesewas: number;
	withVoiceCount: number;
	byProduct: Array<{ name: string; quantity: number; revenuePesewas: number }>;
	byZone: Array<{ name: string; orders: number; feesPesewas: number }>;
	byDay: Array<{ date: string; orders: number; revenuePesewas: number }>;
}

/**
 * Sales for a period, counted from when money arrived.
 *
 * Keyed on `paid_at`, not `created_at`: an order placed on the last day of a
 * month and paid on the first of the next belongs to the month it was paid in,
 * which is what the shop's books will say. Unpaid orders are absent entirely —
 * a basket someone abandoned is not a sale, and counting it would inflate every
 * figure on the page.
 */
export async function salesReport(from: string, to: string): Promise<SalesReport> {
	// `to` is inclusive, so reach to the end of that day rather than its start.
	const toExclusive = new Date(`${to}T00:00:00Z`);
	toExclusive.setUTCDate(toExclusive.getUTCDate() + 1);

	const { data, error } = await supabaseAdmin
		.from('orders')
		.select(
			`reference, status, total_pesewas, subtotal_pesewas, delivery_fee_pesewas, paid_at,
			 delivery_zones ( name ),
			 order_items ( product_name, quantity, line_total_pesewas ),
			 order_messages ( audio_path )`,
		)
		.not('paid_at', 'is', null)
		.gte('paid_at', `${from}T00:00:00Z`)
		.lt('paid_at', toExclusive.toISOString())
		.order('paid_at', { ascending: true });

	if (error) throw new Error(`Could not build the report: ${error.message}`);

	const rows = (data ?? []) as any[];

	const products = new Map<string, { quantity: number; revenuePesewas: number }>();
	const zones = new Map<string, { orders: number; feesPesewas: number }>();
	const days = new Map<string, { orders: number; revenuePesewas: number }>();

	let revenuePesewas = 0;
	let deliveryPesewas = 0;
	let refundedPesewas = 0;
	let refundedCount = 0;
	let orderCount = 0;
	let withVoiceCount = 0;

	for (const row of rows) {
		/*
		 * A refund is money that came in and went back out. Kept out of revenue
		 * but reported separately — netting it away silently would leave the shop
		 * unable to see that it happened at all.
		 */
		if (row.status === 'refunded') {
			refundedPesewas += row.total_pesewas;
			refundedCount += 1;
			continue;
		}

		orderCount += 1;
		revenuePesewas += row.total_pesewas;
		deliveryPesewas += row.delivery_fee_pesewas;

		if ((row.order_messages ?? []).some((m: any) => m.audio_path)) withVoiceCount += 1;

		const day = String(row.paid_at).slice(0, 10);
		const dayEntry = days.get(day) ?? { orders: 0, revenuePesewas: 0 };
		dayEntry.orders += 1;
		dayEntry.revenuePesewas += row.total_pesewas;
		days.set(day, dayEntry);

		const zoneName = row.delivery_zones?.name ?? 'No zone recorded';
		const zoneEntry = zones.get(zoneName) ?? { orders: 0, feesPesewas: 0 };
		zoneEntry.orders += 1;
		zoneEntry.feesPesewas += row.delivery_fee_pesewas;
		zones.set(zoneName, zoneEntry);

		for (const item of row.order_items ?? []) {
			/*
			 * Grouped by the name stored on the order line, not by product id.
			 * That name was snapshotted at purchase, so a bouquet later renamed or
			 * deleted still appears here under what it was actually sold as.
			 */
			const entry = products.get(item.product_name) ?? { quantity: 0, revenuePesewas: 0 };
			entry.quantity += item.quantity;
			entry.revenuePesewas += item.line_total_pesewas;
			products.set(item.product_name, entry);
		}
	}

	return {
		from,
		to,
		orderCount,
		revenuePesewas,
		deliveryPesewas,
		refundedPesewas,
		refundedCount,
		averageOrderPesewas: orderCount === 0 ? 0 : Math.round(revenuePesewas / orderCount),
		withVoiceCount,
		byProduct: [...products.entries()]
			.map(([name, value]) => ({ name, ...value }))
			.sort((a, b) => b.revenuePesewas - a.revenuePesewas),
		byZone: [...zones.entries()]
			.map(([name, value]) => ({ name, ...value }))
			.sort((a, b) => b.orders - a.orders),
		byDay: [...days.entries()]
			.map(([date, value]) => ({ date, ...value }))
			.sort((a, b) => a.date.localeCompare(b.date)),
	};
}
