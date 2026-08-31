<script>
    import { getTradeValues, analyzeTrade } from '$lib/utils/helperFunctions/tradeAnalysis';
    import { getTeamFromTeamManagers } from '$lib/utils/helperFunctions/universalFunctions';
    import { getCommentary } from '$lib/utils/helperFunctions/commentary';

    export let transaction, leagueTeamManagers;

    // grade only reasonably recent trades - grading a 2019 trade with
    // today's values would be nonsense (entertaining nonsense, but nonsense)
    const now = new Date();
    const currentNflSeason = now.getMonth() < 3 ? now.getFullYear() - 1 : now.getFullYear();
    const gradeable = transaction.type == 'trade'
        && transaction.rosters.length >= 2
        && transaction.season >= currentNflSeason;

    const teamNames = transaction.rosters.map((r) =>
        getTeamFromTeamManagers(leagueTeamManagers, r, transaction.season).name
    );

    const analysisPromise = gradeable
        ? Promise.all([getTradeValues(), getCommentary()]).then(
            ([values, commentary]) => analyzeTrade(transaction, values, teamNames, commentary)
        )
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

    .seg { height: 100%; }
    .seg0 { background: var(--accent, #2563eb); }
    .seg1 { background: #f59e0b; }
    .seg2 { background: #10b981; }

    .totals.multi { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 6px; text-align: center; }
    .sideName { display: block; font-size: 0.8em; color: var(--muted, #6b7280); }

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
                    {#each analysis.sides as side, ix}
                        <div class="seg seg{ix % 3}" style="width: {side.total / Math.max(analysis.sides.reduce((a, s) => a + s.total, 0), 1) * 100}%"></div>
                    {/each}
                </div>
                <div class="totals" class:multi={analysis.sides.length > 2}>
                    {#each analysis.sides as side}
                        <span class="sideTotal">
                            {#if analysis.sides.length > 2}<span class="sideName">{side.name}</span>{/if}
                            {side.total.toLocaleString()}
                            <span class="grade">{analysis.grades[side.rosterID]}</span>
                        </span>
                    {/each}
                </div>
                <div class="verdict">{analysis.verdict}</div>
                <div class="disclaimer">per FantasyCalc dynasty values (superflex, 0.5 PPR) · for entertainment &amp; trash talk purposes</div>
            </div>
        {/if}
    {:catch}
        <!-- values unavailable: show nothing, the trade still renders normally -->
    {/await}
{/if}
