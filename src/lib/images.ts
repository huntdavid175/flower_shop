import { randomBytes } from 'node:crypto';
import { supabaseAdmin } from './supabase';

/*
 * Uploading shop imagery.
 *
 * Shared by products and categories — both put photographs in the same public
 * bucket, and duplicating the type checks would mean one of the two eventually
 * loses them.
 */

export const IMAGE_BUCKET = 'product-images';

/*
 * An allowlist keyed to the extension we store under, so the extension never
 * comes from the uploaded filename. A file called `bouquet.html` served from
 * our own storage domain is stored XSS.
 */
const IMAGE_TYPES: Record<string, string> = {
	'image/jpeg': 'jpg',
	'image/png': 'png',
	'image/webp': 'webp',
	'image/avif': 'avif',
};

const MAX_BYTES = 5 * 1024 * 1024; // matches the bucket's own limit

/** Store an uploaded photograph and return its public URL. */
export async function uploadImage(file: File): Promise<string> {
	const mime = file.type.split(';')[0]!.trim().toLowerCase();
	const extension = IMAGE_TYPES[mime];
	if (!extension) throw new Error('That image must be a JPEG, PNG, WebP or AVIF.');
	if (file.size > MAX_BYTES) throw new Error('That image is larger than 5MB. Please resize it.');

	const path = `${randomBytes(16).toString('hex')}.${extension}`;
	const { error } = await supabaseAdmin.storage
		.from(IMAGE_BUCKET)
		.upload(path, file, { contentType: mime, upsert: false });

	if (error) throw new Error(`Upload failed: ${error.message}`);

	const { data } = supabaseAdmin.storage.from(IMAGE_BUCKET).getPublicUrl(path);
	return data.publicUrl;
}

/**
 * Remove a previously uploaded image.
 *
 * Only touches files in our bucket: seeded rows point at `/images/...` in the
 * site's own public folder, and deleting those is not this function's job.
 */
export async function deleteImage(url: string | null): Promise<void> {
	if (!url || !url.includes(`/${IMAGE_BUCKET}/`)) return;
	const path = url.split(`/${IMAGE_BUCKET}/`).pop();
	if (!path) return;
	await supabaseAdmin.storage.from(IMAGE_BUCKET).remove([path]);
}
