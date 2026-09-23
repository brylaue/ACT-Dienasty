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

    // weekly present-tense re-grade, baked by the bot (overwritten each
    // completed week) - the original verdict above stays frozen
    const nowPromise = gradeable
        ? getCommentary().then((c) => c?.tradeNow?.[transaction.id] || null)
        : Promise.resolve(null);
    const nameFor = (rid) => getTeamFromTeamManagers(leagueTeamManagers, rid, transaction.season).name;
    const pctDelta = (now, then) => {
        if (!now || !then) return null;
        const d = Math.round(((now - then) / then) * 100);
        return d === 0 ? null : (d > 0 ? '+' : '') + d + '%';
    };
    const statusTag = (st) => st === 'Questionable' ? 'Q' : st === 'Doubtful' ? 'D' : st === 'Out' ? 'OUT' : st === 'IR' ? 'IR' : st;
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
    .tradeNow {
        margin: 0.7em 1em 0;
        padding: 0.6em 0 0.8em;
        border-top: 1px dashed var(--line);
    }
    .tnHeader {
        display: flex;
        align-items: center;
        gap: 0.45em;
        font-size: 0.68em;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: var(--g999);
        margin-bottom: 0.45em;
    }
    .tnDot {
        width: 7px; height: 7px; border-radius: 50%;
        background: #10b981;
        animation: tnPulse 2.2s ease-in-out infinite;
    }
    @keyframes tnPulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
    .tnSide {
        display: flex;
        flex-wrap: wrap;
        gap: 2px 10px;
        align-items: baseline;
        font-size: 0.82em;
        margin: 4px 0;
    }
    .tnTeam { font-weight: 700; }
    .tnPts { color: var(--muted); font-variant-numeric: tabular-nums; }
    .tnAssets { flex-basis: 100%; color: var(--ink); opacity: 0.85; line-height: 1.5; }
    .tag {
        font-style: normal;
        font-size: 0.78em;
        font-weight: 700;
        padding: 0 4px;
        border-radius: 4px;
        margin-left: 3px;
        vertical-align: 1px;
        border: 1px solid var(--line);
        color: var(--muted);
    }
    .tag.warn { color: #d97706; border-color: color-mix(in srgb, #d97706 40%, var(--line)); }
    .tag.gone { color: #dc2626; border-color: color-mix(in srgb, #dc2626 40%, var(--line)); }
    .tag.up { color: #16a34a; border-color: color-mix(in srgb, #16a34a 40%, var(--line)); }
    .tag.down { color: #dc2626; border-color: color-mix(in srgb, #dc2626 40%, var(--line)); }
    .tnLine {
        margin: 0.5em 0 0;
        font-size: 0.84em;
        font-style: italic;
        color: var(--ink);
        opacity: 0.9;
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
    {#await nowPromise then now}
        {#if now}
            <div class="tradeNow">
                <div class="tnHeader"><span class="tnDot"></span>Where it stands — through Wk {now.week}</div>
                {#each now.sides as side}
                    <div class="tnSide">
                        <span class="tnTeam">{nameFor(side.rosterID)}</span>
                        {#if side.players.length}<span class="tnPts">{side.pts} pts from the haul</span>{/if}
                        <span class="tnAssets">
                            {#each side.players as pl, i}{i > 0 ? ' · ' : ''}{pl.name} {pl.pts}{#if pl.status}<em class="tag warn">{statusTag(pl.status)}</em>{/if}{#if !pl.stillOn}<em class="tag gone">gone</em>{/if}{/each}
                            {#each side.picks as pk, i}{(side.players.length || i > 0) ? ' · ' : ''}{pk.label}{#if pk.conveyed} <em class="tag">conveyed</em>{:else} ~{(pk.valueNow / 1000).toFixed(1)}k{#if pctDelta(pk.valueNow, pk.valueAtTrade)}<em class="tag" class:up={pk.valueNow > pk.valueAtTrade} class:down={pk.valueNow < pk.valueAtTrade}>{pctDelta(pk.valueNow, pk.valueAtTrade)}</em>{/if}{/if}{/each}
                            {#if side.faab}{(side.players.length || side.picks.length) ? ' · ' : ''}${side.faab} FAAB{/if}
                        </span>
                    </div>
                {/each}
                {#if now.line}
                    <p class="tnLine">{now.line}</p>
                {/if}
            </div>
        {/if}
    {/await}
{/if}
