<script>
	import Matchup from "$lib/Matchups/Matchup.svelte";
	import TradeTransaction from "$lib/Transactions/TradeTransaction.svelte";
	import { getLeagueTransactions, getRivalryMatchups, loadPlayers, round } from "$lib/utils/helper";
	import LinearProgress from '@smui/linear-progress';
	import { onMount } from "svelte";
	import ComparissonBar from "./ComparissonBar.svelte";
	import TeamSelectors from "./TeamSelectors.svelte";
	import RivalryControls from "./RivalryControls.svelte";

	export let leagueTeamManagers, playersInfo, transactionsInfo, teamOne, teamTwo;

    // refresh stale data
    onMount(async () => {
        if(transactionsInfo.stale) {
            transactionsInfo = await getLeagueTransactions(false, true);
        }
        if(playersInfo.stale) {
            playersInfo = await loadPlayers(null, true);
        }
    })

    let rivalry = null;
    let loading = true;

    const analyzeRivalry = async (t1, t2) => {
        loading = true;
        matchup = null;
        selected = 0;
        if(t1 && t2) {
            rivalry = await getRivalryMatchups(t1, t2);
            loading = false;
        }
    }

    $: analyzeRivalry(teamOne, teamTwo);

    let selected = 0;

    $: matchup = rivalry?.matchups[selected]?.matchup;
    $: displayWeek = rivalry?.matchups[selected]?.week;
    $: year = rivalry?.matchups[selected]?.year;
    $: isPlayoff = rivalry?.matchups[selected]?.playoff || false;
    $: playoffPlace = rivalry?.matchups[selected]?.place || null;

    // Trade history between the two franchises - simple roster membership,
    // which automatically includes trades made by previous owners
    const setTradeHistory = (t1, t2) => {
        if(!t1 || !t2) {
            return [];
        }
        const r1 = parseInt(t1);
        const r2 = parseInt(t2);
        const trades = transactionsInfo.transactions.filter( transaction =>
            transaction.type === "trade"
            && transaction.rosters.includes(r1)
            && transaction.rosters.includes(r2)
        );
        const move = (arr, from, to) => {
            arr.splice(to, 0, arr.splice(from, 1)[0]);
        };
        // align franchise one on the left and franchise two on the right
        return trades.map(t => {
            const oneStart = t.rosters.indexOf(r1);
            if(oneStart > 0) {
                move(t.rosters, oneStart, 0);
                for(const tradeMove of t.moves) {
                    move(tradeMove, oneStart, 0);
                }
            }
            const twoStart = t.rosters.indexOf(r2);
            const last = t.rosters.length - 1;
            if(twoStart < last) {
                move(t.rosters, twoStart, last);
                for(const tradeMove of t.moves) {
                    move(tradeMove, twoStart, last);
                }
            }
            return t;
        })
    }

    $: tradeHistory = setTradeHistory(teamOne, teamTwo);

    const pct = (rec) => rec.games ? round(rec.wins / rec.games * 100) : 0;
    const perGame = (rec) => rec.games ? round(rec.fpts / rec.games) : 0;
</script>

<style>
    .scoreBoard {
        width: 97%;
        border-radius: 20px;
        background-color: var(--rivalryBack);
        border: 1px solid var(--aaa);
        margin: 2em auto;
        padding: 2em 0;
        max-width: 1000px;
    }
    h2 {
        text-align: center;
        font-size: 2.4em;
        margin: 1.3em 0 0;
    }
    h3 {
        text-align: center;
        font-size: 1.9em;
        margin: 20px 0 16px;
    }
    .trades {
        width: 95%;
        max-width: 750px;
        margin: 2em auto;
    }
	.loading {
		display: block;
		width: 85%;
		max-width: 500px;
		margin: 80px auto;
	}
    .center {
        text-align: center;
    }
    .noHistory {
        text-align: center;
        color: var(--g555);
        font-style: italic;
        padding: 1em 0;
    }
    .rivalryBackdrop {
        display: block;
        width: min(920px, 90vw);
        margin: 0 auto 2.5em;
        filter: drop-shadow(0 25px 45px rgba(7, 9, 30, 0.45));
        opacity: 0.95;
        transition: transform 240ms ease, opacity 240ms ease;
    }
    .rivalryBackdrop:hover {
        opacity: 1;
        transform: scale(1.01);
    }
    @media (max-width: 650px) {
        h3 {
            font-size: 1.6em;
        }
    }
    @media (max-width: 400px) {
        h2 {
            font-size: 2em;
        }
        h3 {
            font-size: 1.3em;
        }
    }
