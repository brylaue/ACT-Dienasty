<script>
	import TrendChart from '$lib/TrendChart.svelte';
    import LinearProgress from '@smui/linear-progress';

    let data = null;
    let loading = true;
    let error = false;

    (async () => {
        try {
            const res = await fetch('/data/playoff-odds.json');
            data = res.ok ? await res.json() : null;
            if (!data) error = true;
        } catch {
            error = true;
        }
        loading = false;
    })();

    // week-over-week odds change, rounded to 1 decimal
    const delta = (team) => {
        if (team.prevPct == null) return null;
        return Math.round((team.playoffPct - team.prevPct) * 10) / 10;
    };

    const colorFor = (pct) => {
        if (pct >= 75) return '#00ceb8';
        if (pct >= 40) return '#0082c3';
        if (pct >= 15) return '#ffae58';
        return '#ff2a6d';
    };
</script>

<svelte:head>
    <title>Playoff Odds | League Page</title>
</svelte:head>

<div class="holder">
    <h2>🎲 Playoff Odds</h2>
    {#if data}
        <p class="subtitle">
            {data.simulations.toLocaleString()} simulated seasons, {data.remainingWeeks} week{data.remainingWeeks == 1 ? '' : 's'} remaining,
            top {data.playoffTeams} make the playoffs.
        </p>
    {/if}

    {#if loading}
        <div class="loading">
            <p>Running the simulations...</p>
            <LinearProgress indeterminate />
        </div>
    {:else if error || !data?.teams?.length}
        <p class="empty">Playoff odds haven't been baked yet — check back after the next weekly refresh.</p>
    {:else}
        <div class="list">
            {#each data.teams as team (team.rosterID)}
                <div class="row">
                    <div class="main">
                        <div class="nameRow">
                            <span class="name">{team.name}</span>
                            <span class="pctWrap">
                                {#if delta(team) !== null && delta(team) !== 0}
                                    <span class="delta" class:up={delta(team) > 0} class:down={delta(team) < 0}>
                                        {delta(team) > 0 ? '▲' : '▼'}{Math.abs(delta(team))}
                                    </span>
                                {/if}
                                <span class="pct" style="color: {colorFor(team.playoffPct)}">{team.playoffPct}%</span>
                            </span>
                        </div>
                        <div class="record">{team.wins}-{team.losses}{team.ties ? `-${team.ties}` : ''}</div>
                        <div class="barTrack">
                            <div class="bar" style="width: {team.playoffPct}%; background: {colorFor(team.playoffPct)}"></div>
                        </div>
                    </div>
                </div>
            {/each}
        </div>
        {#if data.teams.some((t) => t.topPickPct > 0)}
            <h3 class="raceTitle">🏁 Race for the #1 Pick</h3>
            <p class="raceSub">Draft order is reverse standings for the teams that miss — same {data.simulations.toLocaleString()} simulations, other end of the table.</p>
            <div class="list">
                {#each [...data.teams].filter((t) => t.topPickPct > 0).sort((a, b) => b.topPickPct - a.topPickPct).slice(0, 6) as team (team.rosterID)}
                    <div class="row">
                        <div class="nameRow">
                            <span class="name">{team.name}</span>
                            <span class="pctWrap">
                                <span class="pickPct">#1: {team.topPickPct}%</span>
                                <span class="pick3">top-3: {team.top3PickPct}%</span>
                            </span>
                        </div>
                        <div class="barTrack"><div class="bar" style="width: {team.topPickPct}%; background: var(--accent)"></div></div>
                    </div>
                {/each}
            </div>
        {/if}
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
        max-width: 460px;
        margin-left: auto;
        margin-right: auto;
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
        background: var(--fff);
        border: 1px solid var(--ddd);
        border-radius: 8px;
        padding: 14px 16px;
        box-shadow: 0 1px 3px rgba(0,0,0,0.04);
    }
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
    .pct {
        font-weight: 700;
        font-size: 1.15em;
        white-space: nowrap;
    }
    .pctWrap {
        display: flex;
        align-items: baseline;
        gap: 8px;
        white-space: nowrap;
    }
    .delta {
        font-size: 0.7em;
        font-weight: 700;
        padding: 1px 6px;
        border-radius: 10px;
    }
    .delta.up { color: #007a6c; background: rgba(0, 206, 184, 0.15); }
    .delta.down { color: #c21a50; background: rgba(255, 42, 109, 0.12); }
    .record {
        color: var(--g999);
        font-size: 0.8em;
        margin-top: 2px;
    }
    .barTrack {
        margin-top: 8px;
        height: 8px;
        border-radius: 4px;
        background: var(--eee);
        overflow: hidden;
    }
    .bar {
        height: 100%;
        border-radius: 4px;
        transition: width 0.6s ease;
    }
    .raceTitle {
        text-align: center;
        color: var(--ink);
        margin: 40px 0 4px;
        font-size: 1.2em;
    }
    .raceSub {
        text-align: center;
        color: var(--muted);
        font-size: 0.8em;
        max-width: 440px;
        margin: 0 auto 18px;
    }
    .pickPct { font-weight: 700; color: var(--accent); font-size: 0.95em; white-space: nowrap; }
    .pick3 { color: var(--muted); font-size: 0.75em; white-space: nowrap; }

    .generated {
        text-align: center;
        color: var(--g999);
        font-size: 0.7em;
        margin-top: 24px;
    }
</style>

<TrendChart metric="playoffPct" title="Playoff odds over time" subtitle="Each team's playoff probability from every bake's 3,000-season simulation." />
