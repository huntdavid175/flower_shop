import { supabaseAdmin } from './supabase';
import { deleteImage, uploadImage } from './images';

/*
 * Managing the catalogue.
 *
 * Behind the admin middleware, so everything here uses the secret key and can
 * see unpublished rows. Prices are integer pesewas throughout — the forms take
 * cedis because that is what a person types, and conversion happens once, at
 * the edge, in `cedisFieldToPesewas`.
 */

export interface AdminVariant {
	id: string;
	label: string;
	pricePesewas: number;
	isActive: boolean;
	sortOrder: number;
}

export interface AdminProductRow {
	id: string;
	slug: string;
	name: string;
	imageUrl: string | null;
	categoryName: string | null;
	basePricePesewas: number;
	isActive: boolean;
	variantCount: number;
	cheapestPesewas: number | null;
}

export interface AdminProduct {
	id: string;
	slug: string;
	name: string;
	sku: string | null;
	description: string | null;
	deliveryInformation: string | null;
	imageUrl: string | null;
	categoryId: string | null;
	basePricePesewas: number;
	comparePricePesewas: number | null;
	isActive: boolean;
	sortOrder: number;
	variants: AdminVariant[];
}

export async function listAdminProducts(): Promise<AdminProductRow[]> {
	const { data, error } = await supabaseAdmin
		.from('products')
		.select(
			'id, slug, name, image_url, base_price_pesewas, is_active, sort_order, categories ( name ), product_variants ( price_pesewas, is_active )',
		)
		.order('sort_order')
		.order('name');

	if (error) throw new Error(`Could not list products: ${error.message}`);

	return (data ?? []).map((row: any) => {
		const active = (row.product_variants ?? []).filter((v: any) => v.is_active);
		return {
			id: row.id,
			slug: row.slug,
			name: row.name,
			imageUrl: row.image_url,
			categoryName: row.categories?.name ?? null,
			basePricePesewas: row.base_price_pesewas,
			isActive: row.is_active,
			variantCount: active.length,
			cheapestPesewas: active.length
				? Math.min(...active.map((v: any) => v.price_pesewas))
				: null,
		};
	});
}

export async function getAdminProduct(id: string): Promise<AdminProduct | null> {
	const { data, error } = await supabaseAdmin
		.from('products')
		.select(
			`id, slug, name, sku, description, delivery_information, image_url,
			 category_id, base_price_pesewas, compare_price_pesewas, is_active, sort_order,
			 product_variants ( id, label, price_pesewas, is_active, sort_order )`,
		)
		.eq('id', id)
		.maybeSingle();

	if (error) throw new Error(`Could not load product: ${error.message}`);
	if (!data) return null;

	const row = data as any;
	return {
		id: row.id,
		slug: row.slug,
		name: row.name,
		sku: row.sku,
		description: row.description,
		deliveryInformation: row.delivery_information,
		imageUrl: row.image_url,
		categoryId: row.category_id,
		basePricePesewas: row.base_price_pesewas,
		comparePricePesewas: row.compare_price_pesewas,
		isActive: row.is_active,
		sortOrder: row.sort_order,
		variants: (row.product_variants ?? [])
			.map((v: any) => ({
				id: v.id,
				label: v.label,
				pricePesewas: v.price_pesewas,
				isActive: v.is_active,
				sortOrder: v.sort_order,
			}))
			.sort((a: AdminVariant, b: AdminVariant) => a.sortOrder - b.sortOrder),
	};
}

export async function getCategoryOptions(): Promise<Array<{ id: string; name: string }>> {
	const { data, error } = await supabaseAdmin
		.from('categories')
		.select('id, name')
		.order('sort_order');
	if (error) throw new Error(`Could not load categories: ${error.message}`);
	return data ?? [];
}

/**
 * Turn a price typed in cedis into integer pesewas.
 *
 * Returns null for anything that is not a sensible amount, so the caller can
 * report it rather than storing a NaN. `Math.round` because 59.99 * 100 is
 * 5998.999999999999 in floating point, and a bouquet priced a pesewa low every
 * time is the kind of bug nobody notices for a year.
 */
export function cedisFieldToPesewas(value: string): number | null {
	const cleaned = value.replace(/[^0-9.]/g, '').trim();
	if (!cleaned) return null;
	const amount = Number(cleaned);
	if (!Number.isFinite(amount) || amount < 0 || amount > 1_000_000) return null;
	return Math.round(amount * 100);
}

