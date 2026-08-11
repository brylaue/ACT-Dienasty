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

	/* Varsity display face for page-level titles only - everything else
	   stays quiet. Emoji prefixes fall through to the emoji font. */
	:global(h1), :global(h2), :global(h4) {
		font-family: var(--displayFont);
		font-weight: 400;
		letter-spacing: 0.04em;
	}

	:global(h3), :global(h4), :global(h5), :global(h6) {
		font-family: var(--bodyFont);
		font-weight: 700;
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