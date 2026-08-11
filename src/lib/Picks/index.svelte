<script>
    import LinearProgress from '@smui/linear-progress';
    import { gotoManager } from '$lib/utils/helper';
    import { getPickMatrix } from '$lib/utils/helperFunctions/pickOwnership';
    import { getFranchises } from '$lib/utils/helperFunctions/rivalryMatchups';

    export let leagueTeamManagers;

    const franchises = getFranchises(leagueTeamManagers);
    const byRoster = {};
    for (const f of franchises) byRoster[f.rosterID] = f;

    const nameFor = (rosterID) => byRoster[rosterID]?.name || `Team ${rosterID}`;
    const shortName = (rosterID) => {
        const n = nameFor(rosterID);
        return n.length > 12 ? n.slice(0, 11).trimEnd() + '…' : n;
    };

    const matrixPromise = getPickMatrix();
    const currentYear = leagueTeamManagers.currentSeason;

    const capitalRows = (m) => {
        if (!m.capital) return null;
        return franchises
            .map((f) => ({ ...f, ...m.capital[f.rosterID] }))
            .sort((a, b) => b.total - a.total);
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
        margin: 0 auto 1.5em;
        max-width: 600px;
        font-size: 0.9em;
        padding: 0 1em;
    }
    h3 {
        text-align: center;
        font-size: 1.7em;
        margin: 1.4em 0 0.8em;
    }
    .board {
        width: 97%;
        max-width: 900px;
        margin: 0 auto 2em;
        border-radius: 20px;
        background-color: var(--fff);
        border: 1px solid var(--ddd);
        padding: 0.5em 0 1.5em;
        overflow: hidden;
    }
    /* capital rankings */
    .capRow {
        display: flex;
        align-items: center;
        gap: 0.6em;
        padding: 0.3em 1em;
        cursor: pointer;
    }
    .capRank {
        width: 1.6em;
        text-align: right;
        color: var(--g999);
        font-size: 0.85em;
        flex-shrink: 0;
    }
    .capAvatar {
        width: 28px;
        height: 28px;
        border-radius: 50%;
        border: 1px solid var(--ccc);
        flex-shrink: 0;
    }
    .capName {
        width: 140px;
        font-size: 0.85em;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        flex-shrink: 0;
    }
    .capBarTrack {
        flex: 1;
        height: 14px;
        background-color: var(--eee);
        border-radius: 7px;
        overflow: hidden;
    }
    .capBar {
        height: 100%;
        background: linear-gradient(90deg, var(--blueTwo), var(--blueOne));
        border-radius: 7px;
    }
    .capVal {
        width: 110px;
        text-align: right;
        font-size: 0.75em;
        color: var(--g555);
        flex-shrink: 0;
    }
    /* ownership grid */
    .gridWrap {
        overflow-x: auto;
        padding: 0 0.5em;
    }
    table {
        width: 100%;
        border-collapse: collapse;
        min-width: 540px;
    }
    th {
        font-size: 0.75em;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--g999);
        padding: 0.5em 0.4em;
        border-bottom: 2px solid var(--ddd);
        text-align: center;
    }
    th.teamCol { text-align: left; padding-left: 0.8em; }
    td {
        padding: 0.45em 0.4em;
        border-bottom: 1px solid var(--eee);
        text-align: center;
        vertical-align: middle;
    }
    .teamCell {
        display: flex;
        align-items: center;
        gap: 0.5em;
        cursor: pointer;
        padding-left: 0.4em;
    }
    .teamCell img {
        width: 24px;
        height: 24px;
        border-radius: 50%;
        border: 1px solid var(--ccc);
    }
    .teamCell span {
        font-size: 0.8em;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 120px;
    }
    .pick {
        display: inline-block;
        font-size: 0.68em;
        border-radius: 10px;
        padding: 0.15em 0.55em;
        margin: 0.1em 0.12em;
        white-space: nowrap;
    }
    .own {
        background-color: var(--waiverAdd);
        color: var(--g000);
    }
    .acquired {
        background-color: var(--blueTwo);
        color: #fff;
    }
    .none {
        color: var(--QB);
        font-size: 0.8em;
        opacity: 0.8;
    }
    .disclaimer {
        text-align: center;
        font-size: 0.65em;
        color: var(--g999);
        margin: 0.6em auto 2em;
    }
    .loading {
        display: block;
        width: 85%;
        max-width: 500px;
        margin: 80px auto;
    }
    .error {
        text-align: center;
        color: var(--g555);
        margin: 3em 1em;
    }
</style>

<h2>Pick Tracker</h2>
<p class="subtitle">Who actually owns whose picks — every future rookie pick, every franchise, one grid. Consult before accusing anyone of mortgaging their future.</p>

{#await matrixPromise}
    <div class="loading">
        <p>Auditing the vault...</p>
        <br />
        <LinearProgress indeterminate />
    </div>
{:then m}
    {#if m.capital}
        <h3>Draft Capital Rankings</h3>
        <div class="board">
            {#each capitalRows(m) as row, ix}
                <div class="capRow" onclick={() => gotoManager({year: currentYear, leagueTeamManagers, rosterID: row.rosterID})}>
                    <span class="capRank">{ix + 1}</span>
                    <img class="capAvatar" src="{row.avatar}" alt="{row.name} avatar" />
                    <span class="capName">{row.name}</span>
                    <div class="capBarTrack">
                        <div class="capBar" style="width: {row.total / capitalRows(m)[0].total * 100}%"></div>
                    </div>
                    <span class="capVal">{row.total.toLocaleString()} · {row.count} picks</span>
                </div>
            {/each}
        </div>
    {/if}

    {#each m.seasons as season}
        <h3>{season} Rookie Draft</h3>
        <div class="board">
            <div class="gridWrap">
                <table>
                    <thead>
                        <tr>
                            <th class="teamCol">Team</th>
                            {#each Array(m.rounds) as _, r}
                                <th>Round {r + 1}</th>
                            {/each}
                        </tr>
                    </thead>
                    <tbody>
                        {#each franchises as f}
                            <tr>
                                <td>
                                    <div class="teamCell" onclick={() => gotoManager({year: currentYear, leagueTeamManagers, rosterID: f.rosterID})}>
                                        <img src="{f.avatar}" alt="{f.name} avatar" />
                                        <span>{f.name}</span>
                                    </div>
                                </td>
                                {#each Array(m.rounds) as _, r}
                                    <td>
                                        {#each m.holdings[f.rosterID][season][r + 1] as origin}
                                            {#if origin == f.rosterID}
                                                <span class="pick own">Own</span>
                                            {:else}
                                                <span class="pick acquired" title="originally {nameFor(origin)}'s pick">via {shortName(origin)}</span>
                                            {/if}
                                        {:else}
                                            <span class="none" title="{f.name} traded this pick away">—</span>
                                        {/each}
                                    </td>
                                {/each}
                            </tr>
                        {/each}
                    </tbody>
                </table>
            </div>
        </div>
    {/each}
    <p class="disclaimer">Pick values per FantasyCalc dynasty rankings (superflex, 0.5 PPR). Ownership straight from Sleeper — argue with the API, not the webmaster.</p>
{:catch error}
    <p class="error">Couldn't load pick data: {error.message}</p>
{/await}
