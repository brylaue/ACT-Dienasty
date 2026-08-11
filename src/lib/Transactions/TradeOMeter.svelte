<script>
    import { getTradeValues, analyzeTrade } from '$lib/utils/helperFunctions/tradeAnalysis';
    import { getTeamFromTeamManagers } from '$lib/utils/helperFunctions/universalFunctions';

    export let transaction, leagueTeamManagers;

    // grade only reasonably recent trades - grading a 2019 trade with
    // today's values would be nonsense (entertaining nonsense, but nonsense)
    const now = new Date();
    const currentNflSeason = now.getMonth() < 3 ? now.getFullYear() - 1 : now.getFullYear();
    const gradeable = transaction.type == 'trade'
        && transaction.rosters.length == 2
        && transaction.season >= currentNflSeason;

    const teamNames = transaction.rosters.map((r) =>
        getTeamFromTeamManagers(leagueTeamManagers, r, transaction.season).name
    );

    const analysisPromise = gradeable
        ? getTradeValues().then((values) => analyzeTrade(transaction, values, teamNames))
        : Promise.resolve(null);
</script>

<style>
    .tradeOMeter {
        background-color: var(--fff);
        border-left: 2px solid var(--blueOne);
        border-right: 1px solid var(--ddd);
        padding: 0.6em 1em 0.8em;
    }

    .tomHeader {
        display: flex;
        justify-content: center;
        align-items: center;
        gap: 0.5em;
        font-size: 0.7em;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: var(--g999);
        margin-bottom: 0.5em;
    }

    .bar {
        display: flex;
        height: 12px;
        border-radius: 6px;
        overflow: hidden;
        background-color: var(--eee);
    }

    .barA {
        background-color: var(--blueOne);
        transition: width 0.6s ease;
    }

    .barB {
        background-color: var(--QB);
        transition: width 0.6s ease;
    }

    .totals {
        display: flex;
        justify-content: space-between;
        font-size: 0.75em;
        margin-top: 0.35em;
        color: var(--g555);
    }

    .grade {
        display: inline-block;
        font-weight: bold;
        border-radius: 4px;
        padding: 0 0.35em;
        margin-left: 0.3em;
        background-color: var(--eee);
        color: var(--g111);
    }

    .verdict {
        text-align: center;
        font-size: 0.85em;
        font-style: italic;
        margin-top: 0.55em;
        color: var(--g333);
    }

    .disclaimer {
        text-align: center;
        font-size: 0.6em;
        color: var(--g999);
        margin-top: 0.4em;
    }
</style>

{#if gradeable}
    {#await analysisPromise then analysis}
        {#if analysis}
            <div class="tradeOMeter">
                <div class="tomHeader">⚖️ Trade-o-Meter</div>
                <div class="bar">
                    <div class="barA" style="width: {analysis.sides[0].total / (analysis.sides[0].total + analysis.sides[1].total) * 100}%"></div>
                    <div class="barB" style="width: {analysis.sides[1].total / (analysis.sides[0].total + analysis.sides[1].total) * 100}%"></div>
                </div>
                <div class="totals">
                    <span>
                        {analysis.sides[0].total.toLocaleString()}
                        <span class="grade">{analysis.grades[analysis.sides[0].rosterID]}</span>
                    </span>
                    <span>
                        <span class="grade">{analysis.grades[analysis.sides[1].rosterID]}</span>
                        {analysis.sides[1].total.toLocaleString()}
                    </span>
                </div>
                <div class="verdict">{analysis.verdict}</div>
                <div class="disclaimer">per FantasyCalc dynasty values (superflex, 0.5 PPR) · for entertainment &amp; trash talk purposes</div>
            </div>
        {/if}
    {:catch}
        <!-- values unavailable: show nothing, the trade still renders normally -->
    {/await}
{/if}
