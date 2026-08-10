import { useEffect, useRef, useState } from 'react';

/**
 * Record a voice message, or upload one recorded elsewhere.
 *
 * Deliberately does not pick a codec. `MediaRecorder` on iOS Safari produces
 * mp4/aac while Chrome and Firefox produce webm/opus; asking for a specific
 * mimeType throws on the browsers that do not support it. We take whatever the
 * browser gives, send its own `type` along, and let the server allowlist decide.
 */

type Status = 'idle' | 'recording' | 'preview' | 'saving' | 'saved' | 'error';

interface Props {
	/** Null for a message covering the whole order. */
	itemId?: string | null;
	/** True when a recording is already stored against this message. */
	initialHasAudio?: boolean;
	label?: string;
}

const MAX_SECONDS = 120;

export default function VoiceRecorder({
	itemId = null,
	initialHasAudio = false,
	label = 'Add a voice message',
}: Props) {
	const [status, setStatus] = useState<Status>(
		initialHasAudio ? 'saved' : 'idle',
	);
	const [error, setError] = useState<string | null>(null);
	const [seconds, setSeconds] = useState(0);
	const [previewUrl, setPreviewUrl] = useState<string | null>(null);
	const [supported, setSupported] = useState(true);

	const recorderRef = useRef<MediaRecorder | null>(null);
	const chunksRef = useRef<BlobPart[]>([]);
	const blobRef = useRef<Blob | null>(null);
	const timerRef = useRef<number | null>(null);
	const recordedSecondsRef = useRef(0);
	const secondsRef = useRef(0);

	useEffect(() => {
		setSupported(
			typeof MediaRecorder !== 'undefined' &&
				Boolean(navigator.mediaDevices?.getUserMedia),
		);
	}, []);

	// Release the object URL and the microphone if the component goes away
	// mid-recording — otherwise the browser keeps showing the recording
	// indicator and the tab holds the mic open.
	useEffect(() => {
		return () => {
			if (previewUrl) URL.revokeObjectURL(previewUrl);
			if (timerRef.current) window.clearInterval(timerRef.current);
			recorderRef.current?.stream.getTracks().forEach((track) => track.stop());
		};
	}, [previewUrl]);

	async function startRecording() {
		setError(null);
		try {
			const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
			const recorder = new MediaRecorder(stream);
			chunksRef.current = [];

			recorder.ondataavailable = (event) => {
				if (event.data.size > 0) chunksRef.current.push(event.data);
			};

			recorder.onstop = () => {
				// Keep the browser's own type — that is what the server matches on.
				const blob = new Blob(chunksRef.current, { type: recorder.mimeType });
				blobRef.current = blob;
				setPreviewUrl(URL.createObjectURL(blob));
				setStatus('preview');
				stream.getTracks().forEach((track) => track.stop());
			};

			recorder.start();
			recorderRef.current = recorder;
			setSeconds(0);
			setStatus('recording');

			secondsRef.current = 0;
			timerRef.current = window.setInterval(() => {
				setSeconds((value) => {
					const next = value + 1;
					// Mirrored into a ref because `stopRecording` reads the final count
					// synchronously, and state would still be one render behind.
					secondsRef.current = next;
					if (next >= MAX_SECONDS) stopRecording();
					return next;
				});
			}, 1000);
		} catch {
			// Almost always a denied permission prompt.
			setError(
				'We could not reach your microphone. Check the permission and try again.',
			);
			setStatus('error');
		}
	}

	function stopRecording() {
		recordedSecondsRef.current = secondsRef.current;
		if (timerRef.current) window.clearInterval(timerRef.current);
		timerRef.current = null;
		recorderRef.current?.stop();
	}

	async function save(blob: Blob, kind: 'recorded' | 'uploaded', lengthSeconds?: number) {
		setStatus('saving');
		setError(null);

		const body = new FormData();
		body.set('action', 'upload');
		body.set('kind', kind);
		if (itemId) body.set('itemId', itemId);
		body.set('audio', blob, 'message');
		// The browser cannot read a duration back out of its own WebM, so send
		// the length we timed while recording and store it alongside the file.
		if (lengthSeconds && lengthSeconds > 0) body.set('seconds', String(Math.round(lengthSeconds)));

		try {
			const response = await fetch('/api/voice', { method: 'POST', body });
			const result = await response.json();
			if (!response.ok) throw new Error(result.error ?? 'Upload failed.');
			setStatus('saved');
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : 'Upload failed.');
			setStatus('error');
		}
	}

	async function remove() {
		setStatus('saving');
		const body = new FormData();
		body.set('action', 'delete');
		if (itemId) body.set('itemId', itemId);
		try {
			await fetch('/api/voice', { method: 'POST', body });
		} finally {
			blobRef.current = null;
			if (previewUrl) URL.revokeObjectURL(previewUrl);
			setPreviewUrl(null);
			setStatus('idle');
		}
	}

	const button =
		'inline-flex items-center gap-2 px-5 py-2.5 text-[0.875rem] font-semibold transition-colors duration-200';
	const solid = `${button} bg-terracotta-700 text-white hover:bg-terracotta-600`;
	const outline = `${button} border border-forest-700 text-forest-700 hover:bg-forest-700 hover:text-butter`;

	return (
		<div className="mt-4 border border-forest-700/30 bg-butter p-4">
			<p className="text-[0.875rem] font-medium text-forest-700">{label}</p>

			{status === 'saved' ? (
				<div className="mt-3 flex flex-wrap items-center gap-3">
					<p className="text-[0.875rem] text-forest-700">
						Voice message saved.
					</p>
					<button type="button" onClick={remove} className={outline}>
						Remove
					</button>
				</div>
			) : (
				<>
					{status === 'recording' && (
						<div className="mt-3 flex flex-wrap items-center gap-3">
							<span
								className="flex items-center gap-2 text-[0.875rem] text-forest-700"
								aria-live="polite"
							>
								<span className="h-2.5 w-2.5 animate-pulse rounded-full bg-terracotta-600" />
								Recording {formatTime(seconds)} / {formatTime(MAX_SECONDS)}
							</span>
							<button type="button" onClick={stopRecording} className={solid}>
								Stop
							</button>
						</div>
					)}

					{status === 'preview' && previewUrl && (
						<div className="mt-3 space-y-3">
							<audio controls src={previewUrl} className="w-full" />
							<div className="flex flex-wrap gap-3">
								<button
									type="button"
									className={solid}
									onClick={() => blobRef.current && save(blobRef.current, 'recorded', recordedSecondsRef.current)}
								>
									Use this recording
								</button>
								<button
									type="button"
									className={outline}
									onClick={() => {
										if (previewUrl) URL.revokeObjectURL(previewUrl);
										setPreviewUrl(null);
										setStatus('idle');
									}}
								>
									Record again
								</button>
							</div>
						</div>
					)}

					{(status === 'idle' || status === 'error') && (
						<div className="mt-3 flex flex-wrap items-center gap-3">
							{supported && (
								<button type="button" onClick={startRecording} className={solid}>
									<span className="h-2.5 w-2.5 rounded-full bg-white" />
									Record
								</button>
							)}

							{/*
							  Always offered, not just as a fallback: someone may have
							  recorded on their phone, or on another service entirely.
							*/}
							<label className={`${outline} cursor-pointer`}>
								Upload a file
								<input
									type="file"
									accept="audio/*"
									className="sr-only"
									onChange={(event) => {
										const file = event.target.files?.[0];
										if (file) save(file, 'uploaded');
									}}
								/>
							</label>
						</div>
					)}

					{status === 'saving' && (
						<p className="mt-3 text-[0.875rem] text-forest-700" aria-live="polite">
							Saving…
						</p>
					)}

					{!supported && status === 'idle' && (
						<p className="mt-2 text-[0.8125rem] text-forest-700/70">
							This browser cannot record audio. You can still upload a file.
						</p>
					)}
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

function formatTime(total: number): string {
	const minutes = Math.floor(total / 60);
	const seconds = total % 60;
	return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
