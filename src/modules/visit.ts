import Swup from '../Swup.js';
import { createHistoryRecord, updateHistoryRecord, getCurrentUrl, Location } from '../helpers.js';
import { FetchOptions } from './fetchPage.js';
import { ContextInitOptions } from './Context.js';

export type HistoryAction = 'push' | 'replace';

export type PageLoadOptions = {
	animate?: boolean;
	transition?: string;
	history?: HistoryAction;
};

export function visit(
	this: Swup,
	url: string,
	options: PageLoadOptions & FetchOptions = {},
	context: Omit<ContextInitOptions, 'to'> = {}
) {
	// Check if the visit should be ignored
	if (this.shouldIgnoreVisit(url)) {
		window.location.href = url;
	} else {
		const { url: to, hash } = Location.fromUrl(url);
		this.context = this.createContext({ ...context, to, hash });
		this.performVisit(to, options);
	}
}

export async function performVisit(
	this: Swup,
	url: string,
	options: PageLoadOptions & FetchOptions = {}
) {
	if (typeof url !== 'string') {
		throw new Error(`swup.visit() requires a URL parameter`);
	}

	this.context.to.url = Location.fromUrl(url).url;
	const { transition, animate, history: historyAction } = options;
	options.referrer = options.referrer || this.currentPageUrl;

	if (animate === false) {
		this.context.transition.animate = false;
	}
	if (historyAction) {
		this.context.history.action = historyAction;
	}

	// Clean up old transition classes and set custom transition name
	if (!this.context.transition.animate) {
		this.classes.clear();
	} else if (transition) {
		this.context.transition.name = transition;
	}

	try {
		await this.hooks.trigger('transitionStart');

		// Begin fetching page
		const pagePromise = this.hooks.trigger(
			'loadPage',
			{ url: this.context.to.url, options },
			async (context, { options }) => await this.fetchPage(context.to.url as string, options)
		);

		// Create history record if this is not a popstate call (with or without anchor)
		if (!this.context.history.popstate) {
			const newUrl = url + (this.context.scroll.target || '');
			if (this.context.history.action === 'replace') {
				updateHistoryRecord(newUrl);
			} else {
				createHistoryRecord(newUrl);
			}
		}

		this.currentPageUrl = getCurrentUrl();

		// Wait for page before starting to animate out?
		if (this.context.transition.wait) {
			const { html } = await pagePromise;
			this.context.to.html = html;
		}

		// When page is loaded and leave animation has finished, render the page
		const animationPromise = this.leavePage();
		const [page] = await Promise.all([pagePromise, animationPromise]);
		await this.renderPage(this.context.to.url, page);
	} catch (error: unknown) {
		// Return early if error is undefined (probably aborted preload request)
		if (!error) {
			return;
		}

		// Log to console as we swallow almost all hook errors
		console.error(error);

		// Rewrite `skipPopStateHandling` to redirect manually when `history.go` is processed
		this.options.skipPopStateHandling = () => {
			window.location.href = this.context.to.url as string;
			return true;
		};

		// Go back to the actual page we're still at
		history.go(-1);
	}
}
