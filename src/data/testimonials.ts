/*
 * PLACEHOLDER reviews — written to show the sections working, not collected
 * from anyone. They must be replaced with real ones before the shop takes
 * public traffic: invented testimonials are a claim about people who never said
 * it, and buyers weigh them when deciding.
 *
 * Kept here rather than inside a component because three pages now show them —
 * the home page, About, and Contact. Two copies of a placeholder is two things
 * to remember to replace, and one of them always gets missed.
 *
 * Moves to Supabase with a reviews table once there are genuine ones to store.
 */

export interface Testimonial {
	/** The bouquet the review is about. Must match a real product name. */
	bouquet: string;
	quote: string;
	name: string;
	rating: string;
	image: string;
	imageAlt: string;
}

export const testimonials: Testimonial[] = [
	{
		bouquet: 'Hibiscus Flame',
		quote:
			'“I ordered from London for my mother in East Legon and it reached her before lunch, exactly as promised. She rang me holding it. The little card with the code — hearing my voice is what finished her off.”',
		name: 'Akosua Mensah',
		rating: '5.0',
		image: '/images/testimonial1.jpg',
		imageAlt: 'A woman in a white dress holding a bright mixed bouquet in the shop',
	},
	{
		bouquet: 'Velvet Petals',
		quote:
			'“Sent these to my sister at her office in Osu for her birthday and the whole floor came over to look. Richer in person than in the photographs, and they were still standing two weeks later.”',
		name: 'Efua Boateng',
		rating: '5.0',
		image: '/images/testimonial2.jpg',
		imageAlt: 'A woman seated in a garden holding a plum and pink bouquet',
	},
	{
		bouquet: 'Rose Elegance',
		quote:
			'“The courier rang ahead, then waited when the traffic on Spintex held me up. That is the part I tell people about. Third order this year and not one has disappointed.”',
		name: 'Nana Ama Adjei',
		rating: '5.0',
		image: '/images/testimonial3.jpg',
		imageAlt: 'A woman in a white suit holding a large bouquet of roses and lilies',
	},
];
