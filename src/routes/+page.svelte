<script>
	import LinearProgress from '@smui/linear-progress';
	import { getNflState, leagueName, getAwards, getLeagueTeamManagers, homepageText, managers, gotoManager, enableBlog, waitForAll } from '$lib/utils/helper';
	import { Transactions, PowerRankings, HomePost} from '$lib/components';
	import { getAvatarFromTeamManagers, getTeamFromTeamManagers } from '$lib/utils/helperFunctions/universalFunctions';

    const nflState = getNflState();
    const podiumsData = getAwards();
    const leagueTeamManagersData = getLeagueTeamManagers();

    // league pulse cards, fed by the weekly-baked static data (explicit
    // runes state - this repo's mixed-mode inference bit us before)
    let pr = $state(null);
    let odds = $state(null);
    let recordWatch = $state(null);

    (async () => {
        try {
            const [a, b, c] = await Promise.all([
                fetch('/data/power-rankings.json').then((r) => r.ok ? r.json() : null).catch(() => null),
                fetch('/data/playoff-odds.json').then((r) => r.ok ? r.json() : null).catch(() => null),
                fetch('/data/record-watch.json').then((r) => r.ok ? r.json() : null).catch(() => null),
            ]);
            pr = a; odds = b; recordWatch = c;
        } catch { /* cards simply don't render */ }
    })();

    const prTop = $derived(pr?.teams?.slice(0, 3) || []);
    const oddsTop = $derived(odds?.teams?.slice(0, 3) || []);
    const recordToBeat = $derived(recordWatch?.highs?.[0] || null);

    const medal = (rank) => rank === 1 ? '🥇' : rank === 2 ? '🥈' : '🥉';
    const oddsColor = (pct) => pct >= 75 ? '#00ceb8' : pct >= 40 ? '#58a7ff' : pct >= 15 ? '#ffae58' : '#ff2a6d';
</script>

<svelte:head>
    <title>Home | League Page</title>
</svelte:head>

