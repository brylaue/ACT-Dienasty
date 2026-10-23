<script>
	import { Nav, Footer } from "#lib/components.js";
	import { browser, dev } from '$app/env';
	import { page } from '$app/state';
	import { inject, pageview } from '@vercel/analytics';

	// @vercel/analytics/sveltekit still imports $app/stores, which SvelteKit 3 removed, so wire the
	// framework-agnostic client up by hand: inject the script once, then report each route change.
	if (browser) inject({ mode: dev ? 'development' : 'production', disableAutoTrack: true, framework: 'sveltekit' });
	$effect(() => {
		const route = page.route.id;
		if (route) pageview({ route, path: page.url.pathname });
	});
</script>

<main>
	<Nav />
	<!-- adds the nav (small and large) -->
	<slot></slot>
	<Footer />
	<!-- adds the footer -->
</main>

<style>
	:global(body) {
		overflow-x: hidden;
		background-color: var(--pageBg);
		font-family: var(--bodyFont);
		color: var(--ink);
		--mdc-typography-font-family: var(--bodyFont);
	}

	/* Modern heading system: bold Inter with tight tracking, the way
	   contemporary product UIs set titles. */
	:global(h1), :global(h2), :global(h4) {
		font-family: var(--bodyFont);
		font-weight: 800;
		letter-spacing: -0.015em;
	}

	:global(h3), :global(h5), :global(h6) {
		font-family: var(--bodyFont);
		font-weight: 700;
		letter-spacing: -0.01em;
	}

	main {
		overflow-x: hidden;
		width: 100%;
	}
</style>
