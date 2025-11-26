<script>
	import LinearProgress from '@smui/linear-progress';
	import { Rivalry } from '$lib/components'
	import { waitForAll } from '$lib/utils/helper';

	export let data;
	const {
        leagueTeamManagerData,
        playersData,
        transactionsData,
        recordsData,
        playerOne,
        playerTwo,
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
		background-image: linear-gradient(135deg, rgba(2, 8, 20, 0.65), rgba(12, 32, 57, 0.85)), url('/rivalry-titans.svg');
		background-size: cover;
		background-position: center top;
		background-repeat: no-repeat;
		opacity: 0.35;
		z-index: -1;
		pointer-events: none;
		filter: saturate(1.1);
	}
	.loading {
		display: block;
		width: 85%;
		max-width: 500px;
		margin: 80px auto;
	}
</style>

<div class="holder">
	{#await waitForAll(leagueTeamManagerData, playersData, transactionsData, recordsData)}
		<div class="loading">
			<p>Gathering information...</p>
			<br />
			<LinearProgress indeterminate />
		</div>
	{:then [leagueTeamManagers, playersInfo, transactionsInfo, recordsInfo]}
		<!-- promise was fulfilled -->
		<Rivalry {leagueTeamManagers} {playersInfo} {transactionsInfo} {recordsInfo} {playerOne} {playerTwo} />
	{:catch error}
		<!-- promise was rejected -->
		<p>Something went wrong: {error.message}</p>
	{/await}
</div>
