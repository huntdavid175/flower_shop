import { createHmac, timingSafeEqual } from 'node:crypto';
import { PAYSTACK_SECRET_KEY } from 'astro:env/server';

/*
 * Paystack, Ghana.
 *
 * Amounts cross this boundary as integer pesewas, which is what Paystack
 * expects for GHS — the same minor-unit integers used everywhere else in the
 * codebase, so nothing is converted on the way out. A float here would be a
 * rounding bug that charges a customer the wrong amount.
 */

const API = 'https://api.paystack.co';

export function isPaystackConfigured(): boolean {
	return Boolean(PAYSTACK_SECRET_KEY);
}

/** Thrown when Paystack refused the request outright, rather than declining a card. */
export class PaystackError extends Error {}

async function call(
	path: string,
	init: RequestInit = {},
): Promise<Record<string, any>> {
	if (!PAYSTACK_SECRET_KEY) throw new PaystackError('Paystack is not configured.');

	const response = await fetch(API + path, {
		...init,
		headers: {
			Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
			'Content-Type': 'application/json',
			...(init.headers ?? {}),
		},
	});

	const payload = (await response.json().catch(() => null)) as Record<string, any> | null;
	if (!response.ok || !payload?.status) {
		throw new PaystackError(
			`Paystack ${path} failed (${response.status}): ${payload?.message ?? 'no response body'}`,
		);
	}
	return payload.data ?? {};
}

export interface InitializeResult {
	authorizationUrl: string;
	accessCode: string;
	reference: string;
}

/**
 * Start a transaction and get the URL to send the buyer to.
 *
 * `reference` is our own order reference, which is unique in the database. That
 * makes the hand-off idempotent from Paystack's side too: a buyer who reloads
 * the page mid-payment resumes the same transaction instead of opening a second
 * one against the same order.
 */
export async function initializeTransaction(input: {
	email: string;
	amountPesewas: number;
	reference: string;
	callbackUrl: string;
	metadata?: Record<string, unknown>;
}): Promise<InitializeResult> {
	if (!Number.isInteger(input.amountPesewas) || input.amountPesewas <= 0) {
		throw new PaystackError(`Refusing to charge ${input.amountPesewas} pesewas.`);
	}

	const data = await call('/transaction/initialize', {
		method: 'POST',
		body: JSON.stringify({
			email: input.email,
			amount: input.amountPesewas,
			currency: 'GHS',
			reference: input.reference,
			callback_url: input.callbackUrl,
			metadata: input.metadata ?? {},
			// Card and Mobile Money are what Paystack Ghana actually settles.
			channels: ['card', 'mobile_money'],
		}),
	});

	return {
		authorizationUrl: String(data.authorization_url),
		accessCode: String(data.access_code),
		reference: String(data.reference),
	};
}

export interface VerifiedTransaction {
	successful: boolean;
	reference: string;
	amountPesewas: number;
	currency: string;
	paidAt: string | null;
	channel: string | null;
}

/** Ask Paystack what really happened. The only trustworthy answer. */
export async function verifyTransaction(
	reference: string,
): Promise<VerifiedTransaction> {
	const data = await call(`/transaction/verify/${encodeURIComponent(reference)}`);
	return {
		successful: data.status === 'success',
		reference: String(data.reference ?? reference),
		amountPesewas: Number(data.amount ?? 0),
		currency: String(data.currency ?? ''),
		paidAt: data.paid_at ?? null,
		channel: data.channel ?? null,
	};
}

/**
 * Confirm a webhook really came from Paystack.
 *
 * The signature is an HMAC-SHA512 of the *raw* request body under the secret
 * key. It must be computed on the exact bytes received — parsing to JSON and
 * re-serialising changes key order and whitespace, and the digest stops
 * matching. That is why the caller passes the raw text.
 *
 * Compared with a constant-time equality: a plain `===` on a digest leaks how
 * much of a forged signature was correct, which is enough to reconstruct one
 * byte at a time.
 */
export function isValidWebhookSignature(
	rawBody: string,
	signature: string | null,
): boolean {
	if (!PAYSTACK_SECRET_KEY || !signature) return false;

	const expected = createHmac('sha512', PAYSTACK_SECRET_KEY)
		.update(rawBody, 'utf8')
		.digest('hex');

	const a = Buffer.from(expected, 'utf8');
	const b = Buffer.from(signature, 'utf8');
	// timingSafeEqual throws on a length mismatch, which is itself a leak-free
	// rejection — but it must be guarded or it becomes a 500.
	if (a.length !== b.length) return false;
	return timingSafeEqual(a, b);
}
