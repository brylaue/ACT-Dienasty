<script>
	import LinearProgress from '@smui/linear-progress';
	import LuckIndex from '$lib/Luck/index.svelte';

	export let data;
	const { leagueTeamManagerData } = data;
</script>

<style>
	.holder { position: relative; z-index: 1; padding-bottom: 60px; }
	.loading { display: block; width: 85%; max-width: 500px; margin: 80px auto; }
</style>

<div class="holder">
	{#await leagueTeamManagerData}
		<div class="loading">
			<p>Gathering information...</p>
			<br />
			<LinearProgress indeterminate />
		</div>
	{:then leagueTeamManagers}
		<LuckIndex {leagueTeamManagers} />
	{:catch error}
		<p>Something went wrong: {error.message}</p>
	{/await}
</div>
