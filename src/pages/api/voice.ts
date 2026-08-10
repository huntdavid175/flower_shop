import type { APIRoute } from 'astro';
import { randomBytes } from 'node:crypto';
import {
	AUDIO_BUCKET,
	deleteAudioObject,
	getDraftOrder,
	getMessages,
	upsertMessage,
} from '../../lib/orders';
import { supabaseAdmin } from '../../lib/supabase';

export const prerender = false;

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB, matching the bucket's own limit

/**
 * Accepted audio types and the extension we store them under.
 *
 * An allowlist rather than a blocklist, and the extension comes from this map
 * rather than from the uploaded filename — a name like "clip.html" would
 * otherwise end up served from our storage domain.
 *
 * iOS Safari records mp4/aac while every other browser gives webm/opus, which
 * is why both are first-class here rather than one being a fallback.
 */
const ALLOWED: Record<string, string> = {
	'audio/webm': 'webm',
	'audio/ogg': 'ogg',
	'audio/mp4': 'm4a',
	'audio/x-m4a': 'm4a',
	'audio/aac': 'aac',
	'audio/mpeg': 'mp3',
	'audio/wav': 'wav',
};

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
}

/** Confirm the item belongs to this draft before touching anything. */
async function resolveTarget(
	orderId: string,
	rawItemId: string | null,
): Promise<{ ok: true; itemId: string | null } | { ok: false }> {
	if (!rawItemId) return { ok: true, itemId: null };

	const { data, error } = await supabaseAdmin
		.from('order_items')
		.select('id')
		.eq('order_id', orderId)
		.eq('id', rawItemId)
		.maybeSingle();

	if (error || !data) return { ok: false };
	return { ok: true, itemId: rawItemId };
}

export const POST: APIRoute = async ({ request, cookies }) => {
	const draft = await getDraftOrder(cookies);
	if (!draft) return json({ error: 'No order in progress.' }, 409);

	const form = await request.formData();
	const action = String(form.get('action') ?? 'upload');

	const target = await resolveTarget(
		draft.id,
		(form.get('itemId') as string | null) || null,
	);
	if (!target.ok) return json({ error: 'Unknown item.' }, 403);

	// --- Remove an existing recording ---
	if (action === 'delete') {
		const existing = (await getMessages(draft.id)).find(
			(message) => message.orderItemId === target.itemId,
		);
		if (existing?.audioPath) await deleteAudioObject(existing.audioPath);
		await upsertMessage(draft.id, target.itemId, {
			voiceKind: 'none',
			audioPath: null,
			audioMime: null,
		});
		return json({ ok: true, hasAudio: false });
	}

	// --- Store a recording or an uploaded file ---
	const file = form.get('audio');
	if (!(file instanceof File) || file.size === 0) {
		return json({ error: 'No audio received.' }, 400);
	}
	if (file.size > MAX_BYTES) {
		return json({ error: 'That recording is too long. Keep it under 10MB.' }, 413);
	}

	// Strip any codec parameter: browsers send 'audio/webm;codecs=opus'.
	const mime = file.type.split(';')[0]!.trim().toLowerCase();
	const extension = ALLOWED[mime];
	if (!extension) {
		return json({ error: 'That file type is not supported.' }, 415);
	}

	const kind = String(form.get('kind') ?? 'recorded');
	const voiceKind = kind === 'uploaded' ? 'uploaded' : 'recorded';

	const message = await upsertMessage(draft.id, target.itemId, {});
	const previousPath = message.audioPath;

	/*
	 * An opaque random name, not the order or message id.
	 *
	 * The signed URL is rendered into the public playback page, so anything in
	 * the path is published alongside the recording. Internal identifiers do not
	 * belong there — the recipient's page should give away nothing about the
	 * order it came from. Deletion works off `audio_path` on the row, so no
	 * naming convention is needed to find it again.
	 */
	const path = `${randomBytes(16).toString('hex')}.${extension}`;
	const { error: uploadError } = await supabaseAdmin.storage
		.from(AUDIO_BUCKET)
		.upload(path, file, { contentType: mime, upsert: true });

	if (uploadError) {
		return json({ error: `Upload failed: ${uploadError.message}` }, 500);
	}

	// A re-record with a different browser gives a different extension, so the
	// old object is a different key and would otherwise linger forever.
	if (previousPath && previousPath !== path) {
		await deleteAudioObject(previousPath);
	}

	const seconds = Number(form.get('seconds'));
	await upsertMessage(draft.id, target.itemId, {
		voiceKind,
		audioPath: path,
		audioMime: mime,
		audioSeconds: Number.isInteger(seconds) && seconds > 0 ? Math.min(seconds, 3600) : null,
	});

	return json({ ok: true, hasAudio: true, kind: voiceKind });
};
