<script>
    /*
      Standalone leaderboard for the current season, sourced from the same
      weekly bake that powers /power-rankings (static/data/power-rankings.json).
      Self-contained on purpose - doesn't touch the Records page's existing
      (and more complex) all-time record logic.
    */
    // explicit runes mode ($state/$derived): this component lives inside the
    // runes-mode Records parent, and leaving reactivity to legacy-mode
    // inference silently produced a non-reactive `data` (component mounted,
    // fetch succeeded, UI never updated)
    let data = $state(null);

    (async () => {
        try {
            const res = await fetch('/data/power-rankings.json');
            data = res.ok ? await res.json() : null;
        } catch {
            data = null;
        }
    })();

    const topScorer = $derived(data?.teams ? [...data.teams].sort((a, b) => b.fpts - a.fpts)[0] : null);
    const bestRecord = $derived(data?.teams ? [...data.teams].sort((a, b) => (b.wins - b.losses) - (a.wins - a.losses))[0] : null);
    const bestValue = $derived(data?.teams ? [...data.teams].sort((a, b) => b.rosterValue - a.rosterValue)[0] : null);
</script>

{#if data?.teams?.length}
    <div class="wrap">
        <h3>📅 This Season So Far</h3>
        <div class="cards">
            {#if topScorer}
                <div class="card">
                    <div class="label">Most Points For</div>
                    <div class="team">{topScorer.name}</div>
                    <div class="value">{topScorer.fpts.toFixed(1)} pts</div>
                </div>
            {/if}
            {#if bestRecord}
                <div class="card">
                    <div class="label">Best Record</div>
                    <div class="team">{bestRecord.name}</div>
                    <div class="value">{bestRecord.wins}-{bestRecord.losses}{bestRecord.ties ? `-${bestRecord.ties}` : ''}</div>
                </div>
            {/if}
            {#if bestValue}
                <div class="card">
                    <div class="label">Strongest Roster</div>
                    <div class="team">{bestValue.name}</div>
                    <div class="value">{Math.round(bestValue.rosterValue).toLocaleString()} value</div>
                </div>
            {/if}
        </div>
        <p class="link"><a href="/power-rankings">See full Power Rankings →</a></p>
    </div>
{/if}

<style>
    .wrap {
        max-width: 900px;
        margin: 0 auto 28px;
        padding: 0 16px;
    }
    h3 {
        text-align: center;
        color: var(--blueOne);
        font-size: 1.1em;
        margin-bottom: 12px;
    }
    .cards {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        justify-content: center;
    }
    .card {
        flex: 1 1 180px;
        max-width: 240px;
        background: var(--fff);
        border: 1px solid var(--ddd);
        border-top: 3px solid var(--blueTwo);
        border-radius: 8px;
        padding: 12px 14px;
        text-align: center;
        box-shadow: 0 1px 3px rgba(0,0,0,0.04);
    }
    .label {
        font-size: 0.7em;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--g999);
        margin-bottom: 4px;
    }
    .team {
        font-weight: 600;
        color: var(--blueOne);
        font-size: 0.95em;
    }
    .value {
        color: var(--g555);
        font-size: 0.85em;
        margin-top: 2px;
    }
    .link {
        text-align: center;
        margin-top: 10px;
        font-size: 0.8em;
    }
    .link a {
        color: var(--blueOne);
        text-decoration: none;
    }
    .link a:hover { text-decoration: underline; }
</style>
