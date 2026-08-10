/**
 * Money handling.
 *
 * RULE: every monetary value in this codebase is an integer number of PESEWAS
 * (the minor unit of the Ghana cedi). GHS 250.00 is 25000.
 *
 * Paystack's API requires minor units, and floating-point arithmetic on prices
 * produces off-by-a-pesewa charge errors that are painful to trace once real
 * orders exist. So we convert exactly once, at the display boundary, and never
 * store or compute with decimals.
 *
 * Variables holding minor units are named `...Pesewas` so it is never ambiguous
 * whether a number has already been converted.
 */

/** A branded integer count of pesewas, to stop cedis being passed by mistake. */
export type Pesewas = number & { readonly __brand: 'Pesewas' };

export const CURRENCY = 'GHS' as const;

/**
 * Convert a cedi amount (e.g. from an admin form) into pesewas.
 * Rounds to the nearest pesewa — inputs should already have at most 2 decimals.
 */
export function cedisToPesewas(cedis: number): Pesewas {
	if (!Number.isFinite(cedis)) {
		throw new Error(`Invalid cedi amount: ${cedis}`);
	}
	return Math.round(cedis * 100) as Pesewas;
}

/** Format pesewas for display, e.g. 25000 -> "GHS 250.00". */
export function formatPesewas(
	pesewas: number,
	options: { showCurrency?: boolean } = {},
): string {
	const { showCurrency = true } = options;
	const amount = (pesewas / 100).toLocaleString('en-GH', {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	});
	return showCurrency ? `${CURRENCY} ${amount}` : amount;
}

/**
 * Compact price for cards and listings: 5900 -> "₵59", 5950 -> "₵59.50".
 *
 * Trailing ".00" is dropped because catalog prices are usually whole cedis and
 * the decimals are noise at a glance. Anything the customer is about to pay —
 * cart lines, totals, receipts — should use `formatPesewas` instead, which
 * always shows both the currency code and the decimals.
 */
export function formatPriceShort(pesewas: number): string {
	const isWhole = pesewas % 100 === 0;
	const amount = (pesewas / 100).toLocaleString('en-GH', {
		minimumFractionDigits: isWhole ? 0 : 2,
		maximumFractionDigits: 2,
	});
	return `₵${amount}`;
}

/**
 * Sum line items safely. Kept as a helper so totalling never drifts into
 * floating-point territory somewhere in a component.
 */
export function sumPesewas(amounts: number[]): Pesewas {
	return amounts.reduce((total, amount) => {
		if (!Number.isInteger(amount)) {
			throw new Error(`Expected integer pesewas, received ${amount}`);
		}
		return total + amount;
	}, 0) as Pesewas;
}
