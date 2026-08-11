<script>
    import LinearProgress from '@smui/linear-progress';
    import { getTeamFromTeamManagers } from '$lib/utils/helperFunctions/universalFunctions';
    import { retryFetch } from '$lib/utils/errorHandler';
    import { round } from '$lib/utils/helper';

    export let leagueTeamManagers;

    /*
      Sunday Shame: the weekly recap nobody asked for and everybody needs.
      Season/week list comes from the baked data file; the selected week is
      fetched live from Sleeper because shame requires bench points
      (players_points), which the bake doesn't carry.
    */

    let seasons = [];       // [{year, leagueID, weeks: [1, 2, ...]}]
    let selYear = null;
    let selWeek = null;
    let recap = null;
    let loading = true;
    let copied = false;

    const hashString = (str) => {
        let h = 0;
        for (let i = 0; i < String(str).length; i++) h = (h * 31 + String(str).charCodeAt(i)) >>> 0;
        return h;
    };
    const pickLine = (pool, seed) => pool[seed % pool.length];

    const BENCH_LINES = [
        "a decision they'll be discussing in therapy",
        "coaching malpractice, plain and simple",
        "the bench had the answers all along",
        "somewhere, a lineup optimizer weeps",
    ];
    const TOILET_LINES = [
        "thoughts and prayers",
        "the less said, the better",
        "a performance future generations will study, as a warning",
        "someone check on them",
    ];
    const BLOWOUT_LINES = [
        "this one's going in the family group chat",
        "the mercy rule was discussed",
        "not a game, a crime scene",
        "flag football has fewer flags than this beatdown",
    ];
    const HEARTBREAK_LINES = [
        "decided by a kicker's mood, probably",
        "so close it should be illegal",
        "margin thinner than the excuses that followed",
        "one bench decision away from a different story",
    ];

    const init = async () => {
        try {
            const res = await fetch('/data/rivalry-matchups.json');
            const baked = res.ok ? await res.json() : null;
            if (baked) {
                for (const lid of baked.chain) {
                    const s = baked.seasons[lid];
                    const weeks = s.weeks.map((w, ix) => w ? ix + 1 : null).filter(Boolean);
                    if (weeks.length) {
                        seasons.push({ year: parseInt(s.year), leagueID: lid, weeks });
                    }
                }
                seasons.sort((a, b) => b.year - a.year);
                seasons = seasons;
            }
            if (seasons.length) {
                selYear = seasons[0].year;
                selWeek = seasons[0].weeks[seasons[0].weeks.length - 1];
            } else {
                loading = false;
            }
        } catch (err) {
            console.error(err);
            loading = false;
        }
    };
    init();

    const seasonFor = (year) => seasons.find((s) => s.year == year);
    const teamName = (rosterID, year) => getTeamFromTeamManagers(leagueTeamManagers, rosterID, `${year}`).name;

    const buildRecap = async (year, week) => {
        if (year == null || week == null) return;
        loading = true;
        recap = null;
        copied = false;
        const season = seasonFor(year);
        if (!season) { loading = false; return; }
        try {
            const res = await retryFetch(`https://api.sleeper.app/v1/league/${season.leagueID}/matchups/${week}`);
            const entries = await res.json();
            const teams = [];
            const pairs = {};
            for (const e of entries) {
                const starterPts = (e.starters_points || []).reduce((t, v) => t + (v || 0), 0);
                const totalPts = Object.values(e.players_points || {}).reduce((t, v) => t + (v || 0), 0);
                const t = {
                    rosterID: e.roster_id,
                    name: teamName(e.roster_id, year),
                    pts: starterPts,
                    bench: Math.max(totalPts - starterPts, 0),
                };
                teams.push(t);
                if (e.matchup_id != null) {
                    (pairs[e.matchup_id] = pairs[e.matchup_id] || []).push(t);
                }
            }
            const played = teams.filter((t) => t.pts > 0);
            if (!played.length) { recap = null; loading = false; return; }

            const seed = hashString(`${year}-${week}`);
            const top = [...played].sort((a, b) => b.pts - a.pts)[0];
            const toilet = [...played].sort((a, b) => a.pts - b.pts)[0];
            const benchKing = [...played].sort((a, b) => b.bench - a.bench)[0];

            let blowout = null;
            let heartbreak = null;
            for (const id in pairs) {
                const p = pairs[id];
                if (p.length != 2 || (p[0].pts == 0 && p[1].pts == 0)) continue;
                const margin = Math.abs(p[0].pts - p[1].pts);
                const winner = p[0].pts >= p[1].pts ? p[0] : p[1];
                const loser = p[0].pts >= p[1].pts ? p[1] : p[0];
                const game = { winner, loser, margin };
                if (!blowout || margin > blowout.margin) blowout = game;
                if (!heartbreak || margin < heartbreak.margin) heartbreak = game;
            }

            const benchLost = pairs && Object.values(pairs).some((p) =>
                p.length == 2 && p.includes(benchKing) &&
                benchKing.pts < p.find((x) => x != benchKing).pts &&
                benchKing.bench > Math.abs(p[0].pts - p[1].pts)
            );

            recap = {
                year, week, top, toilet, benchKing, blowout, heartbreak,
                lines: {
                    bench: benchLost
                        ? `left ${round(benchKing.bench)} on the bench in a game they lost — ${pickLine(BENCH_LINES, seed)}`
                        : `left ${round(benchKing.bench)} points riding the pine — ${pickLine(BENCH_LINES, seed + 1)}`,
                    toilet: pickLine(TOILET_LINES, seed + 2),
                    blowout: pickLine(BLOWOUT_LINES, seed + 3),
                    heartbreak: pickLine(HEARTBREAK_LINES, seed + 4),
                },
            };
        } catch (err) {
            console.error(err);
            recap = null;
        }
        loading = false;
    };

    $: buildRecap(selYear, selWeek);
    $: weekOptions = seasonFor(selYear)?.weeks || [];

    const copyText = () => {
        if (!recap) return;
        const r = recap;
        const text = [
            `🏈 SUNDAY SHAME — ${r.year} Week ${r.week}`,
            `👑 Top score: ${r.top.name} (${round(r.top.pts)})`,
            `🚽 Toilet of the Week: ${r.toilet.name} (${round(r.toilet.pts)}) — ${r.lines.toilet}`,
            r.blowout ? `🔨 Beatdown: ${r.blowout.winner.name} flattened ${r.blowout.loser.name} by ${round(r.blowout.margin)} — ${r.lines.blowout}` : null,
            r.heartbreak ? `💔 Heartbreak: ${r.heartbreak.loser.name} fell to ${r.heartbreak.winner.name} by ${round(r.heartbreak.margin)} — ${r.lines.heartbreak}` : null,
            `🪑 Bench Warmer: ${r.benchKing.name} ${r.lines.bench}`,
            `— act-dienasty.vercel.app`,
        ].filter(Boolean).join('\n');
        navigator.clipboard?.writeText(text).then(() => {
            copied = true;
            setTimeout(() => copied = false, 2500);
        });
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
        max-width: 600px;
        font-size: 0.9em;
        padding: 0 1em;
    }
    .controls {
        display: flex;
        justify-content: center;
        align-items: center;
        gap: 0.7em;
        margin-bottom: 1.4em;
    }
    select {
        padding: 0.35em 0.8em;
        border-radius: 6px;
        background-color: var(--fff);
        color: var(--g000);
        border: 1px solid var(--ccc);
        font-size: 0.95em;
    }
    .cards {
        width: 95%;
        max-width: 720px;
        margin: 0 auto;
    }
    .card {
        display: flex;
        align-items: baseline;
        gap: 0.7em;
        background-color: var(--fff);
        border: 1px solid var(--ddd);
        border-left: 4px solid var(--blueOne);
        border-radius: 12px;
        padding: 0.8em 1em;
        margin-bottom: 0.7em;
    }
    .emoji {
        font-size: 1.6em;
        flex-shrink: 0;
    }
    .cardBody .title {
        font-weight: bold;
        font-size: 0.95em;
    }
    .cardBody .detail {
        font-size: 0.85em;
        color: var(--g333);
        line-height: 1.35;
    }
    .cardBody .zing {
        font-size: 0.75em;
        color: var(--g555);
        font-style: italic;
    }
    .copyBar {
        text-align: center;
        margin: 1.4em 0 2.5em;
    }
    .copyBtn {
        background-color: var(--blueOne);
        color: #fff;
        border: none;
        border-radius: 8px;
        padding: 0.6em 1.4em;
        font-size: 0.95em;
        cursor: pointer;
    }
    .copied {
        margin-left: 0.8em;
        color: var(--RB);
        font-size: 0.85em;
    }
    .empty {
        text-align: center;
        color: var(--g555);
        margin: 3em 1em;
        font-style: italic;
    }
    .loading {
        display: block;
        width: 85%;
        max-width: 500px;
        margin: 80px auto;
    }
