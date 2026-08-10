import OpenAI from 'openai';
import { OPENAI_API_KEY } from 'astro:env/server';

/*
 * AI helpers for writing gift messages.
 *
 * Reached only from server endpoints — the key is declared
 * `access: 'secret'` in astro.config.mjs, so importing this module into
 * anything that runs in the browser is a build error rather than a leaked key.
 */

/**
 * gpt-5 at minimal reasoning effort.
 *
 * Measured on this exact prompt: default effort takes ~17s and 1180 output
 * tokens; minimal takes ~4s and 146, with no drop in quality for writing this
 * short. A 17-second wait after clicking "help me write this" is not a
 * feature anyone would use twice.
 */
const MODEL = 'gpt-5';
const REASONING_EFFORT = 'minimal' as const;

export const OCCASIONS = [
	'Birthday',
	'Anniversary',
	'Thank you',
	'Congratulations',
	'Get well soon',
	'Sympathy',
	'I’m sorry',
	'Just because',
] as const;

export const TONES = [
	'Warm',
	'Funny',
	'Romantic',
	'Formal',
	'Short and simple',
] as const;

export interface ComposeRequest {
	recipient: string;
	occasion: string;
	tone: string;
	detail?: string;
	/** What they have already written, if anything — refined rather than replaced. */
	draft?: string;
}

const openai = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;

export function isComposeConfigured(): boolean {
	return Boolean(OPENAI_API_KEY);
}


const SYSTEM_PROMPT = `You write short messages for gift cards attached to flower deliveries from a florist in Accra, Ghana.

Rules:
- 15 to 35 words. These are printed on a small card.
- Warm and specific. Use the detail the buyer gives you; a message that could be sent to anyone is a failure.
- Write in the buyer's voice, as if they wrote it themselves. Never mention the florist, the flowers, or the delivery unless the buyer's detail invites it.
- Plain sentences. No emoji, no hashtags, no quotation marks around the whole message.
- Do not sign off with a name — the buyer adds that themselves.
- Ghanaian English is natural here. Do not force local colour that the buyer did not give you.

Return exactly three options that differ in angle, not just wording.`;

/**
 * Write three candidate messages.
 *
 * Uses a strict JSON schema rather than parsing prose: asking for "three
 * options" and splitting the reply on newlines works until the model formats a
 * list differently, which it eventually will.
 */
export async function composeMessages(
	request: ComposeRequest,
): Promise<string[]> {
	if (!openai) throw new Error('OpenAI is not configured.');

	const lines = [
		`For: ${request.recipient}`,
		`Occasion: ${request.occasion}`,
		`Tone: ${request.tone}`,
	];
	if (request.detail?.trim()) {
		lines.push(`Something about them: ${request.detail.trim()}`);
	}
	if (request.draft?.trim()) {
		lines.push(
			`They have already written this — keep their meaning and voice, improve the wording: "${request.draft.trim()}"`,
		);
	}

	const completion = await openai.chat.completions.create({
		model: MODEL,
		reasoning_effort: REASONING_EFFORT,
		messages: [
			{ role: 'system', content: SYSTEM_PROMPT },
			{ role: 'user', content: lines.join('\n') },
		],
		response_format: {
			type: 'json_schema',
			json_schema: {
				name: 'message_options',
				strict: true,
				schema: {
					type: 'object',
					additionalProperties: false,
					required: ['options'],
					properties: {
						options: {
							type: 'array',
							items: {
								type: 'object',
								additionalProperties: false,
								required: ['text'],
								properties: { text: { type: 'string' } },
							},
						},
					},
				},
			},
		},
	});

	const raw = completion.choices[0]?.message?.content;
	if (!raw) throw new Error('No message returned.');

	const parsed = JSON.parse(raw) as { options?: Array<{ text?: string }> };
	return (parsed.options ?? [])
		.map((option) => option.text?.trim())
		.filter((text): text is string => Boolean(text))
		.slice(0, 3);
}
