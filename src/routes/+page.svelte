<script>
    import RefreshButton from '$lib/RefreshButton.svelte';
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
    const weekHistory = $derived(recordWatch?.weekHistory || null);

    // gameday scoreboard: current week's scores, in-season only. Team
    // names come from the already-fetched power-rankings bake, so this
    // costs one extra request and only during the regular season.
    let scoreboard = $state(null);
    (async () => {
        try {
            const st = await nflState;
            if (st?.season_type !== 'regular' || !(st.week > 0)) return;
            const leagueID = (await import('$lib/utils/leagueInfo')).leagueID;
            const res = await fetch(`https://api.sleeper.app/v1/league/${leagueID}/matchups/${st.week}`);
            if (!res.ok) return;
            const matchups = await res.json();
            const pairs = {};
            for (const m of matchups || []) {
                if (m.matchup_id == null) continue;
                (pairs[m.matchup_id] ||= []).push({ rosterID: m.roster_id, pts: m.points || 0 });
            }
            const games = Object.values(pairs).filter((g) => g.length === 2);
            // before kickoff every score is 0.0 - that's a schedule, not a
            // scoreboard. Show the matchups as a preview until points exist.
            const started = games.some((g) => g[0].pts + g[1].pts > 0);
            let kickoff = '';
            if (!started && st.week === 1 && st.season_start_date) {
                const d = new Date(st.season_start_date + 'T12:00:00Z');
                while (d.getUTCDay() !== 4) d.setUTCDate(d.getUTCDate() + 1); // first Thursday night
                kickoff = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
            }
            if (games.length) scoreboard = { week: st.week, games, started, kickoff };
        } catch { /* scoreboard simply doesn't render */ }
    })();

    const nameFor = (rosterID) => pr?.teams?.find((t) => t.rosterID === rosterID)?.name || `Team ${rosterID}`;
    let ltm = $state(null);
    leagueTeamManagersData.then((v) => { ltm = v; }).catch(() => {});
    const avatarFor = (rosterID) => {
        if (!ltm) return null;
        try { return getAvatarFromTeamManagers(ltm, rosterID, ltm.currentSeason); } catch { return null; }
    };
    const rankFor = (rosterID) => pr?.teams?.find((t) => t.rosterID === rosterID)?.rank || null;
    const oddsTop = $derived(odds?.teams?.slice(0, 3) || []);
    const recordToBeat = $derived(recordWatch?.highs?.[0] || null);

    const medal = (rank) => '/awards/record-' + Math.min(rank, 3) + '.svg';
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
                            <img src="/awards/champion.svg" class="champBadge" alt="" />
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
                <div class="refreshRow"><RefreshButton /></div>
            </div>
        </div>
    </section>

    <!-- ── LEAGUE PULSE: the numbers that matter right now ─────── -->
    {#if scoreboard}
        <section class="matchupsWrap">
            <div class="matchupsHead">
                <span class="mhTitle">Week {scoreboard.week} matchups</span>
                {#if !scoreboard.started && scoreboard.kickoff}<span class="mhSub">Kickoff {scoreboard.kickoff}</span>
                {:else if scoreboard.started}<span class="mhSub live">Live scores</span>{/if}
                <a class="mhAll" href="/matchups">All matchups &rarr;</a>
            </div>
            <div class="matchups">
                {#each scoreboard.games as g}
                    {@const a = g[0]}
                    {@const b = g[1]}
                    {@const aLead = scoreboard.started && a.pts > b.pts}
                    {@const bLead = scoreboard.started && b.pts > a.pts}
                    <a class="mCard" href="/matchups">
                        {#each [a, b] as t, i}
                            <div class="mRow" class:lead={scoreboard.started && t.pts > (i === 0 ? b.pts : a.pts)} class:trail={scoreboard.started && t.pts < (i === 0 ? b.pts : a.pts)}>
                                {#if avatarFor(t.rosterID)}<img class="mAvatar" src={avatarFor(t.rosterID)} alt="" />{:else}<span class="mAvatar"></span>{/if}
                                <span class="mName">{nameFor(t.rosterID).trim()}</span>
                                {#if scoreboard.started}<span class="mScore">{t.pts.toFixed(1)}</span>
                                {:else if rankFor(t.rosterID)}<span class="mRank">#{rankFor(t.rosterID)}</span>{/if}
                            </div>
                        {/each}
                    </a>
                {/each}
            </div>
        </section>
    {/if}

    {#if prTop.length || oddsTop.length || recordToBeat}
        <section class="pulse">
            <div class="pulseGrid">
                {#if prTop.length}
                    <a class="pulseCard" href="/power-rankings">
                        <div class="cardKicker">Power Pulse</div>
                        {#each prTop as t (t.rosterID)}
                            <div class="pulseRow">
                                <img class="pMedal" src={medal(t.rank)} alt="rank {t.rank}" />
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

                {#if weekHistory}
                    <a class="pulseCard" href="/records">
                        <div class="cardKicker">This Week in League History</div>
                        <div class="histPts">{weekHistory.pts.toFixed(1)}</div>
                        <div class="histWho">{weekHistory.name}</div>
                        <div class="histWhen">best Week {weekHistory.week} ever &middot; {weekHistory.year}</div>
                        <div class="cardMore">Record book &rarr;</div>
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
        width: 148px;
        height: 148px;
        margin: 0 auto;
        cursor: pointer;
        border-radius: 50%;
        padding: 5px;
        background: conic-gradient(from 210deg, #f3dc8a, #c9a227 30%, #9a7a1e 55%, #f3dc8a 80%, #c9a227);
        box-shadow: 0 10px 24px rgba(16, 24, 40, 0.16);
    }

    .champAvatar {
        width: 100%;
        height: 100%;
        border-radius: 50%;
        border: 4px solid var(--fff);
        display: block;
        object-fit: cover;
        background: var(--fff);
    }

    .champBadge {
        position: absolute;
        right: -2px;
        bottom: -2px;
        width: 44px;
        height: 44px;
        padding: 6px;
        border-radius: 50%;
        background: var(--fff);
        box-shadow: 0 3px 8px rgba(16, 24, 40, 0.18);
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

    .pMedal {
        width: 22px;
        height: 22px;
        vertical-align: -4px; flex-shrink: 0; }
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

    .histPts {
        font-weight: 800;
        font-size: 2em;
        letter-spacing: -0.02em;
        color: var(--ink);
        text-align: center;
        margin: 4px 0 2px;
    }
    .histWho { text-align: center; font-weight: 700; }
    .histWhen { text-align: center; font-size: 0.72em; color: var(--muted); margin-top: 3px; }

    .refreshRow { margin-top: 14px; }

    /* ── this week's matchups ── */
    .matchupsWrap { padding: 18px 20px 0; max-width: 1020px; margin: 0 auto; }
    .matchupsHead {
        display: flex;
        align-items: baseline;
        gap: 12px;
        margin: 0 0 10px 2px;
    }
    .mhTitle { font-weight: 700; font-size: 0.95em; color: var(--ink); }
    .mhSub { font-size: 0.82em; color: var(--muted); }
    .mhSub.live { color: #16a34a; font-weight: 600; }
    .mhAll { margin-left: auto; font-size: 0.82em; color: var(--accent); text-decoration: none; }
    .matchups {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 10px;
    }
    .mCard {
        display: flex;
        flex-direction: column;
        background: var(--fff);
        border: 1px solid var(--line);
        border-radius: 12px;
        padding: 6px 12px;
        text-decoration: none;
        color: var(--ink);
        transition: border-color 0.15s;
    }
    .mCard:hover { border-color: var(--accent); }
    .mRow { display: flex; align-items: center; gap: 10px; padding: 7px 0; min-width: 0; }
    .mRow + .mRow { border-top: 1px solid var(--line); }
    .mAvatar { width: 30px; height: 30px; border-radius: 50%; flex-shrink: 0; background: var(--fff); border: 1px solid var(--line); object-fit: cover; display: inline-block; }
    .mName { flex: 1; font-size: 0.9em; font-weight: 600; line-height: 1.25; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
    .mRank {
        flex-shrink: 0;
        font-size: 0.74em;
        font-weight: 700;
        color: var(--accent);
        background: color-mix(in srgb, var(--accent) 10%, transparent);
        border-radius: 5px;
        padding: 2px 6px;
    }
    .mScore { flex-shrink: 0; font-weight: 800; font-size: 1.05em; font-variant-numeric: tabular-nums; }
    .mRow.lead .mScore { color: var(--accent); }
    .mRow.trail { opacity: 0.65; }
    @media (max-width: 860px) { .matchups { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
    @media (max-width: 520px) {
        .matchups { grid-template-columns: 1fr; }
        .mAvatar { width: 30px; height: 30px; }
        .mhAll { display: none; }
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