<div id="home">

    <!-- ── HERO: the defending champion holds the belt ─────────── -->
    <section class="hero">
        <div class="heroInner">
            <div class="champSide">
                {#await waitForAll(podiumsData, leagueTeamManagersData)}
                    <div class="heroLoading">
                        <LinearProgress indeterminate />
                    </div>
                {:then [podiums, leagueTeamManagers]}
                    {#if podiums[0]}
                        <span class="heroEyebrow">Defending Champion</span>
                        <div class="champRing" role="button" tabindex="0"
                            onclick={() => {if(managers.length) gotoManager({year: podiums[0].year, leagueTeamManagers, rosterID: parseInt(podiums[0].champion)})}}
                            onkeydown={(e) => {if(e.key === 'Enter' && managers.length) gotoManager({year: podiums[0].year, leagueTeamManagers, rosterID: parseInt(podiums[0].champion)})}}>
                            <img src={getAvatarFromTeamManagers(leagueTeamManagers, podiums[0].champion, podiums[0].year)} class="champAvatar" alt="reigning champion" />
                            <img src="/laurel.png" class="champLaurel" alt="" />
                        </div>
                        <div class="champName">{getTeamFromTeamManagers(leagueTeamManagers, podiums[0].champion, podiums[0].year).name}</div>
                        <div class="champSub">{podiums[0].year} League Champion &middot; the belt is on the line</div>
                    {:else}
                        <span class="heroEyebrow">Season One</span>
                        <div class="champName">The throne sits empty.</div>
                    {/if}
                {:catch error}
                    <p class="heroErr">Something went wrong: {error.message}</p>
                {/await}
            </div>

            <div class="ctaSide">
                {#await nflState then nflStateData}
                    <div class="seasonChip">
                        NFL {nflStateData.season}
                        {#if nflStateData.season_type == 'pre'}&middot; Preseason
                        {:else if nflStateData.season_type == 'post'}&middot; Postseason
                        {:else}&middot; {nflStateData.week > 0 ? `Week ${nflStateData.week}` : "Preseason"}{/if}
                    </div>
                {/await}
                <a class="ticket" href="/power-rankings"><span class="tLabel">Power Rankings</span><span class="tArrow">&rarr;</span></a>
                <a class="ticket" href="/playoff-odds"><span class="tLabel">Playoff Odds</span><span class="tArrow">&rarr;</span></a>
                <a class="ticket" href="/matchups"><span class="tLabel">This Week's Matchups</span><span class="tArrow">&rarr;</span></a>
            </div>
        </div>
    </section>

    <!-- ── LEAGUE PULSE: the numbers that matter right now ─────── -->
    {#if prTop.length || oddsTop.length || recordToBeat}
        <section class="pulse">
            <div class="pulseGrid">
                {#if prTop.length}
                    <a class="pulseCard" href="/power-rankings">
                        <div class="cardKicker">Power Pulse</div>
                        {#each prTop as t (t.rosterID)}
                            <div class="pulseRow">
                                <span class="pMedal">{medal(t.rank)}</span>
                                <span class="pName">{t.name}</span>
                                {#if t.prevRank != null && t.prevRank !== t.rank}
                                    <span class="pMove" class:up={t.prevRank > t.rank} class:down={t.prevRank < t.rank}>
                                        {t.prevRank > t.rank ? '▲' : '▼'}{Math.abs(t.prevRank - t.rank)}
                                    </span>
                                {/if}
                            </div>
                        {/each}
                        <div class="cardMore">Full rankings &rarr;</div>
                    </a>
                {/if}

                {#if oddsTop.length}
                    <a class="pulseCard" href="/playoff-odds">
                        <div class="cardKicker">Playoff Picture</div>
                        {#each oddsTop as t (t.rosterID)}
                            <div class="pulseRow oddsRow">
                                <span class="pName">{t.name}</span>
                                <span class="pPct" style="color: {oddsColor(t.playoffPct)}">{t.playoffPct}%</span>
                            </div>
                            <div class="oddsTrack"><div class="oddsBar" style="width: {t.playoffPct}%; background: {oddsColor(t.playoffPct)}"></div></div>
                        {/each}
                        <div class="cardMore">All 12 teams &rarr;</div>
                    </a>
                {/if}

                {#if recordToBeat}
                    <a class="pulseCard recordCard" href="/records">
                        <div class="cardKicker">The Record to Beat</div>
                        <div class="bigNumber">{recordToBeat.pts.toFixed(1)}</div>
                        <div class="recordWho">{recordToBeat.name}</div>
                        <div class="recordWhen">{recordToBeat.year} &middot; Week {recordToBeat.week} &middot; all-time single-week high</div>
                        <div class="cardMore">Record book &rarr;</div>
                    </a>
                {/if}
            </div>
        </section>
    {/if}

    <!-- ── ABOUT + LATEST POST ──────────────────────────────────── -->
    <section class="about">
        <div class="aboutInner">
            <div class="aboutText">
                <span class="sectionKicker">The League</span>
                <h2 class="sectionTitle">{leagueName}</h2>
                {@html homepageText }
            </div>
            {#if enableBlog}
                <div class="aboutPost">
                    <HomePost />
                </div>
            {/if}
        </div>
    </section>

    <!-- ── POWER GRAPH + LATEST MOVES (existing widgets) ────────── -->
    <section class="widgets">
        <PowerRankings />
        <div class="transactions">
            <Transactions />
        </div>
    </section>
</div>

<style>
    #home {
        position: relative;
        z-index: 1;
    }

    /* ── hero ── */
    .hero {
        background: var(--fff);
        border-bottom: 1px solid var(--line);
        color: var(--ink);
        padding: 46px 20px 42px;
    }

    .heroInner {
        max-width: 980px;
        margin: 0 auto;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 40px;
        flex-wrap: wrap;
    }

    .champSide { text-align: center; flex: 1 1 340px; }
    .heroLoading { max-width: 300px; margin: 40px auto; }
    .heroErr { color: var(--cream); opacity: 0.8; }

    .heroEyebrow {
        display: block;
        font-weight: 700;
        font-size: 0.7em;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: var(--accent);
        margin-bottom: 18px;
    }

    .champRing {
        position: relative;
        width: 168px;
        height: 168px;
        margin: 0 auto;
        cursor: pointer;
        filter: drop-shadow(0 8px 20px rgba(16, 24, 40, 0.15));
    }

    .champAvatar {
        position: absolute;
        transform: translate(-50%, -50%);
        width: 92px;
        height: 92px;
        border-radius: 100%;
        border: 2px solid var(--fff);
        box-shadow: 0 0 0 1px var(--line);
        left: 50%;
        top: 43%;
    }

    .champLaurel {
        position: absolute;
        transform: translate(-50%, -50%);
        width: 152px;
        height: auto;
        left: 50%;
        top: 50%;
    }

    .champName {
        font-weight: 800;
        font-size: 1.9em;
        letter-spacing: -0.02em;
        margin-top: 16px;
        color: var(--ink);
    }

    .champSub {
        margin-top: 6px;
        font-size: 0.85em;
        color: var(--muted);
    }

    .ctaSide {
        flex: 0 1 300px;
        display: flex;
        flex-direction: column;
        gap: 12px;
        margin: 0 auto;
    }

    .seasonChip {
        align-self: flex-start;
        font-weight: 600;
        font-size: 0.75em;
        letter-spacing: 0.04em;
        color: var(--muted);
        background: var(--pageBg);
        border: 1px solid var(--line);
        border-radius: 999px;
        padding: 5px 14px;
        margin-bottom: 4px;
    }

    .ticket {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 16px;
        text-decoration: none;
        color: var(--ink);
        border: 1px solid var(--line);
        border-radius: 10px;
        padding: 13px 16px;
        font-weight: 600;
        font-size: 0.92em;
        background: var(--fff);
        box-shadow: 0 1px 2px rgba(16, 24, 40, 0.05);
        transition: border-color 0.15s ease, box-shadow 0.15s ease, transform 0.15s ease;
    }

    .ticket:hover {
        border-color: var(--accent);
        box-shadow: 0 4px 12px rgba(16, 24, 40, 0.08);
        transform: translateY(-1px);
    }

    .ticket:first-of-type {
        background: var(--accent);
        border-color: var(--accent);
        color: #fff;
    }

    .ticket:first-of-type .tArrow { color: #fff; }

    .ticket:first-of-type:hover {
        filter: brightness(1.06);
    }

    .tArrow { color: var(--accent); }

    /* ── pulse cards ── */
    .pulse { padding: 34px 20px 6px; }

    .pulseGrid {
        max-width: 980px;
        margin: 0 auto;
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
        gap: 16px;
    }

    .pulseCard {
        display: block;
        text-decoration: none;
        color: var(--ink);
        background: var(--fff);
        border: 1px solid var(--line);
        border-radius: 12px;
        padding: 18px 18px 14px;
        box-shadow: 0 1px 2px rgba(16, 24, 40, 0.05);
        transition: border-color 0.15s ease, box-shadow 0.15s ease, transform 0.15s ease;
    }

    .pulseCard:hover {
        transform: translateY(-2px);
        border-color: var(--accent);
        box-shadow: 0 6px 16px rgba(16, 24, 40, 0.09);
    }

    .cardKicker {
        font-weight: 600;
        font-size: 0.7em;
        letter-spacing: 0.07em;
        text-transform: uppercase;
        color: var(--muted);
        margin-bottom: 12px;
    }

    .pulseRow {
        display: flex;
        align-items: baseline;
        gap: 8px;
        padding: 4px 0;
        font-size: 0.95em;
    }

    .pMedal { flex-shrink: 0; }
    .pName {
        font-weight: 600;
        color: var(--ink);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        flex: 1;
    }

    .pMove {
        font-size: 0.72em;
        font-weight: 700;
        padding: 1px 6px;
        border-radius: 10px;
    }
    .pMove.up { color: #007a6c; background: rgba(0, 206, 184, 0.15); }
    .pMove.down { color: #c21a50; background: rgba(255, 42, 109, 0.12); }

    .oddsRow { padding-bottom: 2px; }
    .pPct { font-weight: 700; font-size: 0.9em; }
    .oddsTrack {
        height: 5px;
        border-radius: 3px;
        background: var(--eee);
        overflow: hidden;
        margin-bottom: 6px;
    }
    .oddsBar { height: 100%; border-radius: 3px; }

    .recordCard { text-align: center; }
    .bigNumber {
        font-weight: 800;
        font-size: 2.8em;
        letter-spacing: -0.03em;
        color: var(--ink);
        line-height: 1;
        margin: 6px 0 4px;
    }
    .recordWho { font-weight: 700; color: var(--ink); }
    .recordWhen { font-size: 0.72em; color: var(--g999); margin-top: 3px; letter-spacing: 0.04em; }

    .cardMore {
        margin-top: 12px;
        padding-top: 10px;
        border-top: 1px solid var(--line);
        font-size: 0.8em;
        font-weight: 600;
        color: var(--accent);
    }

    /* ── about ── */
    .about { padding: 30px 20px 0; }
    .aboutInner {
        max-width: 980px;
        margin: 0 auto;
        display: flex;
        gap: 40px;
        flex-wrap: wrap;
        align-items: flex-start;
    }
    .aboutText { flex: 1 1 420px; max-width: 620px; }
    .aboutPost { flex: 1 1 300px; min-width: 280px; }

    .sectionKicker {
        display: block;
        font-weight: 700;
        font-size: 0.7em;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: var(--accent);
    }

    .sectionTitle {
        font-size: 1.5em;
        color: var(--ink);
        margin: 4px 0 10px;
    }

    .aboutText :global(p) {
        line-height: 1.65;
        color: var(--ink);
    }

    /* ── existing widgets ── */
    .widgets { padding-top: 10px; }
    .transactions {
        display: block;
        width: 95%;
        max-width: 980px;
        margin: 10px auto;
    }

    :global(.curOwner) {
        font-size: 0.75em;
        color: #bbb;
        font-style: italic;
    }

    @media (max-width: 700px) {
        .hero { padding: 34px 16px 30px; }
        .heroInner { gap: 26px; }
        .ctaSide { flex: 1 1 100%; }
        .seasonChip { align-self: center; }
    }
</style>
