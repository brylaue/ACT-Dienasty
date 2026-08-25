<script>
    /*
      The Oracle: instant local search over everything baked into the
      site, plus an AI answer for real questions. Local search costs
      nothing and works offline; the AI half calls /api/ask.
    */
    let k = $state(null);
    let taxiPick = $state('');
    let liveTaxi = $state(null); // { rosterID: [playerIDs] } fresh from Sleeper
    let liveLite = $state(null);
    let taxiFresh = $state(false);

    // every taxi player in the league, for the claim calculator
    // claim cost per constitution 4.3, for players taxi'd since the last bake
    function deriveCost(pid) {
        const year = (k?.rosters?.flatMap((r) => r.taxiSquad || []).join(' ').match(/20\d\d/) || [String(new Date().getFullYear())])[0];
        const drafted = k?.draftedBy?.[pid] || '';
        const rd = drafted.match(/R(\d)/)?.[1];
        if (!rd) return `a ${year} 3rd-round pick (undrafted in this league's annual drafts)`;
        if (rd === '1') return `a ${year} 1st AND a ${year} 2nd (he was a 1st-round pick)`;
        const higher = { '2': '1st', '3': '2nd', '4': '3rd' }[rd] || '3rd';
        return `a ${year} ${higher}-round pick (drafted R${rd}, cost is one round higher, min 3rd)`;
    }

    let taxiOptions = $derived.by(() => {
        if (!k?.rosters) return [];
        const bakedByRoster = {};
        for (const r of k.rosters) {
            bakedByRoster[r.rosterID] = {};
            for (const line of r.taxiSquad || []) bakedByRoster[r.rosterID][line.split(' (')[0]] = line;
        }
        const teamName = (rid) => (k.rosters.find((r) => r.rosterID === rid)?.name || `Team ${rid}`).trim();
        const out = [];
        if (liveTaxi && liveLite) {
            // Sleeper truth, fresh this page load
            for (const [rid, ids] of Object.entries(liveTaxi)) {
                for (const pid of ids) {
                    const name = (liveLite[pid] || `Player ${pid}|`).split('|')[0];
                    const baked = bakedByRoster[rid]?.[name];
                    const line = baked || `${name} - TAXI CLAIM COST: ${deriveCost(pid)}`;
                    out.push({ id: `${rid}|${name}`, name, team: teamName(parseInt(rid, 10)), line, rosterID: parseInt(rid, 10) });
                }
            }
        } else {
            for (const r of k.rosters) {
                for (const line of r.taxiSquad || []) {
                    const name = line.split(' (')[0];
                    out.push({ id: `${r.rosterID}|${name}`, name, team: (r.name || '').trim(), line, rosterID: r.rosterID });
                }
            }
        }
        return out.sort((a, b) => a.name.localeCompare(b.name));
    });
    let taxiChoice = $derived(taxiOptions.find((o) => o.id === taxiPick) || null);
    let taxiVerdict = $derived.by(() => {
        if (!taxiChoice || !k?.rosters || !myTeam) return '';
        const me = k.rosters.find((r) => (r.name || '').trim() === myTeam);
        if (!me) return '';
        if ((me.name || '').trim() === taxiChoice.team) return `He's already yours — you'd just promote him, no claim needed.`;

        const cost = taxiChoice.line.split('TAXI CLAIM COST:')[1]?.trim() || '';
        // parse REQUIREMENTS from the cost clause only - the parenthetical
        // explainer repeats round words and must not be counted
        const costMain = cost.split('(')[0];
        const season = costMain.match(/20\d\d/)?.[0] || '';
        const required = [...costMain.matchAll(/(1st|2nd|3rd|4th)/g)].map((m) => parseInt(m[1][0], 10));
        if (!season || !required.length) return '';

        // my picks that year, as a consumable pool of round numbers
        const yearPicks = (me.picks || []).filter((pk) => pk.startsWith(season));
        const pool = yearPicks.map((pk) => parseInt(pk.match(/R(\d)/)?.[1] || '9', 10)).filter((r) => r <= 4).sort((a, b) => b - a);
        // cover each requirement (hardest first): exact round if owned, else
        // designate a HIGHER round (lower number) per §4.3 - each pick once
        const parts = [];
        let coverable = true;
        for (const req of [...required].sort((a, b) => a - b)) {
            const exact = pool.findIndex((r) => r === req);
            const higher = exact === -1 ? pool.reduce((best, r, i) => (r < req && (best === -1 || r > pool[best]) ? i : best), -1) : -1;
            const use = exact !== -1 ? exact : higher;
            if (use === -1) {
                parts.push(`the R${req} — nothing left to cover it`);
                coverable = false;
            } else {
                const r = pool[use];
                parts.push(r === req ? `the R${req} — covered by your ${season} R${r} ✓` : `the R${req} — covered by designating your ${season} R${r} (higher round, §4.3) ✓`);
                pool.splice(use, 1);
            }
        }
        if (coverable) return `You can cover this claim: ${parts.join('; ')}.`;
        const nextYear = String(parseInt(season, 10) + 1);
        const nextPicks = (me.picks || []).filter((pk) => pk.startsWith(nextYear)).map((pk) => pk.replace(' = pick', ' =').split(' =')[0]);
        return `You CANNOT currently cover this claim with your ${season} picks: ${parts.join('; ')}. ` +
            (nextPicks.length ? `Note: once the ${season} rookie draft is complete, claim compensation comes from the ${nextYear} draft — you hold ${nextPicks.join(', ')}. Ask The Oracle or the exec committee to confirm timing.` : '');
    });
    let q = $state('');
    let asking = $state(false);
    let answer = $state(null);
    let askError = $state(null);
    let needPasscode = $state(false);
    let passcode = $state('');
    let myTeam = $state('');
    let pickingTeam = $state(false);

    // remembered on this device only (localStorage), never required
    if (typeof localStorage !== 'undefined') {
        myTeam = localStorage.getItem('oracleTeam') || '';
        // live taxi refresh: rosters change daily in preseason, the bake is weekly
        (async () => {
            try {
                const [rosters, lite] = await Promise.all([
                    fetch('https://api.sleeper.app/v1/league/' + (k?.leagueID || '1312159501335416832') + '/rosters').then((r) => r.json()),
                    fetch('/data/players-lite.json').then((r) => r.json()),
                ]);
                const t = {};
                for (const r of rosters) if (r.taxi?.length) t[r.roster_id] = r.taxi;
                liveTaxi = t;
                liveLite = lite;
                taxiFresh = true;
            } catch { /* baked list remains */ }
        })();
    }
    const rememberTeam = (name) => {
        myTeam = name;
        pickingTeam = false;
        try {
            if (name) localStorage.setItem('oracleTeam', name);
            else localStorage.removeItem('oracleTeam');
        } catch { /* private browsing - works for this visit only */ }
    };

    (async () => {
        try {
            const res = await fetch('/data/knowledge.json');
            k = res.ok ? await res.json() : null;
        } catch { k = null; }
    })();

    // flatten the pack into searchable entries once
    const entries = $derived.by(() => {
        if (!k) return [];
        const out = [];
        for (const s of k.seasons || []) {
            if (s.champion) out.push({ tag: `${s.year}`, text: `${s.year} champion: ${s.champion}${s.runnerUp ? ` (def. ${s.runnerUp})` : ''}${s.note ? ` — ${s.note}` : ''}`, href: '/rivalry' });
            for (const row of s.standings || []) {
                out.push({ tag: `${s.year}`, text: `${row.name}: ${row.w}-${row.l}${row.t ? `-${row.t}` : ''}, ${row.pf} PF`, href: '/standings' });
            }
        }
        for (const f of k.franchises || []) {
            const former = f.formerNames?.length ? ` (formerly ${f.formerNames.join(', ')})` : '';
            out.push({ tag: 'franchise', text: `${f.name}${former}${f.ownedBy ? ` — ${f.ownedBy}` : ''}: ${f.titles} title${f.titles === 1 ? '' : 's'}, ${f.w}-${f.l} over ${f.seasons} seasons, ${Math.round(f.pf).toLocaleString()} career PF${f.bestGame ? `, best game ${f.bestGame}` : ''}${f.worstGame ? `, worst game ${f.worstGame}` : ''}`, href: '/managers' });
        }
        for (const r of k.records?.highs || []) {
            out.push({ tag: 'record', text: `High score: ${r.name} — ${r.pts} (Week ${r.week}, ${r.year})`, href: '/records' });
        }
        for (const r of k.records?.lows || []) {
            out.push({ tag: 'record', text: `Low score: ${r.name} — ${r.pts} (Week ${r.week}, ${r.year})`, href: '/records' });
        }
        if (k.constitution) {
            // split the constitution into sentence-ish chunks for search
            for (const chunk of k.constitution.match(/[^.!?]+[.!?]+/g) || []) {
                if (chunk.trim().length > 30) out.push({ tag: 'constitution', text: chunk.trim(), href: '/constitution' });
            }
        }
        for (const r of k.rosters || []) {
            const team = r.name.length > 14 ? r.name.slice(0, 13) + '…' : r.name;
            // legacy packs carried one flat players list; new packs split
            // active / taxi / IR so status is never guessed from a suffix
            for (const line of r.activeRoster || r.players || []) {
                out.push({ tag: team, text: `${r.name} active roster — ${line}`, href: '/rosters' });
            }
            for (const line of r.taxiSquad || []) {
                out.push({ tag: 'taxi', text: `${r.name} TAXI SQUAD — ${line}`, href: '/rosters' });
            }
            for (const line of r.injuredReserve || []) {
                out.push({ tag: 'IR', text: `${r.name} injured reserve — ${line}`, href: '/rosters' });
            }
            if (r.picks?.length) {
                out.push({ tag: 'picks', text: `${r.name} owns: ${r.picks.join(', ')}`, href: '/rosters' });
            }
        }
        for (const m of k.slack || []) {
            out.push({ tag: `#${m.ch}`, text: `${m.name}: ${m.text}`, href: '/archive' });
        }
        return out;
    });

    const results = $derived.by(() => {
        const query = q.trim().toLowerCase();
        if (query.length < 2) return [];
        const words = query.split(/\s+/);
        return entries
            .map((e) => {
                const t = e.text.toLowerCase();
                const score = words.reduce((acc, w) => acc + (t.includes(w) ? 1 : 0), 0);
                return { ...e, score };
            })
            .filter((e) => e.score === words.length || e.score >= 2)
            .sort((a, b) => b.score - a.score)
            .slice(0, 25);
    });

    async function ask() {
        const question = q.trim();
        if (!question || asking) return;
        asking = true; answer = null; askError = null;
        try {
            const res = await fetch('/api/ask', {
                method: 'POST',
                headers: { 'content-type': 'application/json', ...(passcode ? { 'x-ask-passcode': passcode } : {}) },
                body: JSON.stringify({ question, team: myTeam || undefined }),
            });
            const data = await res.json();
            if (res.status === 401) { needPasscode = true; askError = data.message; }
            else if (!res.ok) { askError = data.message || 'Something went wrong.'; }
            else { answer = data.answer; needPasscode = false; }
        } catch {
            askError = 'Could not reach The Oracle.';
        }
        asking = false;
    }
