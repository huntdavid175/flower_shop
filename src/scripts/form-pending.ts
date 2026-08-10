/*
 * Tell the customer the server heard them.
 *
 * Several steps in the buying flow are slow for reasons the customer cannot
 * see: adding to the basket writes an order row, and the Pay button makes a
 * round trip to Paystack that measured one to three seconds before the browser
 * leaves the page. A button that does nothing visible for three seconds reads
 * as broken, and the reflex is to click it again.
 *
 * Progressive enhancement: without JavaScript every form still submits exactly
 * as before. This only adds feedback and a guard against the second click.
 */

const BUSY_ATTR = 'data-busy';

function markBusy(form: HTMLFormElement, submitter: HTMLElement | null) {
	form.setAttribute('aria-busy', 'true');
	startProgress();

	if (!submitter) return;

	/*
	 * Deferred by a tick on purpose.
	 *
	 * A submit button's name and value are part of the payload, and disabling it
	 * synchronously inside the submit handler drops them in several browsers —
	 * which would silently break the admin's status buttons, where the whole
	 * message is `name="status"`. By the next tick the browser has already
	 * serialised the form.
	 */
	window.setTimeout(() => {
		submitter.setAttribute(BUSY_ATTR, '');

		const busyLabel = submitter.getAttribute('data-busy-label');
		if (busyLabel) {
			// Keep the original so a bfcache restore can put it back.
			submitter.setAttribute('data-idle-label', submitter.innerHTML);
			submitter.textContent = busyLabel;
		}
	}, 0);
}

function clearBusy(): void {
	stopProgress();
	document.querySelectorAll('form[aria-busy]').forEach((form) => form.removeAttribute('aria-busy'));
	document.querySelectorAll<HTMLElement>(`[${BUSY_ATTR}]`).forEach((element) => {
		element.removeAttribute(BUSY_ATTR);
		const idle = element.getAttribute('data-idle-label');
		if (idle !== null) {
			element.innerHTML = idle;
			element.removeAttribute('data-idle-label');
		}
	});
}

/* --- A thin bar at the top, for the wait before the next page paints --- */

let bar: HTMLElement | null = null;
let timer: number | null = null;

function startProgress(): void {
	if (bar) return;
	bar = document.createElement('div');
	bar.className = 'page-progress';
	bar.setAttribute('role', 'presentation');
	document.body.appendChild(bar);

	/*
	 * Creeps towards 90% and waits there. It cannot know real progress, and a
	 * bar that reaches 100% before the page arrives is a lie the customer
	 * notices — it is the navigation that completes it.
	 */
	let width = 0;
	timer = window.setInterval(() => {
		width += (90 - width) * 0.08;
		if (bar) bar.style.width = `${width}%`;
	}, 120);
}

function stopProgress(): void {
	if (timer !== null) window.clearInterval(timer);
	timer = null;
	bar?.remove();
	bar = null;
}

document.addEventListener(
	'submit',
	(event) => {
		const form = event.target as HTMLFormElement | null;
		if (!form || form.tagName !== 'FORM') return;
		if (form.hasAttribute('data-no-busy')) return;

		// A form already in flight. The second click would place a second order,
		// or open a second Paystack transaction against the same basket.
		if (form.hasAttribute('aria-busy')) {
			event.preventDefault();
			return;
		}

		// Let anything that cancelled the submit — a confirm() dialog on "Start
		// over", or failed validation — leave the button alone.
		if (event.defaultPrevented) return;
		if (typeof form.checkValidity === 'function' && !form.checkValidity()) return;

		markBusy(form, (event as SubmitEvent).submitter as HTMLElement | null);
	},
	// Capture, so this runs before handlers that might stop propagation, but
	// after `defaultPrevented` can still be read on the bubble of others.
	false,
);

/*
 * Coming back to a cached page.
 *
 * A customer who reaches Paystack and presses Back gets this page restored from
 * the back/forward cache exactly as it was — mid-spin, with the Pay button
 * inert. Without this they would be stuck looking at a dead button.
 */
window.addEventListener('pageshow', (event) => {
	if ((event as PageTransitionEvent).persisted) clearBusy();
});

// Belt and braces for browsers that restore without firing `persisted`.
window.addEventListener('pagehide', stopProgress);
