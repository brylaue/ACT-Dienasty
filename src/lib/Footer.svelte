<script>
	import { goto } from '$app/navigation';
    import { managers } from '$lib/utils/helper';
	import { tabs } from '$lib/utils/tabs';
	import { onMount } from 'svelte';

	let outOfDate = $state(false);
    let managersOutOfDate = false;

	onMount(async () => {
        try {
            const res = await fetch('/api/checkVersion', {compress: true});
            const needUpdate = await res.json();
            outOfDate = needUpdate;
        } catch (error) {
            console.error('Unable to confirm latest version', error);
        }
	});

    if(managers) {
        for(const manager of managers) {
            if(manager.roster && !manager.managerID) {
                managersOutOfDate = true;
                break;
            }
        }
    }

	const year = new Date().getFullYear();
</script>

<style>
	footer {
		background-color: var(--f8f8f8);
		width: 100%;
        display: block;
		border-top: 1px solid #920505;
		padding: 30px 0 40px;
		text-align: center;
		color: #777;
		margin-top: 40px;
	}

	#navigation {
		margin: 0 0 2em;
		padding: 0 1rem;
	}

	#navigation ul {
		margin: 0;
		padding: 0;
		display: inline-flex;
		flex-wrap: wrap;
		gap: 0.25em 0.75em;
		justify-content: center;
	}

	#navigation ul li {
		list-style-type: none;
		display: inline;
	}

	#navigation li:not(:first-child):before {
		content: " | ";
		color: var(--g999, #999);
	}

	.navLink {
		display: inline-block;
		cursor: pointer;
		padding: 6px 10px;
	}

	.navLink:hover {
		color: #920505;
	}

	.updateNotice {
		color: var(--g999);
		font-style: italic;
		font-size: 0.8em;
		margin-top: 0;
	}

	@media (max-width: 600px) {
		footer {
			padding: 24px 16px 32px;
			margin-top: 24px;
		}

		#navigation ul {
			display: flex;
			flex-direction: column;
			gap: 0.4em;
			align-items: center;
		}

		#navigation ul li {
			display: block;
		}

		#navigation li:not(:first-child):before {
			content: none;
		}

		.navLink {
			display: block;
			padding: 6px 0;
		}
	}
</style>

<!-- footer with update notice -->
<footer>
    {#if outOfDate}
	    <p class="updateNotice">There is an update available for your League Page. <a href="https://github.com/nmelhado/league-page/blob/master/TRAINING_WHEELS.md#iv-updates">Follow the Update Instructions</a> to get all of the newest features!</p>
    {/if}
    {#if managersOutOfDate}
	    <p class="updateNotice">Your managers page needs an update, <a href="https://github.com/nmelhado/league-page/blob/master/TRAINING_WHEELS.md#2-add-managers">please follow the instructions</a> to get the most up-to-date experience.</p>
    {/if}
	<div id="navigation">
		<ul>
			{#each tabs as tab}
				{#if !tab.nest}
					<li><div class="navLink" onclick={() => goto(tab.dest)}>{tab.label}</div></li>
				{:else}
					{#each tab.children as child}
                        <!-- Shouldn't show Managers tab unless managers has been populated -->
				        {#if child.label != "Managers" || managers.length > 0}
							{#if child.label == "Go to Sleeper"}
								<li><div class="navLink" onclick={() => window.location = child.dest}>{child.label}</div></li>
							{:else}
                            	<li><div class="navLink" onclick={() => goto(child.dest)}>{child.label}</div></li>
							{/if}
                        {/if}
					{/each}
				{/if}
			{/each}
		</ul>
	</div>
	<!-- PLEASE DO NOT REMOVE THE BUILT BY -->
	<span class="creator">Build forked from <a href="http://www.nmelhado.com/">Nicholas Melhado</a><br /></span>
</footer>
