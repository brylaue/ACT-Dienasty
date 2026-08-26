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
	<Drafts {upcomingDraftData} {previousDraftsData} {leagueTeamManagersData} {playersData} />
</div>