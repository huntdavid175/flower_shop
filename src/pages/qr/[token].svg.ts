import type { APIRoute } from 'astro';
import QRCode from 'qrcode';
import { supabaseAdmin } from '../../lib/supabase';

export const prerender = false;

/*
 * The scannable code that goes on the printed card.
 *
 * SVG rather than PNG because this exists to be printed: a vector stays crisp
 * at any card size, and a QR code that will not scan because it was rasterised
 * at screen resolution is a bouquet delivered without its message.
 *
 * The token in the URL is the same one the recipient's page uses. It is not a
 * secret in the sense of a password — it is printed on a card — but it is 32
 * hex characters from a CSPRNG and unrelated to the order, so it cannot be
 * guessed or walked.
 */

/** Error correction M survives a smudge or a crease without bloating the code. */
const OPTIONS = {
	errorCorrectionLevel: 'M' as const,
	margin: 2,
	width: 512,
	color: {
		dark: '#132a1f', // forest-950, so it prints as the brand's near-black
		light: '#ffffff',
	},
};

export const GET: APIRoute = async ({ params, url }) => {
	const token = String(params.token ?? '');

	// Same shape check the playback page uses; anything else is a probe.
	if (!/^[0-9a-f]{32}$/.test(token)) {
		return new Response('Not found', { status: 404 });
	}

	/*
	 * Confirm the token exists before drawing it.
	 *
	 * Otherwise this endpoint cheerfully renders a code for any 32-hex string,
	 * and the shop could print a card that leads nowhere — discovered by the
	 * recipient, holding flowers, after it is far too late to fix.
	 */
	const { data, error } = await supabaseAdmin
		.from('order_messages')
		.select('play_token')
		.eq('play_token', token)
		.maybeSingle();

	if (error || !data) return new Response('Not found', { status: 404 });

	const target = new URL(`/m/${token}`, url.origin).toString();
	const svg = await QRCode.toString(target, { ...OPTIONS, type: 'svg' });

	return new Response(svg, {
		headers: {
			'Content-Type': 'image/svg+xml; charset=utf-8',
			// The code for a given token never changes, but it must not be cached
			// by anything shared — the URL identifies one customer's message.
			'Cache-Control': 'private, max-age=3600',
			'X-Robots-Tag': 'noindex',
		},
	});
};
