import { useEffect, useRef, useState } from 'react';

/**
 * Voice-message player for the QR landing page.
 *
 * A custom transport rather than the browser's default control bar, which looks
 * different in every browser and cannot be themed — on a page a stranger reaches
 * by scanning a card, the shop's own styling matters.
 *
 * The <audio> element still does the work; only its chrome is replaced.
 */
interface Props {
	src: string;
	title: string;
	image?: string | null;
	/** Length in seconds recorded at upload time, used until the browser knows better. */
	fallbackDuration?: number | null;
}

export default function MessagePlayer({
	src,
	title,
	image,
	fallbackDuration = null,
}: Props) {
	const audioRef = useRef<HTMLAudioElement | null>(null);
	const [playing, setPlaying] = useState(false);
	const [current, setCurrent] = useState(0);
	const [duration, setDuration] = useState(fallbackDuration ?? 0);
	const [failed, setFailed] = useState(false);
	const probedRef = useRef(false);

	useEffect(() => {
		const audio = audioRef.current;
		if (!audio) return;

		const onTime = () => setCurrent(audio.currentTime);

		const onMeta = () => {
			if (Number.isFinite(audio.duration) && audio.duration > 0) {
				setDuration(audio.duration);
				return;
			}

			/*
			 * MediaRecorder writes WebM without a duration — it is a streaming
			 * container produced without knowing the length in advance — so
			 * `duration` reads Infinity and the scrubber has no range to work with.
			 *
			 * Seeking far past the end forces the browser to scan to the last
			 * frame, after which it reports the true duration. We then rewind. Done
			 * once, guarded, because the seek itself fires these events again.
			 */
			if (probedRef.current) return;
			probedRef.current = true;

			const onProbe = () => {
				if (Number.isFinite(audio.duration) && audio.duration > 0) {
					audio.removeEventListener('timeupdate', onProbe);
					audio.removeEventListener('durationchange', onProbe);
					setDuration(audio.duration);
					audio.currentTime = 0;
					setCurrent(0);
				}
			};
			audio.addEventListener('timeupdate', onProbe);
			audio.addEventListener('durationchange', onProbe);
			audio.currentTime = 1e101;
		};
		const onEnd = () => {
			setPlaying(false);
			setCurrent(0);
			audio.currentTime = 0;
		};

		audio.addEventListener('timeupdate', onTime);
		audio.addEventListener('loadedmetadata', onMeta);
		audio.addEventListener('durationchange', onMeta);
		audio.addEventListener('ended', onEnd);
		audio.addEventListener('error', () => setFailed(true));

		return () => {
			audio.removeEventListener('timeupdate', onTime);
			audio.removeEventListener('loadedmetadata', onMeta);
			audio.removeEventListener('durationchange', onMeta);
			audio.removeEventListener('ended', onEnd);
		};
	}, []);

	async function toggle() {
		const audio = audioRef.current;
		if (!audio) return;
		if (playing) {
			audio.pause();
			setPlaying(false);
			return;
		}
		try {
			await audio.play();
			setPlaying(true);
		} catch {
			// Autoplay policies reject play() when it is not user-initiated; this
			// one always is, so a rejection means the file itself will not decode.
			setFailed(true);
		}
	}

	function skip(seconds: number) {
		const audio = audioRef.current;
		if (!audio) return;
		audio.currentTime = Math.min(
			Math.max(audio.currentTime + seconds, 0),
			duration || audio.currentTime,
		);
	}

	const progress = duration > 0 ? (current / duration) * 100 : 0;

	return (
		<div className="rounded-[1.75rem] border border-white/12 bg-white/8 p-3 backdrop-blur-sm">
			<div className="flex items-center gap-4">
				{image ? (
					<img
						src={image}
						alt=""
						className="size-24 shrink-0 rounded-2xl object-cover sm:size-28"
					/>
				) : (
					<div className="size-24 shrink-0 rounded-2xl bg-teal-900 sm:size-28" />
				)}

				<div className="min-w-0 flex-1 text-left">
					<p className="truncate text-[clamp(1.0625rem,2.2vw,1.375rem)] font-semibold text-white">
						{title}
					</p>
					<p className="mt-1 text-[0.875rem] text-cream/60 tabular-nums">
						{failed
							? 'Recording unavailable'
							: `${formatTime(current)} / ${formatTime(duration)}`}
					</p>
				</div>

				<div className="flex shrink-0 items-center gap-1 pr-1">
					<button
						type="button"
						onClick={toggle}
						disabled={failed}
						aria-label={playing ? 'Pause' : 'Play'}
						className="flex size-12 items-center justify-center rounded-full text-cream transition-colors hover:bg-white/10 hover:text-white disabled:opacity-40"
					>
						{playing ? (
							<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
								<rect x="6" y="4" width="4.5" height="16" rx="1.5" />
								<rect x="13.5" y="4" width="4.5" height="16" rx="1.5" />
							</svg>
						) : (
							<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
								<path d="M7 4.5a1 1 0 0 1 1.53-.85l11 7.5a1 1 0 0 1 0 1.7l-11 7.5A1 1 0 0 1 7 19.5z" />
							</svg>
						)}
					</button>

					<button
						type="button"
						onClick={() => skip(10)}
						disabled={failed}
						aria-label="Skip forward ten seconds"
						className="flex size-12 items-center justify-center rounded-full text-cream transition-colors hover:bg-white/10 hover:text-white disabled:opacity-40"
					>
						<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
							<path d="M2 5.5a1 1 0 0 1 1.55-.83L12 10.2V5.5a1 1 0 0 1 1.55-.83l9 6.5a1 1 0 0 1 0 1.66l-9 6.5A1 1 0 0 1 12 18.5v-4.7l-8.45 5.53A1 1 0 0 1 2 18.5z" />
						</svg>
					</button>
				</div>
			</div>

			{/* Thin progress line, doubling as a scrubber. */}
			<label className="mt-3 block px-1">
				<span className="sr-only">Seek</span>
				<input
					type="range"
					min={0}
					max={duration || 0}
					step={0.1}
					value={current}
					disabled={failed || duration === 0}
					onChange={(event) => {
						const audio = audioRef.current;
						if (!audio) return;
						audio.currentTime = Number(event.target.value);
						setCurrent(Number(event.target.value));
					}}
					className="h-1 w-full cursor-pointer appearance-none rounded-full bg-white/15 accent-terracotta-600 disabled:cursor-default"
					style={{
						background: `linear-gradient(to right, var(--color-terracotta-600) ${progress}%, rgb(255 255 255 / 0.15) ${progress}%)`,
					}}
				/>
			</label>

			<audio ref={audioRef} src={src} preload="metadata" className="hidden" />
		</div>
	);
}

function formatTime(total: number): string {
	if (!Number.isFinite(total) || total <= 0) return '0:00';
	const minutes = Math.floor(total / 60);
	const seconds = Math.floor(total % 60);
	return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
