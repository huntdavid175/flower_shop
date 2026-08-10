import type { AstroCookies } from 'astro';
import { getVariantsById, type Product, type Variant } from './catalog';

/**
 * Guest cart, held in a cookie.
 *
 * The cookie stores only a variant id and a quantity. No prices, no names — the
 * price of a line is read from the database on every render, because the cookie
 * is user-controlled and anything stored in it can be edited to taste.
 *
 * A variant id rather than a product slug, because size is what determines
 * price: Small and Large of the same bouquet are different money and different
 * work for the shop.
 *
 * httpOnly, so client script cannot read or write it either. Every mutation
 * goes through /api/cart, keeping validation in one place.
 */
const COOKIE_NAME = 'cart';
const MAX_QUANTITY = 20;
const MAX_LINES = 20;
const COOKIE_MAX_AGE = 60 * 60 * 24 * 14; // two weeks

/** What we persist. */
export interface CartLine {
	variantId: string;
	quantity: number;
}

/** A line joined to its variant and product, priced server-side. */
export interface ResolvedLine extends CartLine {
	product: Product;
	variant: Variant;
	lineTotalPesewas: number;
}

export interface ResolvedCart {
	lines: ResolvedLine[];
	/** Total number of bouquets, for the header badge. */
	count: number;
	subtotalPesewas: number;
	/** True when a stale line was dropped, so the page can say so. */
	droppedLines: boolean;
}

/**
 * Parse the cart cookie, discarding anything malformed.
 *
 * Deliberately unforgiving: this is untrusted input, and an unparseable cookie
 * should yield an empty cart rather than throw and take the page down. Note it
 * does not check that the variant exists — that needs the database, and happens
 * in resolveCart.
 */
export function readCart(cookies: AstroCookies): CartLine[] {
	const raw = cookies.get(COOKIE_NAME)?.value;
	if (!raw) return [];

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return [];
	}
	if (!Array.isArray(parsed)) return [];

	const lines: CartLine[] = [];
	for (const entry of parsed) {
		if (typeof entry !== 'object' || entry === null) continue;

		const { variantId, quantity } = entry as Record<string, unknown>;
		if (typeof variantId !== 'string' || !isUuid(variantId)) continue;

		const qty = Number(quantity);
		if (!Number.isInteger(qty) || qty < 1) continue;

		lines.push({ variantId, quantity: Math.min(qty, MAX_QUANTITY) });
		if (lines.length >= MAX_LINES) break;
	}
	return lines;
}

export function writeCart(cookies: AstroCookies, lines: CartLine[]): void {
	if (lines.length === 0) {
		cookies.delete(COOKIE_NAME, { path: '/' });
		return;
	}
	cookies.set(COOKIE_NAME, JSON.stringify(lines), {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: import.meta.env.PROD,
		maxAge: COOKIE_MAX_AGE,
	});
}

/**
 * Empty the basket.
 *
 * Called once payment is confirmed — never earlier. A buyer whose card is
 * declined comes back to find their bouquets still there.
 */
export function clearCart(cookies: AstroCookies): void {
	writeCart(cookies, []);
}

/**
 * Join lines to their variants and total them. One database round trip
 * regardless of how many lines the cart holds.
 */
export async function resolveCart(lines: CartLine[]): Promise<ResolvedCart> {
	if (lines.length === 0) {
		return { lines: [], count: 0, subtotalPesewas: 0, droppedLines: false };
	}

	const found = await getVariantsById(lines.map((line) => line.variantId));
	const resolved: ResolvedLine[] = [];

	for (const line of lines) {
		const match = found.get(line.variantId);
		// Missing means the product or size was withdrawn since it was added.
		if (!match) continue;
		resolved.push({
			...line,
			product: match.product,
			variant: match.variant,
			lineTotalPesewas: match.variant.pricePesewas * line.quantity,
		});
	}

	return {
		lines: resolved,
		count: resolved.reduce((total, line) => total + line.quantity, 0),
		subtotalPesewas: resolved.reduce(
			(total, line) => total + line.lineTotalPesewas,
			0,
		),
		droppedLines: resolved.length < lines.length,
	};
}

/** Convenience for pages that only need the header badge. */
export async function getCartCount(cookies: AstroCookies): Promise<number> {
	const lines = readCart(cookies);
	if (lines.length === 0) return 0;
	const { count } = await resolveCart(lines);
	return count;
}

/** Add to the cart, merging with an existing line for the same variant. */
export function addLine(
	lines: CartLine[],
	variantId: string,
	quantity = 1,
): CartLine[] {
	if (!isUuid(variantId)) return lines;

	const qty = clampQuantity(quantity);
	const next = lines.map((line) => ({ ...line }));
	const existing = next.find((line) => line.variantId === variantId);

	if (existing) {
		existing.quantity = clampQuantity(existing.quantity + qty);
	} else if (next.length < MAX_LINES) {
		next.push({ variantId, quantity: qty });
	}
	return next;
}

export function setQuantity(
	lines: CartLine[],
	index: number,
	quantity: number,
): CartLine[] {
	if (!Number.isInteger(index) || index < 0 || index >= lines.length) {
		return lines;
	}
	if (quantity < 1) return removeLine(lines, index);

	return lines.map((line, i) =>
		i === index ? { ...line, quantity: clampQuantity(quantity) } : line,
	);
}

export function removeLine(lines: CartLine[], index: number): CartLine[] {
	if (!Number.isInteger(index) || index < 0 || index >= lines.length) {
		return lines;
	}
	return lines.filter((_, i) => i !== index);
}

function clampQuantity(quantity: number): number {
	if (!Number.isFinite(quantity)) return 1;
	return Math.min(Math.max(Math.trunc(quantity), 1), MAX_QUANTITY);
}

/**
 * Shape check only. A well-formed id that does not exist is dropped later by
 * resolveCart; this just keeps obvious junk out of the cookie and out of the
 * `in` clause we send to Postgres.
 */
function isUuid(value: string): boolean {
	return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
		value,
	);
}