/** Pesewas back into the decimal string a form field wants. */
export function pesewasToCedisField(pesewas: number | null | undefined): string {
	if (pesewas === null || pesewas === undefined) return '';
	return (pesewas / 100).toFixed(2);
}

/**
 * A URL-safe slug.
 *
 * Generated from the name when the shop does not supply one, but never
 * regenerated on edit — a slug is the product's public address, and quietly
 * changing it when someone fixes a typo in the name breaks every link and QR
 * code already pointing at it.
 */
export function toSlug(input: string): string {
	return input
		.toLowerCase()
		.normalize('NFD')
		// Strip the combining marks NFD just split off, so "Rosé" becomes "rose".
		.replace(/[̀-ͯ]/g, '')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 60);
}

export interface ProductInput {
	name: string;
	slug: string;
	sku: string | null;
	description: string | null;
	deliveryInformation: string | null;
	categoryId: string | null;
	basePricePesewas: number;
	comparePricePesewas: number | null;
	isActive: boolean;
	sortOrder: number;
	imageUrl?: string | null;
}

export interface VariantInput {
	id?: string;
	label: string;
	pricePesewas: number;
	isActive: boolean;
	sortOrder: number;
}

function toRow(input: ProductInput) {
	const row: Record<string, unknown> = {
		name: input.name,
		slug: input.slug,
		sku: input.sku,
		description: input.description,
		delivery_information: input.deliveryInformation,
		category_id: input.categoryId,
		base_price_pesewas: input.basePricePesewas,
		compare_price_pesewas: input.comparePricePesewas,
		is_active: input.isActive,
		sort_order: input.sortOrder,
		updated_at: new Date().toISOString(),
	};
	// Left out entirely when undefined, so saving a product without touching the
	// photograph does not wipe the existing one.
	if (input.imageUrl !== undefined) row.image_url = input.imageUrl;
	return row;
}

export async function createProduct(input: ProductInput): Promise<string> {
	const { data, error } = await supabaseAdmin
		.from('products')
		.insert(toRow(input))
		.select('id')
		.single();

	if (error) throw new Error(error.message);
	return data.id;
}

export async function updateProduct(id: string, input: ProductInput): Promise<void> {
	const { error } = await supabaseAdmin.from('products').update(toRow(input)).eq('id', id);
	if (error) throw new Error(error.message);
}

/**
 * Replace a product's variants with exactly the set given.
 *
 * Variants carry the price a customer pays, and `order_items` snapshots that
 * price at purchase — so removing one here can never alter what a past order
 * says it charged. Rows are matched by id and updated in place rather than
 * deleted and recreated, because a variant id lives in shoppers' cart cookies:
 * recreating it would silently empty their baskets.
 */
export async function saveVariants(
	productId: string,
	variants: VariantInput[],
): Promise<void> {
	const existing = await supabaseAdmin
		.from('product_variants')
		.select('id')
		.eq('product_id', productId);

	if (existing.error) throw new Error(existing.error.message);

	const keep = new Set(variants.map((v) => v.id).filter(Boolean) as string[]);
	const remove = (existing.data ?? []).map((v) => v.id).filter((id) => !keep.has(id));

	if (remove.length) {
		const { error } = await supabaseAdmin
			.from('product_variants')
			.delete()
			.in('id', remove);
		if (error) throw new Error(error.message);
	}

	for (const [index, variant] of variants.entries()) {
		const payload = {
			product_id: productId,
			label: variant.label,
			price_pesewas: variant.pricePesewas,
			is_active: variant.isActive,
			sort_order: variant.sortOrder || index,
			updated_at: new Date().toISOString(),
		};

		const { error } = variant.id
			? await supabaseAdmin.from('product_variants').update(payload).eq('id', variant.id)
			: await supabaseAdmin.from('product_variants').insert(payload);

		if (error) {
			// The (product_id, label) unique constraint is the likely cause, and
			// "duplicate key value violates..." helps nobody behind a till.
			if (error.code === '23505') {
				throw new Error(`Two sizes are both called “${variant.label}”. Give them different names.`);
			}
			throw new Error(error.message);
		}
	}
}

/*
 * Kept under the old names so the product editor reads plainly; the work lives
 * in `images.ts`, shared with categories.
 */
export const uploadProductImage = uploadImage;
export const deleteProductImage = deleteImage;
