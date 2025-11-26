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