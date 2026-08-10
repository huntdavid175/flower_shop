import { supabaseAdmin } from './supabase';

/*
 * Managing categories.
 *
 * These are what the "Shop by Category" tiles on the home page are built from,
 * and what `/shop?category=` filters on — so a category's slug is a public
 * address and its image is a piece of the shop's front page, not an
 * afterthought.
 */

export interface AdminCategoryRow {
	id: string;
	slug: string;
	name: string;
	imageUrl: string | null;
	sortOrder: number;
	isActive: boolean;
	productCount: number;
}

export interface AdminCategory {
	id: string;
	slug: string;
	name: string;
	imageUrl: string | null;
	sortOrder: number;
	isActive: boolean;
}

export async function listAdminCategories(): Promise<AdminCategoryRow[]> {
	const { data, error } = await supabaseAdmin
		.from('categories')
		.select('id, slug, name, image_url, sort_order, is_active, products(count)')
		.order('sort_order')
		.order('name');

	if (error) throw new Error(`Could not list categories: ${error.message}`);

	return (data ?? []).map((row: any) => ({
		id: row.id,
		slug: row.slug,
		name: row.name,
		imageUrl: row.image_url,
		sortOrder: row.sort_order,
		isActive: row.is_active,
		productCount: row.products?.[0]?.count ?? 0,
	}));
}

export async function getAdminCategory(id: string): Promise<AdminCategory | null> {
	const { data, error } = await supabaseAdmin
		.from('categories')
		.select('id, slug, name, image_url, sort_order, is_active')
		.eq('id', id)
		.maybeSingle();

	if (error) throw new Error(`Could not load category: ${error.message}`);
	if (!data) return null;

	return {
		id: data.id,
		slug: data.slug,
		name: data.name,
		imageUrl: data.image_url,
		sortOrder: data.sort_order,
		isActive: data.is_active,
	};
}

export interface CategoryInput {
	name: string;
	slug: string;
	sortOrder: number;
	isActive: boolean;
	imageUrl?: string | null;
}

function toRow(input: CategoryInput) {
	const row: Record<string, unknown> = {
		name: input.name,
		slug: input.slug,
		sort_order: input.sortOrder,
		is_active: input.isActive,
		updated_at: new Date().toISOString(),
	};
	// Omitted when undefined, so saving without touching the picture keeps it.
	if (input.imageUrl !== undefined) row.image_url = input.imageUrl;
	return row;
}

export async function createCategory(input: CategoryInput): Promise<string> {
	const { data, error } = await supabaseAdmin
		.from('categories')
		.insert(toRow(input))
		.select('id')
		.single();

	if (error) throw new Error(error.message);
	return data.id;
}

export async function updateCategory(id: string, input: CategoryInput): Promise<void> {
	const { error } = await supabaseAdmin.from('categories').update(toRow(input)).eq('id', id);
	if (error) throw new Error(error.message);
}

/**
 * Delete a category.
 *
 * Products reference it with `on delete set null`, so this never removes a
 * bouquet — the products simply become uncategorised and stay on sale. That is
 * the right trade: losing a category should never quietly remove stock from the
 * shop. The caller is expected to say how many products will be affected first.
 */
export async function deleteCategory(id: string): Promise<void> {
	const { error } = await supabaseAdmin.from('categories').delete().eq('id', id);
	if (error) throw new Error(error.message);
}

/** How many products point at this category, for the warning before deleting. */
export async function countProductsIn(id: string): Promise<number> {
	const { count, error } = await supabaseAdmin
		.from('products')
		.select('id', { count: 'exact', head: true })
		.eq('category_id', id);

	if (error) throw new Error(error.message);
	return count ?? 0;
}
