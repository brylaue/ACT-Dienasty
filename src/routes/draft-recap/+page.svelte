<script>
    // The annual draft roast. Content comes from the baked
    // draft-recap.json (current season only - history lives in the
    // constitution's Appendix A). Future seasons regenerate via
    // scripts/build-draft-recap.mjs in the weekly workflow.
    import { onMount } from 'svelte';

    let recap = $state(null);
    let failed = $state(false);

    const roundLabel = (key) => key === '1c' ? 'The Compensatory Pick 🚽' : `Round ${key}`;

    onMount(async () => {
        try {
            const res = await fetch('/data/draft-recap.json');
            if (!res.ok) { failed = true; return; }
            recap = await res.json();
        } catch { failed = true; }
    });
</script>

<svelte:head>
    <title>Draft Recap | League Page</title>
</svelte:head>

<style>
    .holder { position: relative; z-index: 1; max-width: 860px; margin: 0 auto; padding: 0 16px 70px; }
    h2 { text-align: center; margin: 26px 0 6px; }
    .intro { font-size: 0.95em; line-height: 1.6; color: var(--g555, #444); max-width: 720px; margin: 0 auto 24px; text-align: center; font-style: italic; }
    .roundHead { margin: 30px 0 10px; font-size: 1.15em; border-bottom: 2px solid var(--accent, #2563eb); padding-bottom: 4px; }
    .pickCard { display: grid; grid-template-columns: 64px 1fr; gap: 12px; padding: 12px 14px; border: 1px solid var(--line, #e5e7eb); border-radius: 12px; margin: 10px 0; }
    .pickNo { font-weight: 800; font-size: 1.05em; color: var(--accent, #2563eb); align-self: start; }
    .pickWho { font-weight: 700; }
    .pickMeta { font-size: 0.8em; color: var(--g555, #666); margin-left: 6px; font-weight: 500; }
    .pickTeam { font-size: 0.82em; color: var(--g555, #666); margin: 1px 0 6px; }
    .blurb { font-size: 0.92em; line-height: 1.55; }
    .awards { margin-top: 40px; border: 1px solid var(--accent, #2563eb); border-radius: 14px; padding: 16px 18px; }
    .awards h3 { margin: 0 0 10px; }
    .awardRow { margin: 10px 0; font-size: 0.92em; line-height: 1.5; }
    .awardName { font-weight: 700; }
    .awardWinner { color: var(--accent, #2563eb); font-weight: 600; }
    .loading, .err { text-align: center; margin: 60px 0; color: var(--g555, #666); }
    .titleIcon { width: 46px; height: 46px; vertical-align: -7px; margin-right: 4px; }
    .hwIcon { width: 24px; height: 24px; vertical-align: -5px; margin-right: 2px; }
</style>

<div class="holder">
    {#if recap}
        <h2><img class="titleIcon" src="/roast-mic.svg" alt="" /> {recap.title}</h2>
        <p class="intro">{recap.intro}</p>

        {#each Object.entries(recap.rounds) as [rd, picks] (rd)}
            <div class="roundHead">{roundLabel(rd)}</div>
            {#each picks as p (p.pick)}
                <div class="pickCard">
                    <div class="pickNo">{p.pick}</div>
                    <div>
                        <div class="pickWho">{p.player}<span class="pickMeta">{p.pos}</span></div>
                        <div class="pickTeam">{p.team} — {p.manager}</div>
                        <div class="blurb">{p.blurb}</div>
                    </div>
                </div>
            {/each}
        {/each}

        {#if recap.awards?.length}
            <div class="awards">
                <h3><img class="hwIcon" src="/awards/record-1.svg" alt="" /> The Hardware</h3>
                {#each recap.awards as a (a.award)}
                    <div class="awardRow">
                        <span class="awardName">{a.award}:</span>
                        <span class="awardWinner">{a.winner}</span> — {a.why}
                    </div>
                {/each}
            </div>
        {/if}
    {:else if failed}
        <p class="err">No draft recap yet — check back after the next rookie draft.</p>
    {:else}
        <p class="loading">Warming up the roast...</p>
    {/if}
</div>
