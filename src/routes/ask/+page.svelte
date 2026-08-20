<script>
    /*
      The Oracle: instant local search over everything baked into the
      site, plus an AI answer for real questions. Local search costs
      nothing and works offline; the AI half calls /api/ask.
    */
    let k = $state(null);
    let q = $state('');
    let asking = $state(false);
    let answer = $state(null);
    let askError = $state(null);
    let needPasscode = $state(false);
    let passcode = $state('');

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
            out.push({ tag: 'franchise', text: `${f.name}${former}: ${f.titles} title${f.titles === 1 ? '' : 's'}, ${f.w}-${f.l} over ${f.seasons} seasons, ${Math.round(f.pf).toLocaleString()} career PF`, href: '/managers' });
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
                body: JSON.stringify({ question }),
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

    {#if k}
        <p class="footnote">Knowledge pack updated {new Date(k.generated).toLocaleDateString()} · {k.seasons?.length || 0} seasons · searches run entirely in your browser.</p>
    {/if}
</div>

<style>
    .holder { max-width: 680px; margin: 0 auto; padding: 24px 16px 80px; }
    h2 { text-align: center; color: var(--ink); margin-bottom: 4px; font-size: 1.6em; }
    .subtitle { text-align: center; color: var(--muted); font-size: 0.85em; margin: 0 auto 22px; max-width: 460px; }

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
