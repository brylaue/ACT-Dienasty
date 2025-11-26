<!-- __layout.svelte -->
<script>
	import { Nav, Footer } from "$lib/components";
    import { dev } from '$app/environment';
    import { injectAnalytics } from '@vercel/analytics/sveltekit';
 
    injectAnalytics({ mode: dev ? 'development' : 'production' });
</script>

<main class="app-shell">
    <Nav /> <!-- adds the nav (small and large) -->
  
    <div class="page-content">
        <slot />
    </div>

    <Footer /> <!-- adds the footer -->
</main>

<style>
    .app-shell {
        min-height: 100vh;
        display: flex;
        flex-direction: column;
        background-color: var(--siteBackground, transparent);
    }

    .page-content {
        flex: 1 0 auto;
        width: 100%;
    }

    :global(nav),
    :global(footer) {
        flex-shrink: 0;
        width: 100%;
    }
</style>