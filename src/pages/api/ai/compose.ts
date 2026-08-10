import type { APIRoute } from 'astro';
import { composeMessages, isComposeConfigured } from '../../../lib/ai';
import { getDraftOrder } from '../../../lib/orders';

export const prerender = false;

/*
 * Rate limiting.
 *
 * This endpoint costs money on every call and sits on the public internet, so
 * it is gated three ways: it requires a draft order (demonstrated purchase
 * intent), it caps generations per order, and it throttles bursts.
 *
 * The counter is in memory, which means it resets on deploy and is per-instance
 * on a serverless host — good enough to stop casual abuse and accidental
 * loops, not a substitute for a shared store. Move the counts onto the order
 * row when this goes to production.
 */
const MAX_PER_ORDER = 12;
const MIN_INTERVAL_MS = 3000;

const usage = new Map<string, { count: number; last: number }>();

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
}

export const POST: APIRoute = async ({ request, cookies }) => {
	if (!isComposeConfigured()) {
		return json({ error: 'Message writing is not available right now.' }, 503);
	}

	// No draft means no basket — the composer is not reachable without one.
	const draft = await getDraftOrder(cookies);
	if (!draft) return json({ error: 'No order in progress.' }, 409);

	const now = Date.now();
	const record = usage.get(draft.id) ?? { count: 0, last: 0 };

	if (record.count >= MAX_PER_ORDER) {
		return json(
			{ error: 'You have used all the suggestions for this order. Edit one of them, or write your own.' },
			429,
		);
	}
	if (now - record.last < MIN_INTERVAL_MS) {
		return json({ error: 'One moment — still thinking.' }, 429);
	}

	const body = (await request.json().catch(() => null)) as Record<
		string,
		unknown
	> | null;
	if (!body) return json({ error: 'Malformed request.' }, 400);

	const recipient = text(body.recipient, 60);
	const occasion = text(body.occasion, 40);
	const tone = text(body.tone, 40);
	const detail = text(body.detail, 300);
	const draftText = text(body.draft, 500);

	if (!recipient || !occasion || !tone) {
		return json({ error: 'Tell us who it is for, the occasion, and a tone.' }, 400);
	}

	// Reserve the slot before the call, so a hung request cannot be retried
	// into a free generation.
	usage.set(draft.id, { count: record.count + 1, last: now });

	try {
		const options = await composeMessages({
			recipient,
			occasion,
			tone,
			detail,
			draft: draftText,
		});
		if (options.length === 0) {
			return json({ error: 'Nothing came back. Try again.' }, 502);
		}
		return json({
			options,
			remaining: Math.max(0, MAX_PER_ORDER - (record.count + 1)),
		});
	} catch (cause) {
		console.error('compose failed', cause);
		return json({ error: 'Could not write a message just now.' }, 502);
	}
};

/** Trim, cap length, and reject anything that is not a string. */
function text(value: unknown, max: number): string {
	return typeof value === 'string' ? value.trim().slice(0, max) : '';
}
