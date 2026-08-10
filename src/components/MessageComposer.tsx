import { useState } from 'react';

/**
 * AI writing help for the gift message.
 *
 * Asks three short questions before generating. A blank-box "write me
 * something" produces greeting-card filler; who it's for, the occasion, and one
 * specific detail are what make the result sound like the buyer wrote it.
 */

interface Props {
	/** Null for the order-wide message. */
	itemId?: string | null;
	/** Reads and writes the textarea this composer belongs to. */
	textareaId: string;
	occasions: readonly string[];
	tones: readonly string[];
}

type Status = 'closed' | 'asking' | 'working' | 'choosing' | 'error';

const RECIPIENTS = [
	'My mother',
	'My father',
	'My partner',
	'My wife',
	'My husband',
	'A friend',
	'My sister',
	'My brother',
	'A colleague',
];

export default function MessageComposer({
	itemId = null,
	textareaId,
	occasions,
	tones,
}: Props) {
	const [status, setStatus] = useState<Status>('closed');
	const [error, setError] = useState<string | null>(null);
	const [options, setOptions] = useState<string[]>([]);
	const [remaining, setRemaining] = useState<number | null>(null);

	const [recipient, setRecipient] = useState(RECIPIENTS[0]!);
	const [occasion, setOccasion] = useState(occasions[0] ?? '');
	const [tone, setTone] = useState(tones[0] ?? '');
	const [detail, setDetail] = useState('');

	function textarea(): HTMLTextAreaElement | null {
		return document.getElementById(textareaId) as HTMLTextAreaElement | null;
	}

	async function generate() {
		setStatus('working');
		setError(null);
		try {
			const response = await fetch('/api/ai/compose', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					itemId,
					recipient,
					occasion,
					tone,
					detail,
					// Anything already typed is refined rather than thrown away.
					draft: textarea()?.value ?? '',
				}),
			});
			const result = await response.json();
			if (!response.ok) throw new Error(result.error ?? 'Could not write a message.');
			setOptions(result.options ?? []);
			setRemaining(typeof result.remaining === 'number' ? result.remaining : null);
			setStatus('choosing');
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : 'Something went wrong.');
			setStatus('error');
		}
	}

	function choose(text: string) {
		const field = textarea();
		if (field) {
			field.value = text;
			// The page's own listeners (character counts, autosave) do not fire on a
			// programmatic value assignment unless we say so.
			field.dispatchEvent(new Event('input', { bubbles: true }));
			field.focus();
		}
		setStatus('closed');
		setOptions([]);
	}

	const button =
		'inline-flex items-center gap-2 px-5 py-2.5 text-[0.875rem] font-semibold transition-colors duration-200';
	const solid = `${button} bg-terracotta-700 text-white hover:bg-terracotta-600`;
	const outline = `${button} border border-forest-700 text-forest-700 hover:bg-forest-700 hover:text-butter`;
	const select =
		'mt-1 w-full rounded-none border border-forest-700 bg-white px-3 py-2.5 text-[0.875rem] text-forest-900 outline-none transition-colors duration-200 focus:border-terracotta-700';
	const label = 'block text-[0.8125rem] font-medium text-forest-700';

	if (status === 'closed') {
		return (
			<div className="mt-3">
				<button type="button" onClick={() => setStatus('asking')} className={outline}>
					<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
						<g stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
							<path d="M8 1.5v13M1.5 8h13M3.4 3.4l9.2 9.2M12.6 3.4l-9.2 9.2" />
						</g>
					</svg>
					Help me write it
				</button>
			</div>
		);
	}

	return (
		<div className="mt-3 border border-forest-700/30 bg-butter p-4">
			{(status === 'asking' || status === 'working' || status === 'error') && (
				<>
					<p className="text-[0.875rem] font-medium text-forest-700">
						A few things, so it sounds like you
					</p>

					<div className="mt-3 grid gap-3 sm:grid-cols-3">
						<label>
							<span className={label}>Who is it for?</span>
							<select
								value={recipient}
								onChange={(event) => setRecipient(event.target.value)}
								className={select}
							>
								{RECIPIENTS.map((option) => (
									<option key={option} value={option}>
										{option}
									</option>
								))}
							</select>
						</label>

						<label>
							<span className={label}>Occasion</span>
							<select
								value={occasion}
								onChange={(event) => setOccasion(event.target.value)}
								className={select}
							>
								{occasions.map((option) => (
									<option key={option} value={option}>
										{option}
									</option>
								))}
							</select>
						</label>

						<label>
							<span className={label}>Tone</span>
							<select
								value={tone}
								onChange={(event) => setTone(event.target.value)}
								className={select}
							>
								{tones.map((option) => (
									<option key={option} value={option}>
										{option}
									</option>
								))}
							</select>
						</label>
					</div>

					<label className="mt-3 block">
						<span className={label}>
							Anything about them? <span className="font-normal text-forest-700/60">(this is what stops it sounding generic)</span>
						</span>
						<input
							type="text"
							value={detail}
							onChange={(event) => setDetail(event.target.value)}
							maxLength={300}
							placeholder="She taught me to garden"
							className={`${select} placeholder:text-forest-700/40`}
						/>
					</label>

					<div className="mt-4 flex flex-wrap items-center gap-3">
						<button
							type="button"
							onClick={generate}
							disabled={status === 'working'}
							className={`${solid} disabled:opacity-60`}
						>
							{status === 'working' ? 'Writing…' : 'Write me three options'}
						</button>
						<button
							type="button"
							onClick={() => setStatus('closed')}
							className="text-[0.875rem] text-forest-700 underline underline-offset-4"
						>
							Cancel
						</button>
					</div>
				</>
			)}

			{status === 'choosing' && (
				<>
					<p className="text-[0.875rem] font-medium text-forest-700">
						Pick one — you can edit it after
					</p>

					<ul className="mt-3 space-y-2">
						{options.map((option, index) => (
							<li key={index}>
								<button
									type="button"
									onClick={() => choose(option)}
									className="w-full border border-forest-700/30 bg-white p-4 text-left text-[0.9375rem] leading-[1.6] text-forest-900 transition-colors hover:border-terracotta-700"
								>
									{option}
								</button>
							</li>
						))}
					</ul>

					<div className="mt-4 flex flex-wrap items-center gap-3">
						<button type="button" onClick={() => setStatus('asking')} className={outline}>
							Try again
						</button>
						<button
							type="button"
							onClick={() => setStatus('closed')}
							className="text-[0.875rem] text-forest-700 underline underline-offset-4"
						>
							None of these
						</button>
						{remaining !== null && remaining <= 4 && (
							<span className="text-[0.8125rem] text-forest-700/60">
								{remaining} left for this order
							</span>
						)}
					</div>
				</>
			)}

			{error && (
				<p className="mt-3 text-[0.875rem] text-terracotta-700" role="alert">
					{error}
				</p>
			)}
		</div>
	);
}