</script>

<svelte:head>
    <title>The Oracle | League Page</title>
</svelte:head>

<div class="holder">
    <h2>🔮 The Oracle</h2>
    <p class="subtitle">Ask the league's memory anything — champions, records, the constitution, the Slack vault. Search is instant; the AI answer thinks for a second.</p>

    <div class="teamRow">
        {#if myTeam}
            <span class="teamChip">You: <strong>{myTeam}</strong></span>
            <button class="teamLink" onclick={() => pickingTeam = !pickingTeam}>change</button>
            <button class="teamLink" onclick={() => rememberTeam('')}>forget</button>
        {:else}
            <button class="teamLink" onclick={() => pickingTeam = !pickingTeam}>Which team are you? (optional — personalizes answers)</button>
        {/if}
    </div>
    {#if pickingTeam && k?.rosters?.length}
        <div class="teamPick">
            {#each k.rosters as r (r.rosterID)}
                <button class="teamOption" onclick={() => rememberTeam(r.name)}>{r.name}</button>
            {/each}
        </div>
    {/if}

    <div class="askRow">
        <input class="q" type="search" placeholder="Who won in 2022? Highest score ever? Waiver rules?"
            bind:value={q} onkeydown={(e) => { if (e.key === 'Enter') ask(); }} />
        <button class="askBtn" onclick={ask} disabled={asking || q.trim().length < 3}>
            {asking ? 'Consulting…' : 'Ask AI'}
        </button>
    </div>

    {#if needPasscode}
        <div class="passRow">
            <input class="q pass" type="password" placeholder="League passcode" bind:value={passcode} />
            <button class="askBtn" onclick={ask} disabled={asking}>Retry</button>
        </div>
    {/if}

    {#if askError && !needPasscode}
        <p class="err">{askError}</p>
    {/if}

    {#if answer}
        <div class="answer">
            <div class="answerKicker">The Oracle says</div>
            <div class="answerText">{answer}</div>
        </div>
    {/if}

    {#if results.length}
        <div class="resultsKicker">From the archives</div>
        {#each results as r}
            <a class="result" href={r.href}>
                <span class="tag">{r.tag}</span>
                <span class="rText">{r.text}</span>
            </a>
        {/each}
    {:else if q.trim().length >= 2}
        <p class="noHits">Nothing in the local archives — try the AI for a synthesized answer.</p>
    {/if}

    {#if taxiOptions.length}
        <div class="taxiCalc">
            <h3>🚕 Taxi Claim Calculator <span class="taxiFreshness">{taxiFresh ? 'live from Sleeper' : 'weekly snapshot'}</span></h3>
            <select bind:value={taxiPick} class="taxiSelect">
                <option value="">Pick any taxi-squad player…</option>
                {#each taxiOptions as o}
                    <option value={o.id}>{o.name} — {o.team}</option>
                {/each}
            </select>
            {#if taxiChoice}
                <p class="taxiCost">On <strong>{taxiChoice.team}</strong>'s taxi squad. Claim cost: <strong>{taxiChoice.line.split('TAXI CLAIM COST:')[1]?.trim() || 'see by-laws'}</strong></p>
                {#if taxiVerdict}<p class="taxiVerdict">{taxiVerdict}</p>{/if}
                <p class="taxiHow">To claim: post in the league Slack — the owner then has 72 hours to promote or forfeit him (§4.3).</p>
            {/if}
        </div>
    {/if}

    {#if k}
        <p class="footnote">Knowledge pack updated {new Date(k.generated).toLocaleDateString()} · {k.seasons?.length || 0} seasons · searches run entirely in your browser.</p>
    {/if}
</div>

<style>
    .holder { max-width: 680px; margin: 0 auto; padding: 24px 16px 80px; }
    .taxiCalc { margin-top: 26px; border: 1px solid var(--line); border-radius: 12px; padding: 14px 16px; background: var(--fff); }
    .taxiCalc h3 { margin: 0 0 10px; font-size: 1em; color: var(--ink); display: flex; align-items: baseline; gap: 8px; }
    .taxiFreshness { font-size: 0.68em; font-weight: 500; color: var(--muted); border: 1px solid var(--line); border-radius: 999px; padding: 2px 8px; }
    .taxiSelect { width: 100%; padding: 8px 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--fff); color: var(--ink); font-family: var(--bodyFont); font-size: 0.9em; }
    .taxiCost { margin: 10px 0 0; font-size: 0.88em; color: var(--ink); }
    .taxiVerdict { margin: 6px 0 0; font-size: 0.84em; color: var(--accent); font-weight: 600; }
    .taxiHow { margin: 6px 0 0; font-size: 0.78em; color: var(--muted); }
    h2 { text-align: center; color: var(--ink); margin-bottom: 4px; font-size: 1.6em; }
    .subtitle { text-align: center; color: var(--muted); font-size: 0.85em; margin: 0 auto 22px; max-width: 460px; }

    .teamRow { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; flex-wrap: wrap; }
    .teamChip {
        font-size: 0.8em;
        color: var(--muted);
        background: var(--fff);
        border: 1px solid var(--line);
        border-radius: 999px;
        padding: 4px 12px;
    }
    .teamLink {
        border: none;
        background: none;
        color: var(--accent);
        font-size: 0.78em;
        font-weight: 600;
        cursor: pointer;
        font-family: var(--bodyFont);
        padding: 0;
    }
    .teamPick { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px; }
    .teamOption {
        border: 1px solid var(--line);
        background: var(--fff);
        color: var(--ink);
        border-radius: 999px;
        padding: 5px 12px;
        font-size: 0.78em;
        font-weight: 600;
        cursor: pointer;
        font-family: var(--bodyFont);
    }
    .teamOption:hover { border-color: var(--accent); color: var(--accent); }

    .askRow, .passRow { display: flex; gap: 8px; margin-bottom: 8px; }
    .q {
        flex: 1;
        border: 1px solid var(--line);
        border-radius: 10px;
        padding: 11px 14px;
        font-size: 0.95em;
        font-family: var(--bodyFont);
        background: var(--fff);
        color: var(--ink);
    }
    .q:focus { outline: 2px solid var(--accentSoft); border-color: var(--accent); }
    .askBtn {
        border: none;
        background: var(--accent);
        color: #fff;
        border-radius: 10px;
        padding: 11px 18px;
        font-weight: 700;
        font-size: 0.88em;
        font-family: var(--bodyFont);
        cursor: pointer;
    }
    .askBtn:disabled { opacity: 0.5; cursor: default; }

    .err { color: #b91c1c; font-size: 0.82em; text-align: center; margin: 8px 0; }

    .answer {
        background: var(--fff);
        border: 1px solid var(--line);
        border-left: 3px solid var(--accent);
        border-radius: 12px;
        padding: 16px 18px;
        margin: 14px 0 6px;
        box-shadow: 0 1px 2px rgba(16, 24, 40, 0.05);
    }
    .answerKicker {
        font-weight: 700;
        font-size: 0.68em;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--accent);
        margin-bottom: 6px;
    }
    .answerText { font-size: 0.92em; line-height: 1.6; color: var(--ink); white-space: pre-wrap; }

    .resultsKicker {
        font-weight: 700;
        font-size: 0.68em;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--muted);
        margin: 20px 0 8px;
    }
    .result {
        display: flex;
        gap: 10px;
        align-items: baseline;
        text-decoration: none;
        padding: 8px 10px;
        border-radius: 8px;
        color: var(--ink);
    }
    .result:hover { background: var(--fff); }
    .tag {
        flex-shrink: 0;
        font-size: 0.65em;
        font-weight: 700;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        color: var(--accent);
        background: var(--accentSoft);
        border-radius: 999px;
        padding: 2px 8px;
    }
    .rText { font-size: 0.85em; line-height: 1.45; }
    .noHits { color: var(--muted); font-size: 0.82em; text-align: center; margin: 18px 0; }
    .footnote { text-align: center; color: var(--muted); font-size: 0.68em; margin-top: 30px; }
</style>
