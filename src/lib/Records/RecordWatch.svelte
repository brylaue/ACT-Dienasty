<script>
    /*
      Record Watch: how the current season stacks up against all-time
      regular-season records. Sourced from static/data/record-watch.json
      (baked weekly by scripts/build-features.mjs). Hidden entirely until
      the current season has played weeks - it's about the chase, not a
      duplicate of the all-time lists further down the page.
    */
    // explicit runes mode - see ThisSeasonSoFar.svelte for why
    let data = $state(null);

    (async () => {
        try {
            const res = await fetch('/data/record-watch.json');
            data = res.ok ? await res.json() : null;
        } catch {
            data = null;
        }
    })();

    const categories = [
        { key: 'highs', chKey: 'high', title: '🔥 Single-Week Highs', value: (e) => `${e.pts.toFixed(1)} pts`, who: (e) => e.name, gapText: (c) => `${c.gap.toFixed(1)} pts shy of the all-time top 5` },
        { key: 'blowouts', chKey: 'blowout', title: '🔨 Biggest Beatdowns', value: (e) => `by ${e.margin.toFixed(1)}`, who: (e) => `${e.winnerName} over ${e.loserName}`, gapText: (c) => `${c.gap.toFixed(1)} pts short of the all-time top 5` },
        { key: 'closest', chKey: 'closest', title: '💔 Closest Finishes', value: (e) => `by ${e.margin.toFixed(1)}`, who: (e) => `${e.winnerName} over ${e.loserName}`, gapText: (c) => `${c.gap.toFixed(1)} pts wider than the all-time top 5` },
    ];
</script>

{#if data?.hasCurrentData}
    <div class="wrap">
        <h3>🚨 Record Watch — {data.currentYear}</h3>
        <p class="tag">This season vs the all-time books (regular season)</p>
        <div class="cols">
            {#each categories as cat}
                <div class="col">
                    <div class="colTitle">{cat.title}</div>
                    <ol>
                        {#each data[cat.key] as entry}
                            <li class:current={entry.current}>
                                <span class="who">{cat.who(entry)}</span>
                                <span class="meta">
                                    <span class="val">{cat.value(entry)}</span>
                                    <span class="yr" class:currentYr={entry.current}>{entry.current ? 'THIS SEASON' : `'${String(entry.year).slice(2)} wk ${entry.week}`}</span>
                                </span>
                            </li>
                        {/each}
                    </ol>
                    {#if data.challengers[cat.chKey]}
                        <div class="challenger">
                            Closest this season: <b>{cat.who(data.challengers[cat.chKey])}</b> ({cat.value(data.challengers[cat.chKey])}) — {cat.gapText(data.challengers[cat.chKey])}
                        </div>
                    {/if}
                </div>
            {/each}
        </div>
    </div>
{/if}

<style>
    .wrap {
        max-width: 1000px;
        margin: 0 auto 32px;
        padding: 0 16px;
    }
    h3 {
        text-align: center;
        color: var(--blueOne);
        font-size: 1.15em;
        margin-bottom: 2px;
    }
    .tag {
        text-align: center;
        color: var(--g999);
        font-size: 0.75em;
        margin-bottom: 14px;
    }
    .cols {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        justify-content: center;
    }
    .col {
        flex: 1 1 280px;
        max-width: 340px;
        background: var(--fff);
        border: 1px solid var(--ddd);
        border-top: 3px solid var(--QB);
        border-radius: 8px;
        padding: 12px 14px;
        box-shadow: 0 1px 3px rgba(0,0,0,0.04);
    }
    .colTitle {
        font-weight: 600;
        color: var(--blueOne);
        font-size: 0.9em;
        margin-bottom: 8px;
        text-align: center;
    }
    ol {
        margin: 0;
        padding-left: 1.4em;
    }
    li {
        font-size: 0.8em;
        padding: 3px 0;
        color: var(--g555);
    }
    li.current {
        background: rgba(255, 42, 109, 0.07);
        border-radius: 4px;
        padding-left: 4px;
        margin-left: -4px;
    }
    .who {
        display: block;
        color: var(--blueOne);
        font-weight: 500;
    }
    .meta {
        display: flex;
        justify-content: space-between;
        gap: 8px;
    }
    .val { font-weight: 600; }
    .yr { color: var(--g999); font-size: 0.9em; }
    .yr.currentYr {
        color: var(--QB);
        font-weight: 700;
        letter-spacing: 0.04em;
    }
    .challenger {
        margin-top: 10px;
        padding-top: 8px;
        border-top: 1px dashed var(--ddd);
        font-size: 0.72em;
        color: var(--g555);
        line-height: 1.4;
    }
</style>
