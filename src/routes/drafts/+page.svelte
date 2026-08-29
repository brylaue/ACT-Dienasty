<script>
	import { Drafts } from '$lib/components';
	import CompPickBanner from '$lib/CompPickBanner.svelte';

    export let data;
    const {upcomingDraftData, previousDraftsData, leagueTeamManagersData, playersData} = data;
</script>

<style>
    #main {
        position: relative;
        z-index: 1;
    }
</style>

<div id="main">
	<CompPickBanner />
	<p style="text-align:center; margin: 4px 0 0;"><a href="/draft-recap" style="font-size: 0.9em;">🎤 Read The Oracle's 2026 Draft Roast →</a></p>
	<Drafts {upcomingDraftData} {previousDraftsData} {leagueTeamManagersData} {playersData} />
</div>