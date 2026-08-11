<script>
    import LinearProgress from '@smui/linear-progress';

    let data = null;
    let loading = true;
    let currentWeek = null;

    (async () => {
        try {
            const res = await fetch('/data/commentary.json');
            const commentary = res.ok ? await res.json() : null;
            const predictions = commentary?.predictions || {};
            const keys = Object.keys(predictions);
            if (keys.length) {
                // most recent (highest) year-week
                keys.sort((a, b) => {
                    const [ay, aw] = a.split('-').map(Number);
                    const [by, bw] = b.split('-').map(Number);
                    return by - ay || bw - aw;
                });
                currentWeek = keys[0];
                data = predictions[currentWeek];
            }
        } catch {
            data = null;
        }
        loading = false;
    })();
</script>

<svelte:head>
    <title>Matchup Predictions | League Page</title>
</svelte:head>

<div class="holder">
    <h2>🔮 Matchup Predictions</h2>
    {#if currentWeek}
        <p class="subtitle">Week {currentWeek.split('-')[1]}, {currentWeek.split('-')[0]}</p>
    {/if}

    {#if loading}
        <div class="loading">
            <p>Reading the tea leaves...</p>
            <LinearProgress indeterminate />
        </div>
    {:else if !data?.length}
        <p class="empty">No predictions baked yet for the upcoming week — check back closer to kickoff.</p>
    {:else}
        <div class="list">
            {#each data as m}
                <div class="card">
                    <div class="teams">
                        <div class="team">
                            <span class="tname">{m.teamA}</span>
                            <span class="trecord">{m.recordA}</span>
                        </div>
                        <div class="vs">vs</div>
                        <div class="team right">
                            <span class="tname">{m.teamB}</span>
                            <span class="trecord">{m.recordB}</span>
                        </div>
                    </div>
                    {#if m.h2h}
                        <div class="h2h">
                            All-time series:
                            {#if m.h2h.aWins > m.h2h.bWins}
                                <b>{m.teamA}</b> leads {m.h2h.aWins}–{m.h2h.bWins}{m.h2h.ties ? `–${m.h2h.ties}` : ''}
                            {:else if m.h2h.bWins > m.h2h.aWins}
                                <b>{m.teamB}</b> leads {m.h2h.bWins}–{m.h2h.aWins}{m.h2h.ties ? `–${m.h2h.ties}` : ''}
                            {:else}
                                tied {m.h2h.aWins}–{m.h2h.bWins}{m.h2h.ties ? `–${m.h2h.ties}` : ''}
                            {/if}
                        </div>
                    {/if}
                    {#if m.blurb}
                        <div class="blurb">{m.blurb}</div>
                    {/if}
                </div>
            {/each}
        </div>
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
        gap: 12px;
    }
    .card {
        background: var(--fff);
        border: 1px solid var(--ddd);
        border-radius: 8px;
        padding: 16px;
        box-shadow: 0 1px 3px rgba(0,0,0,0.04);
    }
    .teams {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
    }
    .team {
        display: flex;
        flex-direction: column;
        flex: 1;
        min-width: 0;
    }
    .team.right { text-align: right; }
    .tname {
        font-weight: 600;
        color: var(--blueOne);
        font-size: 0.95em;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .trecord {
        color: var(--g999);
        font-size: 0.75em;
    }
    .vs {
        color: var(--g555);
        font-size: 0.75em;
        font-style: italic;
        flex-shrink: 0;
        padding: 0 4px;
    }
    .h2h {
        margin-top: 10px;
        font-size: 0.75em;
        color: var(--g999);
        text-align: center;
    }
    .h2h b { color: var(--blueTwo); font-weight: 600; }
    .blurb {
        margin-top: 10px;
        padding-top: 10px;
        border-top: 1px dashed var(--ddd);
        font-style: italic;
        color: var(--g555);
        font-size: 0.85em;
        text-align: center;
    }
</style>
