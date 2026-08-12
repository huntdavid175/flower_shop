/*
 * Where the shop actually is.
 *
 * One source, because this was previously written out in both the footer and
 * the contact page, each with its own copy of the directions-URL logic. A
 * business address that exists twice drifts the first time it changes, and the
 * copy that gets missed is the one a customer follows.
 */

export const addressLines = ['East Legon,', 'Accra'];

/** One line, for meta descriptions and anywhere a block will not fit. */
export const addressInline = addressLines
	.join(' ')
	.replace(/,\s*$/, '')
	.replace(/,\s+/g, ', ');

/**
 * Built from the address itself, so "Get Directions" can never point somewhere
 * other than what the page prints beside it.
 */
export const directionsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
	addressInline,
)}`;
