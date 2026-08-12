// @ts-check
import { defineConfig, envField, fontProviders } from 'astro/config';
import vercel from '@astrojs/vercel';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
	// Server-rendered by default: the catalog, cart, checkout and admin all read
	// live data. Purely static pages opt out per-file with `export const prerender = true`.
	output: 'server',
	adapter: vercel(),
	integrations: [react()],
	vite: {
		plugins: [tailwindcss()],
	},

	/*
	 * Fonts are downloaded at build time and served from our own origin, so there
	 * is no request to Google at runtime. Astro also generates a metric-matched
	 * fallback for each, which stops the heading reflowing as the webfont loads.
	 */
	fonts: [
		{
			provider: fontProviders.google(),
			name: 'Playfair Display',
			cssVariable: '--font-playfair',
			weights: [400, 500, 600],
			styles: ['normal', 'italic'],
			subsets: ['latin'],
		},
		{
			provider: fontProviders.google(),
			name: 'Montserrat',
			cssVariable: '--font-montserrat',
			weights: [300, 400, 500, 600],
			subsets: ['latin'],
		},
		{
			/*
			 * The wordmark, and nothing else.
			 *
			 * Parisienne is a signature script — the shop's name written by hand
			 * rather than set in type. It suits "Elfloral" because the name is
			 * French and the letterforms come from French copperplate, and a
			 * florist is one of the few trades where a handwritten mark reads as
			 * craft rather than affectation.
			 *
			 * One weight on purpose: scripts have no real bold, and a synthesised
			 * one smears the joins between letters.
			 */
			provider: fontProviders.google(),
			name: 'Parisienne',
			cssVariable: '--font-parisienne',
			weights: [400],
			styles: ['normal'],
			subsets: ['latin'],
		},
	],

	/*
	 * Type-safe environment variables.
	 *
	 * `context: 'server', access: 'secret'` values are guaranteed never to reach
	 * the browser bundle — importing one in client code is a build error rather
	 * than a leaked key. Worth the ceremony given what we're handling here.
	 *
	 * Everything is `optional` for now so the dev server boots before the keys
	 * exist. Each one flips to required as its feature lands.
	 */
	env: {
		schema: {
			// --- Supabase ---
			PUBLIC_SUPABASE_URL: envField.string({
				context: 'client',
				access: 'public',
			}),
			// Current-generation Supabase keys, not the legacy anon/service_role
			// JWTs. The secret key bypasses row-level security, so declaring it
			// `access: 'secret'` makes importing it into client code a build error.
			PUBLIC_SUPABASE_PUBLISHABLE_KEY: envField.string({
				context: 'client',
				access: 'public',
			}),
			SUPABASE_SECRET_KEY: envField.string({
				context: 'server',
				access: 'secret',
			}),

			// --- Paystack (Ghana / GHS) ---
			PUBLIC_PAYSTACK_PUBLIC_KEY: envField.string({
				context: 'client',
				access: 'public',
				optional: true,
			}),
			PAYSTACK_SECRET_KEY: envField.string({
				context: 'server',
				access: 'secret',
				optional: true,
			}),

			// --- AI ---
			OPENAI_API_KEY: envField.string({
				context: 'server',
				access: 'secret',
				optional: true,
			}),
			ELEVENLABS_API_KEY: envField.string({
				context: 'server',
				access: 'secret',
				optional: true,
			}),

			// Public base URL, used to build QR-code links that must work off-device.
			PUBLIC_SITE_URL: envField.string({
				context: 'client',
				access: 'public',
				default: 'http://localhost:4321',
			}),
		},
	},
});
