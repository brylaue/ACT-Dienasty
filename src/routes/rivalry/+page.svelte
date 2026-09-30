<script>
	import LinearProgress from '@smui/linear-progress';
	import { Rivalry } from '$lib/components'
	import { waitForAll } from '$lib/utils/helper';

	export let data;
	const {
        leagueTeamManagerData,
        playersData,
        transactionsData,
        teamOne,
        teamTwo,
    } = data;
</script>

<style>
	.holder {
		position: relative;
		z-index: 1;
		padding-bottom: 60px;
		isolation: isolate;
	}
	.holder::before {
		content: "";
		position: absolute;
		inset: 0;
		/* a quiet wash instead of the old full-page artwork - the crest is the art */
		background-image: radial-gradient(ellipse at 50% 0%, color-mix(in srgb, var(--accent) 14%, transparent), transparent 60%);
		z-index: -1;
		pointer-events: none;
	}
	.loading {
		display: block;
		width: 85%;
		max-width: 500px;
		margin: 80px auto;
	}
</style>

<div class="holder">
	{#await waitForAll(leagueTeamManagerData, playersData, transactionsData)}
		<div class="loading">
			<p>Gathering information...</p>
			<br />
			<LinearProgress indeterminate />
		</div>
	{:then [leagueTeamManagers, playersInfo, transactionsInfo]}
		<!-- promise was fulfilled -->
		<Rivalry {leagueTeamManagers} {playersInfo} {transactionsInfo} {teamOne} {teamTwo} />
	{:catch error}
		<!-- promise was rejected -->
		<p>Something went wrong: {error.message}</p>
	{/await}
</div>
