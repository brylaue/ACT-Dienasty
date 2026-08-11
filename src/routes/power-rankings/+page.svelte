<script>
    import LinearProgress from '@smui/linear-progress';

    let data = null;
    let loading = true;
    let error = false;

    (async () => {
        try {
            const res = await fetch('/data/power-rankings.json');
            data = res.ok ? await res.json() : null;
            if (!data) error = true;
        } catch {
            error = true;
        }
        loading = false;
    })();

    const medalFor = (rank) => rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : null;
</script>

<svelte:head>
    <title>Power Rankings | League Page</title>
</svelte:head>

<div class="holder">
    <h2>📊 Power Rankings</h2>
    <p class="subtitle">Record, points scored, and dynasty roster value, blended into one weekly ranking.</p>

    {#if loading}
        <div class="loading">
            <p>Crunching the numbers...</p>
            <LinearProgress indeterminate />
        </div>
    {:else if error || !data?.teams?.length}
        <p class="empty">Power rankings haven't been baked yet — check back after the next weekly refresh.</p>
    {:else}
        <div class="list">
            {#each data.teams as team (team.rosterID)}
                <div class="row" class:top3={team.rank <= 3}>
                    <div class="rank">
                        {#if medalFor(team.rank)}
                            <span class="medal">{medalFor(team.rank)}</span>
                        {:else}
                            <span class="rankNum">{team.rank}</span>
                        {/if}
                    </div>
                    <div class="main">
                        <div class="nameRow">
                            <span class="name">{team.name}</span>
                            <span class="record">{team.wins}-{team.losses}{team.ties ? `-${team.ties}` : ''}</span>
                        </div>
                        {#if team.blurb}
                            <div class="blurb">{team.blurb}</div>
                        {/if}
                        <div class="barTrack">
                            <div class="bar" style="width: {Math.round(team.composite * 100)}%"></div>
                        </div>
                        <div class="stats">
                            <span>{team.fpts.toFixed(1)} pts for</span>
                            <span>•</span>
                            <span>roster value {Math.round(team.rosterValue).toLocaleString()}</span>
                        </div>
                    </div>
                </div>
            {/each}
        </div>
        <p class="generated">Last updated {new Date(data.generated).toLocaleString()}</p>
    {/if}
</div>

<style>
    .holder {
        max-width: 720px;
        margin: 0 auto;
        padding: 24px 16px 80px;
    }
    h2 {
        text-align: center;
        color: var(--blueOne);
        margin-bottom: 4px;
        font-size: 1.6em;
    }
    .subtitle {
        text-align: center;
        color: var(--g555);
        font-size: 0.85em;
        margin-bottom: 28px;
    }
    .loading, .empty {
        text-align: center;
        color: var(--g555);
        margin: 60px auto;
        max-width: 400px;
    }
    .list {
        display: flex;
        flex-direction: column;
        gap: 10px;
    }
    .row {
        display: flex;
        gap: 14px;
        align-items: flex-start;
        background: var(--fff);
        border: 1px solid var(--ddd);
        border-left: 3px solid var(--blueTwo);
        border-radius: 8px;
        padding: 14px 16px;
        box-shadow: 0 1px 3px rgba(0,0,0,0.04);
    }
    .row.top3 {
        border-left-color: #e0a412;
        background: linear-gradient(90deg, #fffdf5, var(--fff) 30%);
    }
    .rank {
        flex-shrink: 0;
        width: 34px;
        text-align: center;
        padding-top: 2px;
    }
    .medal { font-size: 1.4em; }
    .rankNum {
        display: inline-block;
        font-weight: 700;
        color: var(--g999);
        font-size: 1.1em;
    }
    .main { flex: 1; min-width: 0; }
    .nameRow {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        gap: 8px;
    }
    .name {
        font-weight: 600;
        color: var(--blueOne);
        font-size: 1.05em;
    }
    .record {
        color: var(--g555);
        font-size: 0.85em;
        white-space: nowrap;
    }
    .blurb {
        font-style: italic;
        color: var(--g555);
        font-size: 0.85em;
        margin-top: 4px;
    }
    .barTrack {
        margin-top: 8px;
        height: 6px;
        border-radius: 3px;
        background: var(--eee);
        overflow: hidden;
    }
    .bar {
        height: 100%;
        background: linear-gradient(90deg, var(--blueTwo), var(--blueOne));
        border-radius: 3px;
        transition: width 0.6s ease;
    }
    .stats {
        margin-top: 6px;
        display: flex;
        gap: 6px;
        font-size: 0.75em;
        color: var(--g999);
    }
    .generated {
        text-align: center;
        color: var(--g999);
        font-size: 0.7em;
        margin-top: 24px;
    }
</style>
