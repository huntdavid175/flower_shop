import { getOrderByReference, markOrderPaid } from './orders';
import { verifyTransaction } from './paystack';

/*
 * Turning a Paystack reference into a paid order.
 *
 * Two places need this: the webhook, and the page the buyer lands on when they
 * come back from Paystack. Both must apply exactly the same money checks, so
 * they share one implementation rather than two that drift apart — an amount
 * check that exists in one path and not the other is worth nothing.
 *
 * Note what is *not* trusted here: neither caller passes in an amount. The
 * charge is re-verified against Paystack directly and compared with what the
 * order itself says it costs. The buyer's browser has no say in either number,
 * which is what makes it safe for the callback page to settle an order at all.
 */

export type SettleOutcome =
	| { outcome: 'paid'; newly: boolean; amountPesewas: number }
	| { outcome: 'unknown_order' }
	| { outcome: 'not_successful' }
	| { outcome: 'mismatch'; paidPesewas: number; expectedPesewas: number }
	| { outcome: 'unavailable'; reason: string };

export async function settleOrder(reference: string): Promise<SettleOutcome> {
	const order = await getOrderByReference(reference);
	if (!order) return { outcome: 'unknown_order' };

	if (order.status === 'paid') {
		return { outcome: 'paid', newly: false, amountPesewas: order.totalPesewas };
	}

	let verified;
	try {
		verified = await verifyTransaction(reference);
	} catch (cause) {
		return {
			outcome: 'unavailable',
			reason: cause instanceof Error ? cause.message : 'verify failed',
		};
	}

	if (!verified.successful) return { outcome: 'not_successful' };

	/*
	 * The check that matters.
	 *
	 * Without it, a buyer could start a transaction, pay one pesewa against the
	 * same reference, and a perfectly genuine `charge.success` would settle a
	 * GHS 500 order. The order's own stored total is the authority — it was
	 * frozen at checkout from database prices.
	 */
	if (verified.amountPesewas !== order.totalPesewas) {
		return {
			outcome: 'mismatch',
			paidPesewas: verified.amountPesewas,
			expectedPesewas: order.totalPesewas,
		};
	}

	if (verified.currency !== 'GHS') {
		return {
			outcome: 'mismatch',
			paidPesewas: verified.amountPesewas,
			expectedPesewas: order.totalPesewas,
		};
	}

	const newly = await markOrderPaid(
		reference,
		verified.reference,
		verified.paidAt ?? new Date().toISOString(),
	);

	return { outcome: 'paid', newly, amountPesewas: verified.amountPesewas };
}