</style>

<h2>Rivalry</h2>

<div class="rivalrySelection">
    <TeamSelectors bind:teamOne={teamOne} bind:teamTwo={teamTwo} {leagueTeamManagers} />
</div>

{#if loading }
    {#if teamOne && teamTwo }
        <div class="loading">
            <p>Analyzing rivalry...</p>
            <br />
            <LinearProgress indeterminate />
        </div>
    {:else}
        <div class="center">
            <img
                class="rivalryBackdrop"
                src="/rivalry-titans.svg"
                alt="stylized Greek titans colliding over a fantasy gridiron"
            />
        </div>
    {/if}
{:else if rivalry}
    {#if rivalry.matchups.length > 0 }
        <div class="scoreBoard">
            <h3>Head to Head</h3>
            <!-- wins -->
            <ComparissonBar sideOne={rivalry.wins.one} sideTwo={rivalry.wins.two} label="Regular Season Wins" unit="wins" />
            <!-- points -->
            <ComparissonBar sideOne={parseFloat(round(rivalry.points.one))} sideTwo={parseFloat(round(rivalry.points.two))} label="Regular Season Points" unit="pts" />
            {#if rivalry.playoffs.meetings > 0}
                <!-- playoff head-to-head (winners bracket games only) -->
                <ComparissonBar sideOne={rivalry.playoffs.wins.one} sideTwo={rivalry.playoffs.wins.two} label="Playoff Wins" unit="wins" />
                <ComparissonBar sideOne={parseFloat(round(rivalry.playoffs.points.one))} sideTwo={parseFloat(round(rivalry.playoffs.points.two))} label="Playoff Points" unit="pts" />
            {/if}
            <h3>Matchups</h3>
            <RivalryControls bind:selected={selected} {year} {displayWeek} {isPlayoff} {playoffPlace} length={rivalry.matchups.length} />
            <Matchup key={`${teamOne}-${teamTwo}`} ix={selected} active={selected} {year} {matchup} players={playersInfo.players} {displayWeek} expandOverride={true} {leagueTeamManagers} />
        </div>
    {:else}
        <div class="scoreBoard">
            <p class="noHistory">These two franchises have never met in the regular season.</p>
        </div>
    {/if}
    <div class="scoreBoard">
        <!-- trades -->
        <h3>Trade History</h3>
        <div class="trades">
            {#each tradeHistory as transaction }
                <TradeTransaction players={playersInfo.players} {transaction} {leagueTeamManagers} />
            {:else}
                <p class="noHistory">No trades between these franchises yet...</p>
            {/each}
        </div>
    </div>
    {#if rivalry.overall.one.games > 0 && rivalry.overall.two.games > 0 }
        <div class="scoreBoard">
            <!-- all-time franchise comparison, computed from every regular season game -->
            <h3>Franchise Comparison</h3>
            <ComparissonBar
                sideOne={parseFloat(pct(rivalry.overall.one))}
                sideTwo={parseFloat(pct(rivalry.overall.two))}
                label="All-Time Win Percentage"
                unit="%"
            />
            <ComparissonBar sideOne={rivalry.overall.one.wins} sideTwo={rivalry.overall.two.wins} label="All-Time Wins" unit="wins" />
            <ComparissonBar sideOne={rivalry.overall.one.losses} sideTwo={rivalry.overall.two.losses} label="All-Time Losses" unit="losses" />
            <ComparissonBar
                sideOne={parseFloat(round(rivalry.overall.one.fpts))}
                sideTwo={parseFloat(round(rivalry.overall.two.fpts))}
                label="All-Time Fantasy Points"
                unit="fpts"
            />
            <ComparissonBar
                sideOne={parseFloat(perGame(rivalry.overall.one))}
                sideTwo={parseFloat(perGame(rivalry.overall.two))}
                label="Fantasy Points per Game"
                unit="fpts/game"
            />
        </div>
    {/if}
{/if}
