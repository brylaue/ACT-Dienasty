<script>
	import NavSmall from './NavSmall.svelte';
	import NavLarge from './NavLarge.svelte';
    import { page } from '$app/state';
	import IconButton from '@smui/icon-button';
	import { Icon } from '@smui/common';

	// toggle dark mode
	let darkTheme = $state(typeof window === "undefined" || window.matchMedia("(prefers-color-scheme: dark)").matches);
	function switchTheme(currentTheme) {
		currentTheme = !currentTheme;
		let themeLink = document.head.querySelector("#theme");
		if (!themeLink) {
			themeLink = document.createElement("link");
			themeLink.rel = "stylesheet";
			themeLink.id = "theme";
		}
		themeLink.href = `/smui${currentTheme ? "" : "-dark"}.css`;
		document.head
		.querySelector('link[href="/smui-dark.css"]')
		.insertAdjacentElement("afterend", themeLink);
	}
</script>

<svelte:head>
	<title>{!page.url.pathname[1] ? 'Home' : page.url.pathname[1].toUpperCase() + page.url.pathname.slice(2)} | League Page</title>
</svelte:head>

<style>
	nav {
		background: var(--fff);
		position: sticky;
		top: 0;
		z-index: 10;
		border-bottom: 1px solid var(--line);
		--mdc-theme-primary: var(--accent);
	}

	.plaque {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 12px;
		padding: 12px 56px 6px;
		text-decoration: none;
	}

	#logo {
		width: 40px;
		display: block;
	}

	.wordmark {
		text-align: left;
	}

	.eyebrow {
		display: none; /* clean header: crest + name only */
	}

	.leagueName {
		display: block;
		font-family: var(--bodyFont);
		font-weight: 800;
		font-size: 1.25em;
		line-height: 1;
		color: var(--ink);
		letter-spacing: -0.015em;
	}

	.rule {
		display: none;
	}

	@media (max-width: 500px) {
		.plaque { gap: 10px; padding: 10px 48px 4px; }
		#logo { width: 34px; }
		.leagueName { font-size: 1.05em; }
	}

    .large {
		display: block;
    }

	.small {
		display: none;
	}

	.container {
		position: absolute;
		top: 0.25em;
		right: 0.25em;
	}

	:global(.lightDark) {
		color: var(--muted);
	}

	@media (max-width: 950px) { /* width of the large navBar */
		.large {
			display: none;
		}

		.small {
			display: block;
		}
	}
</style>

<nav>
	<a href="/" class="plaque">
		<img id="logo" alt="league logo" src="/badge.png" />
		<span class="wordmark">
			<span class="eyebrow">Est. 2018 &middot; 12-Team Superflex Dynasty</span>
			<span class="leagueName">ACT, OR DIE.</span>
			<span class="rule"></span>
		</span>
	</a>

	<div class="container">
		<IconButton
			toggle
			bind:pressed={darkTheme}
			onclick={() => switchTheme(darkTheme)}
			class="lightDark"
		>
			<Icon class="material-icons" on>dark_mode</Icon>
			<Icon class="material-icons">light_mode</Icon>
		</IconButton>
	</div>

	<div class="large">
		<NavLarge />
	</div>

	<div class="small">
		<NavSmall />
	</div>

</nav>
