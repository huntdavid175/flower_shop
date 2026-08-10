import { supabase } from './supabase';

/*
 * Checkout rules: where we deliver, when, and what a valid form looks like.
 *
 * Kept apart from the page so the same validation runs on the POST. A browser
 * can skip `required` attributes trivially, so the page's own constraints are a
 * convenience for the buyer, never the thing being relied on.
 */

export interface DeliveryZone {
	id: string;
	name: string;
	feePesewas: number;
}

export async function getDeliveryZones(): Promise<DeliveryZone[]> {
	const { data, error } = await supabase
		.from('delivery_zones')
		.select('id, name, fee_pesewas')
		.eq('is_active', true)
		.order('sort_order');

	if (error) throw new Error(`Could not load delivery zones: ${error.message}`);
	return (data ?? []).map((zone) => ({
		id: zone.id,
		name: zone.name,
		feePesewas: zone.fee_pesewas,
	}));
}

export const DELIVERY_SLOTS = [
	{ value: 'morning', label: 'Morning (9am – 12pm)' },
	{ value: 'afternoon', label: 'Afternoon (12pm – 3pm)' },
	{ value: 'evening', label: 'Evening (3pm – 6pm)' },
] as const;

/*
 * ASSUMPTION, needs confirming with the shop: the earliest delivery is
 * tomorrow, and the calendar runs 60 days ahead.
 *
 * Florists often do same-day before a morning cutoff; that is a real business
 * decision about staffing, not something to infer. Both numbers are one edit.
 *
 * Ghana keeps UTC+0 all year with no daylight saving, so the UTC date is the
 * Accra date. This is the one place that convenience is load-bearing — it is
 * why there is no timezone library here.
 */
export const MIN_DAYS_AHEAD = 1;
export const MAX_DAYS_AHEAD = 60;

function isoDate(offsetDays: number): string {
	const date = new Date();
	date.setUTCDate(date.getUTCDate() + offsetDays);
	return date.toISOString().slice(0, 10);
}

export const earliestDeliveryDate = (): string => isoDate(MIN_DAYS_AHEAD);
export const latestDeliveryDate = (): string => isoDate(MAX_DAYS_AHEAD);

export interface CheckoutValues {
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
}

export type CheckoutErrors = Partial<Record<keyof CheckoutValues, string>>;

const FIELDS: Array<keyof CheckoutValues> = [
	'buyerName',
	'buyerEmail',
	'buyerPhone',
	'recipientName',
	'recipientPhone',
	'deliveryAddress',
	'deliveryNotes',
	'deliveryZoneId',
	'deliveryDate',
	'deliverySlot',
];

export function readCheckoutForm(form: FormData): CheckoutValues {
	const values = {} as CheckoutValues;
	for (const field of FIELDS) {
		values[field] = String(form.get(field) ?? '').trim().slice(0, 500);
	}
	return values;
}

/**
 * Normalise a Ghanaian mobile number to +233XXXXXXXXX.
 *
 * The courier has to ring this number, and buyers type it every way there is:
 * `024 123 4567`, `+233 24 123 4567`, `00233241234567`. Storing whatever was
 * typed means the shop cannot dial it reliably. Returns null when it cannot be
 * read as a Ghanaian mobile.
 */
export function normalisePhone(input: string): string | null {
	const digits = input.replace(/[^\d+]/g, '').replace(/^\+/, '');
	let national: string | null = null;

	if (/^0\d{9}$/.test(digits)) national = digits.slice(1);
	else if (/^233\d{9}$/.test(digits)) national = digits.slice(3);
	else if (/^00233\d{9}$/.test(digits)) national = digits.slice(5);
	else if (/^\d{9}$/.test(digits)) national = digits;

	// Ghanaian mobile prefixes all start 2, 5 — landlines and short codes do not.
	if (!national || !/^[25]/.test(national)) return null;
	return `+233${national}`;
}

export function validateCheckout(
	values: CheckoutValues,
	zones: DeliveryZone[],
): CheckoutErrors {
	const errors: CheckoutErrors = {};

	if (values.buyerName.length < 2) errors.buyerName = 'Please enter your name.';

	// Paystack sends the receipt here, and it is how the shop reaches the buyer
	// if a delivery goes wrong — so it is required rather than optional.
	if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(values.buyerEmail)) {
		errors.buyerEmail = 'Please enter an email we can send the receipt to.';
	}
	if (!normalisePhone(values.buyerPhone)) {
		errors.buyerPhone = 'Enter a Ghanaian mobile number, like 024 123 4567.';
	}

	if (values.recipientName.length < 2) {
		errors.recipientName = 'Who is receiving the flowers?';
	}
	if (!normalisePhone(values.recipientPhone)) {
		errors.recipientPhone = 'The courier needs a number to call on arrival.';
	}
	if (values.deliveryAddress.length < 8) {
		errors.deliveryAddress = 'Please give an address the courier can find.';
	}

	if (!zones.some((zone) => zone.id === values.deliveryZoneId)) {
		errors.deliveryZoneId = 'Choose a delivery area.';
	}

	if (!/^\d{4}-\d{2}-\d{2}$/.test(values.deliveryDate)) {
		errors.deliveryDate = 'Choose a delivery date.';
	} else if (
		values.deliveryDate < earliestDeliveryDate() ||
		values.deliveryDate > latestDeliveryDate()
	) {
		errors.deliveryDate = `Please pick a date between ${earliestDeliveryDate()} and ${latestDeliveryDate()}.`;
	}

	if (!DELIVERY_SLOTS.some((slot) => slot.value === values.deliverySlot)) {
		errors.deliverySlot = 'Choose a delivery time.';
	}

	return errors;
}