</style>

<h2>Sunday Shame</h2>
<p class="subtitle">The weekly recap: who cooked, who got cooked, and who lost with the winning lineup sitting on their bench.</p>

<div class="controls">
    <select bind:value={selYear}>
        {#each seasons as s}
            <option value={s.year}>{s.year}</option>
        {/each}
    </select>
    <select bind:value={selWeek}>
        {#each weekOptions as w}
            <option value={w}>Week {w}</option>
        {/each}
    </select>
</div>

{#if loading}
    <div class="loading">
        <p>Reviewing the tape...</p>
        <br />
        <LinearProgress indeterminate />
    </div>
{:else if recap}
    <div class="cards">
        <div class="card">
            <span class="emoji">👑</span>
            <span class="cardBody">
                <span class="title">Top Score</span>
                <span class="detail">{recap.top.name} — {round(recap.top.pts)} points</span>
            </span>
        </div>
        <div class="card">
            <span class="emoji">🚽</span>
            <span class="cardBody">
                <span class="title">Toilet of the Week</span>
                <span class="detail">{recap.toilet.name} — {round(recap.toilet.pts)} points. <span class="zing">{recap.lines.toilet}.</span></span>
            </span>
        </div>
        {#if recap.blowout}
            <div class="card">
                <span class="emoji">🔨</span>
                <span class="cardBody">
                    <span class="title">Beatdown of the Week</span>
                    <span class="detail">{recap.blowout.winner.name} flattened {recap.blowout.loser.name} by {round(recap.blowout.margin)}. <span class="zing">{recap.lines.blowout}.</span></span>
                </span>
            </div>
        {/if}
        {#if recap.heartbreak && recap.heartbreak.margin < (recap.blowout?.margin ?? Infinity)}
            <div class="card">
                <span class="emoji">💔</span>
                <span class="cardBody">
                    <span class="title">Heartbreak of the Week</span>
                    <span class="detail">{recap.heartbreak.loser.name} fell to {recap.heartbreak.winner.name} by {round(recap.heartbreak.margin)}. <span class="zing">{recap.lines.heartbreak}.</span></span>
                </span>
            </div>
        {/if}
        <div class="card">
            <span class="emoji">🪑</span>
            <span class="cardBody">
                <span class="title">Bench Warmer of the Week</span>
                <span class="detail">{recap.benchKing.name} {recap.lines.bench}.</span>
            </span>
        </div>
    </div>
    <div class="copyBar">
        <button class="copyBtn" onclick={copyText}>📋 Copy for the group chat</button>
        {#if copied}<span class="copied">Copied — go cause problems.</span>{/if}
    </div>
{:else}
    <p class="empty">No games played for that week yet. Check back after Sunday does its damage.</p>
{/if}
