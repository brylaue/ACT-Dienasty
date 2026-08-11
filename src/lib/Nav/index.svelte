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
		background: linear-gradient(180deg, var(--plaque) 0%, var(--plaqueDeep) 100%);
		position: relative;
		z-index: 2;
		border-bottom: 3px solid var(--gold);
		/* tab colors while sitting on the plaque */
		--mdc-theme-primary: var(--gold);
	}

	.plaque {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 18px;
		padding: 16px 56px 10px;
		text-decoration: none;
	}

	#logo {
		width: 64px;
		display: block;
		filter: drop-shadow(0 2px 6px rgba(0, 0, 0, 0.45));
	}

	.wordmark {
		text-align: left;
	}

	.eyebrow {
		display: block;
		font-family: var(--bodyFont);
		font-weight: 600;
		font-size: 0.62em;
		letter-spacing: 0.28em;
		color: var(--gold);
		text-transform: uppercase;
		margin-bottom: 2px;
	}

	.leagueName {
		display: block;
		font-family: var(--displayFont);
		font-size: 1.55em;
		line-height: 1;
		color: var(--cream);
		letter-spacing: 0.05em;
		text-shadow: 0 2px 0 rgba(0, 0, 0, 0.35);
	}

	.rule {
		display: block;
		margin-top: 6px;
		height: 2px;
		width: 100%;
		background: linear-gradient(90deg, var(--gold), rgba(201, 162, 39, 0));
	}

	@media (max-width: 500px) {
		.plaque { gap: 12px; padding: 14px 48px 8px; }
		#logo { width: 48px; }
		.leagueName { font-size: 1.15em; }
		/* the homepage hero carries the full title treatment; on a phone
		   the plaque stays crest + name so it doesn't fight the menu and
		   theme buttons for space */
		.eyebrow { display: none; }
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
		color: var(--cream);
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
