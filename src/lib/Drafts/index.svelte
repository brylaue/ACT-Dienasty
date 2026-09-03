<script>
	import { waitForAll } from '$lib/utils/helper';
    import LinearProgress from '@smui/linear-progress';
    import Draft from './Draft.svelte'; 
    import { onMount } from 'svelte';

    export let upcomingDraftData, previousDraftsData, leagueTeamManagersData, playersData;

    // Toilet Bowl compensatory 1.13 history (constitution 3.2.5) - curated file
    let compPicks = null;
    onMount(async () => {
        try {
            const r = await fetch('/data/comp-picks.json');
            if (r.ok) compPicks = await r.json();
        } catch { /* strip simply doesn't render */ }
    });
    const compFor = (year) => compPicks?.picks?.find((c) => c.season == year) || null;
</script>

<style>
	.loading {
		display: block;
		width: 85%;
		max-width: 500px;
		margin: 80px auto;
	}

    h4 {
        text-align: center;
    }

    h6 {
        text-align: center;
    }

    .orderLocked {
        max-width: 560px;
        margin: 18px auto 26px;
        padding: 22px 26px;
        border: 1px solid var(--line, #e5e7eb);
        border-radius: 12px;
        background: var(--fff);
        text-align: center;
    }
    .lockIcon { font-size: 1.6em; }
    .lockLead { font-weight: 700; margin: 8px 0 6px; color: var(--ink); }
    .lockBody { color: var(--muted); font-size: 0.9em; line-height: 1.55; margin: 0 0 8px; }
    .lockFoot { color: var(--muted); font-size: 0.82em; font-style: italic; margin: 0; }

    .compStrip {
        display: flex;
        align-items: center;
        gap: 10px;
        max-width: 640px;
        margin: 6px auto 10px;
        padding: 8px 14px;
        border: 1px solid color-mix(in srgb, var(--accent, #2563eb) 35%, var(--line, #e5e7eb));
        border-radius: 10px;
        background: color-mix(in srgb, var(--accent, #2563eb) 6%, var(--fff));
        font-size: 0.86em;
        color: var(--ink);
    }
    .compSlot {
        font-weight: 800;
        color: var(--accent, #2563eb);
        flex-shrink: 0;
    }
    .compText { line-height: 1.4; }
</style>


{#await waitForAll(upcomingDraftData, leagueTeamManagersData, playersData) }
	<div class="loading">
		<p>Retrieving upcoming draft...</p>
		<br />
		<LinearProgress indeterminate />
	</div>
{:then [upcomingDraft, leagueTeamManagers, {players}] }
    <h4>Upcoming {upcomingDraft.year} Draft</h4>
    {#if upcomingDraft.accuracy && upcomingDraft.accuracy !== 1}
        <!-- The order is still a projection - per the constitution it only locks
             once the season (including the Toilet Bowl) is complete. -->
        <div class="orderLocked">
            <span class="lockIcon">🔒</span>
            <p class="lockLead">The {upcomingDraft.year} draft order isn't set yet.</p>
            <p class="lockBody">It locks when the {upcomingDraft.year - 1} season ends: picks 1&ndash;6 go to the non-playoff teams (worst record first), picks 7&ndash;8 to the Wild Card losers by regular-season record, and picks 9&ndash;12 come from the playoff results. The Toilet Bowl winner earns the compensatory 1.13.</p>
            <p class="lockFoot">The board will appear here after Week 17.</p>
        </div>
    {:else}
        <Draft draftData={upcomingDraft} {leagueTeamManagers} year={upcomingDraft.year} {players} />
    {/if}
{:catch error}
	<!-- promise was rejected -->
	<p>Something went wrong: {error.message}</p>
{/await}


{#await waitForAll(previousDraftsData, leagueTeamManagersData, playersData) }
	<hr />
	<h4>Previous Drafts</h4>
	<div class="loading">
		<p>Retrieving previous drafts...</p>
		<br />
		<LinearProgress indeterminate />
	</div>
{:then [previousDrafts, leagueTeamManagers, {players}] }
	<!-- Don't display anything unless there are previous drafts -->
	{#if previousDrafts.length}
		<hr />
		<h4>Previous Drafts</h4>
		{#each previousDrafts as previousDraft}
			<h6>{previousDraft.year} Draft</h6>
			{#if compFor(previousDraft.year)}
				{@const cp = compFor(previousDraft.year)}
				<div class="compStrip">
					<span class="compSlot">1.13</span>
					<span class="compText"><b>{cp.player}</b> ({cp.pos}) &mdash; {cp.teamName} &middot; Toilet Bowl comp pick ({cp.wonYear} winner), selected outside Sleeper's board{#if cp.postscript} &middot; {cp.postscript}{/if}</span>
				</div>
			{/if}
			<Draft draftData={previousDraft} previous={true} {leagueTeamManagers} year={previousDraft.year} {players} />
		{/each}
	{/if}
{:catch error}
	<!-- promise was rejected -->
	<p>Something went wrong: {error.message}</p>
{/await}