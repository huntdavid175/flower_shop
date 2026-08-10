import { supabase } from './supabase';

/**
 * Catalog reads.
 *
 * Uses the publishable client, so every query here is filtered by row-level
 * security: unpublished products simply do not come back, without any
 * `is_active` condition needing to be remembered at each call site.
 */

export interface Variant {
	id: string;
	label: string;
	pricePesewas: number;
}

export interface Product {
	id: string;
	slug: string;
	name: string;
	sku: string | null;
	description: string | null;
	deliveryInformation: string | null;
	image: string;
	/** Fallback price, used when a product has no variants. */
	pricePesewas: number;
	comparePesewas?: number;
	categorySlug: string | null;
	categoryName: string | null;
	/** Sorted cheapest first. Empty when the product has no size options. */
	variants: Variant[];
}

export interface Category {
	slug: string;
	name: string;
	image: string | null;
}

const PRODUCT_FIELDS = `
	id, slug, name, sku, description, delivery_information, image_url,
	base_price_pesewas, compare_price_pesewas,
	categories ( slug, name ),
	product_variants ( id, label, price_pesewas, sort_order )
`;

/* eslint-disable @typescript-eslint/no-explicit-any */
function toProduct(row: any): Product {
	const variants: Variant[] = (row.product_variants ?? [])
		.slice()
		.sort((a: any, b: any) => a.sort_order - b.sort_order)
		.map((v: any) => ({
			id: v.id,
			label: v.label,
			pricePesewas: v.price_pesewas,
		}));

	return {
		id: row.id,
		slug: row.slug,
		name: row.name,
		sku: row.sku ?? null,
		description: row.description ?? null,
		deliveryInformation: row.delivery_information ?? null,
		image: row.image_url ?? '',
		// The card shows the cheapest way to buy the product, which is what a
		// listing price means to a customer.
		pricePesewas: variants.length
			? Math.min(...variants.map((v) => v.pricePesewas))
			: row.base_price_pesewas,
		comparePesewas: row.compare_price_pesewas ?? undefined,
		categorySlug: row.categories?.slug ?? null,
		categoryName: row.categories?.name ?? null,
		variants,
	};
}

export async function getProducts(options?: {
	limit?: number;
	offset?: number;
	categorySlug?: string | null;
}): Promise<Product[]> {
	let query = supabase
		.from('products')
		.select(PRODUCT_FIELDS)
		.order('sort_order', { ascending: true });

	if (options?.categorySlug) {
		// Filtering on the embedded table requires an inner join, otherwise
		// PostgREST returns every product with a null category attached.
		query = supabase
			.from('products')
			.select(PRODUCT_FIELDS.replace('categories (', 'categories!inner ('))
			.eq('categories.slug', options.categorySlug)
			.order('sort_order', { ascending: true });
	}

	if (options?.limit !== undefined) {
		const from = options.offset ?? 0;
		query = query.range(from, from + options.limit - 1);
	}

	const { data, error } = await query;
	if (error) throw new Error(`Failed to load products: ${error.message}`);
	return (data ?? []).map(toProduct);
}

/** Total published products, for pagination. */
export async function countProducts(
	categorySlug?: string | null,
): Promise<number> {
	const query = categorySlug
		? supabase
				.from('products')
				.select('id, categories!inner(slug)', { count: 'exact', head: true })
				.eq('categories.slug', categorySlug)
		: supabase.from('products').select('id', { count: 'exact', head: true });

	const { count, error } = await query;
	if (error) throw new Error(`Failed to count products: ${error.message}`);
	return count ?? 0;
}

export async function getProductBySlug(
	slug: string,
): Promise<Product | undefined> {
	const { data, error } = await supabase
		.from('products')
		.select(PRODUCT_FIELDS)
		.eq('slug', slug)
		.maybeSingle();

	if (error) throw new Error(`Failed to load product: ${error.message}`);
	return data ? toProduct(data) : undefined;
}

/** Other products to show alongside one being viewed. */
export async function getRelatedProducts(
	product: Product,
	limit = 4,
): Promise<Product[]> {
	// Prefer the same category; fall back to anything so the row is never empty
	// on a product that has no category set.
	const sameCategory = product.categorySlug
		? await getProducts({ categorySlug: product.categorySlug })
		: [];

	const pool =
		sameCategory.filter((p) => p.slug !== product.slug).length >= limit
			? sameCategory
			: await getProducts();

	return pool.filter((p) => p.slug !== product.slug).slice(0, limit);
}

export async function getCategories(): Promise<Category[]> {
	const { data, error } = await supabase
		.from('categories')
		.select('slug, name, image_url')
		.order('sort_order', { ascending: true });

	if (error) throw new Error(`Failed to load categories: ${error.message}`);
	return (data ?? []).map((row) => ({
		slug: row.slug,
		name: row.name,
		image: row.image_url ?? null,
	}));
}

/**
 * Resolve cart variant IDs to their product and price in one round trip.
 *
 * Returns a map keyed by variant id. Anything missing — a discontinued product
 * or unpublished variant — is simply absent, which is how stale cart lines get
 * dropped.
 */
export async function getVariantsById(ids: string[]): Promise<
	Map<string, { variant: Variant; product: Product }>
> {
	const result = new Map<string, { variant: Variant; product: Product }>();
	if (ids.length === 0) return result;

	const { data, error } = await supabase
		.from('product_variants')
		.select(`id, label, price_pesewas, products ( ${PRODUCT_FIELDS} )`)
		.in('id', ids);

	if (error) throw new Error(`Failed to load cart items: ${error.message}`);

	for (const row of data ?? []) {
		const raw = row as any;
		if (!raw.products) continue;
		result.set(raw.id, {
			variant: {
				id: raw.id,
				label: raw.label,
				pricePesewas: raw.price_pesewas,
			},
			product: toProduct(raw.products),
		});
	}
	return result;
}
