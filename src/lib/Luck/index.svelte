<script>
    import LinearProgress from '@smui/linear-progress';
    import { gotoManager } from '$lib/utils/helper';
    import { getLuckIndex } from '$lib/utils/helperFunctions/luckIndex';
    import { getFranchises } from '$lib/utils/helperFunctions/rivalryMatchups';
    import { round } from '$lib/utils/helper';

    export let leagueTeamManagers;

    const franchises = getFranchises(leagueTeamManagers);
    const byRoster = {};
    for (const f of franchises) byRoster[f.rosterID] = f;

    const luckPromise = getLuckIndex();
    const currentYear = leagueTeamManagers.currentSeason;

    let selectedYear = "all";
    const rowsFor = (data, year) => year == "all" ? data.all : (data.byYear[year] || []);

    const rec = (r) => `${r.wins}-${r.losses}${r.ties ? `-${r.ties}` : ''}`;
    const apRec = (r) => `${r.apWins}-${r.apLosses}${r.apTies ? `-${r.apTies}` : ''}`;
    const luckLabel = (luck) => {
        if (luck >= 6) return "🍀 blessed by the schedule gods";
        if (luck >= 2) return "🙂 a little fortunate";
        if (luck > -2) return "😐 earned every bit of it";
        if (luck > -6) return "🙃 mildly cursed";
        return "🪦 pray for this franchise";
    };
</script>

<style>
    h2 {
        text-align: center;
        font-size: 2.4em;
        margin: 1.3em 0 0.3em;
    }
    .subtitle {
        text-align: center;
        color: var(--g555);
        font-style: italic;
        margin: 0 auto 1.2em;
        max-width: 620px;
        font-size: 0.9em;
        padding: 0 1em;
    }
    .chips {
        display: flex;
        justify-content: center;
        flex-wrap: wrap;
        gap: 0.4em;
        margin-bottom: 1.2em;
    }
    .chip {
        border: 1px solid var(--ccc);
        border-radius: 14px;
        padding: 0.2em 0.8em;
        font-size: 0.8em;
        cursor: pointer;
        background-color: var(--fff);
        color: var(--g111);
    }
    .chip.active {
        background-color: var(--blueOne);
        border-color: var(--blueOne);
        color: #fff;
    }
    .board {
        width: 97%;
        max-width: 850px;
        margin: 0 auto 2em;
        border-radius: 20px;
        background-color: var(--fff);
        border: 1px solid var(--ddd);
        padding: 1em 0 1.2em;
    }
    .row {
        display: flex;
        align-items: center;
        gap: 0.6em;
        padding: 0.42em 1em;
        cursor: pointer;
    }
    .row img {
        width: 30px;
        height: 30px;
        border-radius: 50%;
        border: 1px solid var(--ccc);
        flex-shrink: 0;
    }
    .who {
        width: 160px;
        flex-shrink: 0;
    }
    .who .name {
        display: block;
        font-size: 0.85em;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }
    .who .records {
        display: block;
        font-size: 0.65em;
        color: var(--g999);
    }
    .barZone {
        flex: 1;
        display: flex;
        height: 15px;
        position: relative;
    }
    .halfLeft, .halfRight {
        width: 50%;
        height: 100%;
        position: relative;
        background-color: var(--eee);
    }
    .halfLeft { border-radius: 8px 0 0 8px; }
    .halfRight { border-radius: 0 8px 8px 0; border-left: 2px solid var(--g999); }
    .barNeg {
        position: absolute;
        right: 0;
        height: 100%;
        background-color: var(--QB);
        border-radius: 8px 0 0 8px;
    }
    .barPos {
        position: absolute;
        left: 0;
        height: 100%;
        background-color: var(--RB);
        border-radius: 0 8px 8px 0;
    }
    .luckVal {
        width: 60px;
        text-align: right;
        font-size: 0.8em;
        font-weight: bold;
        flex-shrink: 0;
    }
    .luckTag {
        text-align: right;
        width: 175px;
        font-size: 0.62em;
        color: var(--g555);
        font-style: italic;
        flex-shrink: 0;
    }
    .explainer {
        text-align: center;
        font-size: 0.65em;
        color: var(--g999);
        margin: 0.4em auto 2em;
        max-width: 640px;
        padding: 0 1em;
    }
    .loading {
        display: block;
        width: 85%;
        max-width: 500px;
        margin: 80px auto;
    }
    @media (max-width: 620px) {
        .luckTag { display: none; }
        .who { width: 125px; }
    }
</style>

<h2>Luck Index</h2>
<p class="subtitle">Your real record vs your "all-play" record (as if you played every team every week). The gap is pure schedule luck — the stat that settles whether you're good or just fortunate.</p>

{#await luckPromise}
    <div class="loading">
        <p>Consulting the schedule gods...</p>
        <br />
        <LinearProgress indeterminate />
    </div>
{:then data}
    <div class="chips">
        <span class="chip" class:active={selectedYear == "all"} onclick={() => selectedYear = "all"}>All-Time</span>
        {#each data.years as year}
            <span class="chip" class:active={selectedYear == year} onclick={() => selectedYear = year}>{year}</span>
        {/each}
    </div>
    <div class="board">
        {#each rowsFor(data, selectedYear) as row}
            {#if byRoster[row.rosterID]}
                <div class="row" onclick={() => gotoManager({year: currentYear, leagueTeamManagers, rosterID: row.rosterID})}>
                    <img src="{byRoster[row.rosterID].avatar}" alt="{byRoster[row.rosterID].name} avatar" />
                    <span class="who">
                        <span class="name">{byRoster[row.rosterID].name}</span>
                        <span class="records">actual {rec(row)} · all-play {apRec(row)}</span>
                    </span>
                    <div class="barZone">
                        <div class="halfLeft">
                            {#if row.luck < 0}
                                <div class="barNeg" style="width: {Math.min(-row.luck / 12 * 100, 100)}%"></div>
                            {/if}
                        </div>
                        <div class="halfRight">
                            {#if row.luck > 0}
                                <div class="barPos" style="width: {Math.min(row.luck / 12 * 100, 100)}%"></div>
                            {/if}
                        </div>
                    </div>
                    <span class="luckVal" style="color: {row.luck >= 0 ? 'var(--RB)' : 'var(--QB)'}">{row.luck >= 0 ? '+' : ''}{round(row.luck)}</span>
                    <span class="luckTag">{luckLabel(row.luck)}</span>
                </div>
            {/if}
        {/each}
    </div>
    <p class="explainer">Luck = actual win% minus all-play win%, in percentage points. Positive means the schedule handed you wins your scoring didn't earn; negative means you got robbed. Regular season only.</p>
{:catch error}
    <p class="explainer">Couldn't compute luck: {error.message}</p>
{/await}
