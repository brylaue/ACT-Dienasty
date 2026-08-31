<script>
    import Button, { Label } from '@smui/button';
	import Roster from './Roster.svelte';
	
	export let rosters, leagueTeamManagers, startersAndReserve, leagueData, players;

	const rosterPositions = leagueData.roster_positions;


	const numDivisions = leagueData.settings.divisions || 1;

	const divisions = [];

	for(let i = 0; i < numDivisions; i++) {
		divisions.push({
			name: leagueData.metadata ? leagueData.metadata[`division_${i + 1}`] : null,
			rosters: [],
		})
	}

	for(const rosterID in rosters) {
        const roster = rosters[rosterID];
        const division = !roster.settings.division || roster.settings.division > numDivisions ? 0 : roster.settings.division - 1;
		divisions[division].rosters.push(roster);
	}

	let expanded = false;
</script>

<style>
	.division {
		display: flex;
		justify-content: space-around;
		flex-wrap: wrap;
		margin: 10px auto 20px;
		width: 95%;
	}

	.banner {
		display: flex;
		align-items: center;
		min-height: 120px;
		width: min(500px, calc(100% - 8px));
		max-width: 100%;
		box-sizing: border-box;
		border-radius: 40px;
		margin: 10px auto;
		background-color: #f5f5f5;
		border: 2px solid #ddd;
		padding: 12px 20px;
		gap: 20px;
		overflow: hidden;
	}

	.banner {
		background: rgba(37,99,235,0.06);
		border: 1px solid rgba(37,99,235,0.22);
		border-radius: 10px;
	}

	.banner-image {
		height: 110px;
		width: clamp(110px, 32vw, 190px);
		background-repeat: no-repeat;
		background-size: contain;
		background-position: center;
		flex-shrink: 0;
	}

	.banner-D-1 .banner-image,
	.banner-D-2 .banner-image,
	.banner-D-3 .banner-image {
		background-image: url("/awards/division.svg");
		height: 74px;
	}

	.banner-text {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	h2 {
		text-align: center;
		font-size: clamp(1.5em, 3.5vw + 0.6em, 2.6em);
		line-height: 1.15;
		overflow-wrap: break-word;
		margin: 0;
		color: #333;
	}

	@media (max-width: 460px) {
		.banner {
			min-height: 90px;
			padding: 10px 15px;
			gap: 12px;
			border-radius: 30px;
		}

		.banner-image {
			height: 80px;
		}
	}

	.banner h2 {
		text-shadow: var(--fff) 0px 0px 3px, var(--fff) 0px 0px 3px, var(--fff) 0px 0px 3px,
            		 var(--fff) 0px 0px 3px, var(--fff) 0px 0px 3px, var(--fff) 0px 0px 3px;
		-webkit-font-smoothing: antialiased;
	}

	.minExp {
		display: block;
		text-align: center;
		margin: 10px 0;
		cursor: pointer;
	}

	.loading {
		display: block;
		width: 85%;
		max-width: 500px;
		margin: 80px auto;
	}

	.expandButton {
		margin: 5em auto 2em;
    	text-align: center;
	}
</style>

<div class="expandButton">
	<Button onclick={() => {expanded = !expanded}} variant="outlined">
		<Label>{expanded ? "Minimize" : "Expand"} All Benches</Label>
	</Button>
</div>

{#each divisions as division, ix}
	{#if division.name}
		<div class="banner banner-D-{ix + 1}">
			<div class="banner-image"></div>
			<div class="banner-text">
				<h2>{division.name}</h2>
			</div>
		</div>
	{/if}
	<div class="division">
		{#each division.rosters as roster}
			<Roster division={ix + 1} {expanded} {rosterPositions} {roster} {leagueTeamManagers} {players} {startersAndReserve} />
		{/each}
	</div>
{/each}
