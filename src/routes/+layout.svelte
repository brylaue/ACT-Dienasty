<!-- __layout.svelte -->
<script>
	import { Nav, Footer } from "$lib/components";
    import { dev } from '$app/environment';
    import { injectAnalytics } from '@vercel/analytics/sveltekit';

    injectAnalytics({ mode: dev ? 'development' : 'production' });
</script>

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

<main>
    <Nav /> <!-- adds the nav (small and large) -->

    <slot />

    <Footer /> <!-- adds the footer -->
</main>