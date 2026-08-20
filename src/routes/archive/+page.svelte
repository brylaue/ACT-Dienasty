<script>
    /*
      The Vault: the league's Slack history, preserved on the site.
      Free-plan Slack hides messages after 90 days - whatever gets baked
      into static/data/slack-archive.json is saved for good. Collections
      merge by message timestamp, so a deeper backfill (e.g. a one-month
      Pro upgrade to recover 2019-2026) just extends this archive backward.
    */
    let archive = $state(null);
    let loading = $state(true);
    let activeChannel = $state('general');
    let filter = $state('');

    (async () => {
        try {
            const res = await fetch('/data/slack-archive.json');
            archive = res.ok ? await res.json() : null;
        } catch { archive = null; }
        loading = false;
    })();

    const channels = $derived((archive?.channels || []).filter((c) => c.messages.length));
    const current = $derived(channels.find((c) => c.name === activeChannel) || channels[0]);

    const filtered = $derived.by(() => {
        if (!current) return [];
        const q = filter.trim().toLowerCase();
        if (!q) return current.messages;
        return current.messages.filter((m) =>
            m.text.toLowerCase().includes(q) || m.name.toLowerCase().includes(q));
    });

    // group into day sections for readable browsing
    const days = $derived.by(() => {
        const groups = [];
        let curKey = null;
        for (const m of filtered) {
            const d = new Date(parseFloat(m.ts) * 1000);
            const key = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
            if (key !== curKey) { groups.push({ key, msgs: [] }); curKey = key; }
            groups[groups.length - 1].msgs.push(m);
        }
        return groups;
    });

    const timeOf = (ts) => new Date(parseFloat(ts) * 1000).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

    // stable pastel per author for the initial avatars
    const hue = (name) => [...name].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
    const initials = (name) => name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();

    const EMOJI = { heart: '❤️', fire: '🔥', joy: '😂', eyes: '👀', beers: '🍻', clap: '👏', '+1': '👍', point_up_2: '☝️', saluting_face: '🫡', rolling_on_the_floor_laughing: '🤣' };
    const emojiFor = (code) => EMOJI[code] || `:${code}:`;
    const renderText = (t) => t.replace(/:([a-z0-9_+-]+):/g, (m, c) => EMOJI[c] || m);
</script>

<svelte:head>
    <title>The Vault | League Page</title>
</svelte:head>

<div class="holder">
    <h2>🗄️ The Vault</h2>
    <p class="subtitle">The league's Slack, preserved. Free-plan Slack forgets after 90 days — this page doesn't.</p>

    {#if loading}
        <p class="empty">Opening the vault...</p>
    {:else if !channels.length}
        <p class="empty">Nothing archived yet.</p>
    {:else}
        <div class="controls">
            <div class="chTabs">
                {#each channels as c (c.id)}
                    <button class="chTab" class:active={current?.name === c.name} onclick={() => activeChannel = c.name}>
                        #{c.name} <span class="chCount">{c.messages.length}</span>
                    </button>
                {/each}
            </div>
            <input class="search" type="search" placeholder="Search the archive..." bind:value={filter} />
        </div>

        {#each days as day (day.key)}
            <div class="dayHeader"><span>{day.key}</span></div>
            {#each day.msgs as m (m.ts)}
                <div class="msg" class:meta={m.meta}>
                    <div class="avatar" style="background: hsl({hue(m.name)}, 45%, 88%); color: hsl({hue(m.name)}, 55%, 30%)">{initials(m.name)}</div>
                    <div class="msgBody">
                        <div class="msgHead">
                            <span class="author">{m.name}</span>
                            <span class="time">{timeOf(m.ts)}</span>
                        </div>
                        {#if m.text}
                            <div class="text">{renderText(m.text)}</div>
                        {/if}
                        {#if m.files?.length}
                            {#each m.files as f}
                                <div class="fileChip">{f.type === 'video' ? '🎬' : '📷'} {f.name} <span class="fileNote">shared in Slack</span></div>
                            {/each}
                        {/if}
                        {#if m.reactions?.length}
                            <div class="reactions">
                                {#each m.reactions as r}
                                    <span class="reaction">{emojiFor(r.e)} {r.n}</span>
                                {/each}
                            </div>
                        {/if}
                    </div>
                </div>
            {/each}
        {/each}

        <p class="coverage">{archive.coverage} Archived {new Date(archive.generated).toLocaleDateString()}.</p>
    {/if}
</div>

<style>
    .holder { max-width: 720px; margin: 0 auto; padding: 24px 16px 80px; }
    h2 { text-align: center; color: var(--ink); margin-bottom: 4px; font-size: 1.6em; }
    .subtitle { text-align: center; color: var(--muted); font-size: 0.85em; margin-bottom: 24px; }
    .empty { text-align: center; color: var(--muted); margin: 60px auto; }

    .controls { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; justify-content: space-between; margin-bottom: 8px; }
    .chTabs { display: flex; gap: 6px; flex-wrap: wrap; }
    .chTab {
        border: 1px solid var(--line);
        background: var(--fff);
        color: var(--muted);
        border-radius: 999px;
        padding: 5px 12px;
        font-size: 0.8em;
        font-weight: 600;
        cursor: pointer;
        font-family: var(--bodyFont);
    }
    .chTab.active { border-color: var(--accent); color: var(--accent); background: var(--accentSoft); }
    .chCount { opacity: 0.65; font-weight: 500; }
    .search {
        border: 1px solid var(--line);
        border-radius: 8px;
        padding: 7px 12px;
        font-size: 0.85em;
        font-family: var(--bodyFont);
        background: var(--fff);
        color: var(--ink);
        min-width: 200px;
        flex: 1;
        max-width: 260px;
    }

    .dayHeader {
        display: flex;
        align-items: center;
        gap: 12px;
        margin: 26px 0 10px;
        color: var(--muted);
        font-size: 0.72em;
        font-weight: 700;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        white-space: nowrap;
    }
    .dayHeader::before, .dayHeader::after { content: ''; height: 1px; background: var(--line); flex: 1; }

    .msg { display: flex; gap: 10px; padding: 7px 0; }
    .msg.meta { opacity: 0.55; }
    .avatar {
        width: 34px; height: 34px; border-radius: 8px;
        display: flex; align-items: center; justify-content: center;
        font-size: 0.72em; font-weight: 800; flex-shrink: 0;
    }
    .msgBody { min-width: 0; }
    .msgHead { display: flex; align-items: baseline; gap: 8px; }
    .author { font-weight: 700; color: var(--ink); font-size: 0.9em; }
    .time { color: var(--muted); font-size: 0.7em; }
    .text { font-size: 0.9em; line-height: 1.5; color: var(--ink); white-space: pre-wrap; overflow-wrap: break-word; }

    .fileChip {
        display: inline-block;
        margin-top: 4px;
        border: 1px dashed var(--line);
        border-radius: 8px;
        padding: 4px 10px;
        font-size: 0.75em;
        color: var(--muted);
    }
    .fileNote { opacity: 0.7; font-style: italic; }

    .reactions { display: flex; gap: 6px; margin-top: 5px; flex-wrap: wrap; }
    .reaction {
        border: 1px solid var(--line);
        background: var(--pageBg);
        border-radius: 999px;
        padding: 1px 8px;
        font-size: 0.75em;
        color: var(--muted);
    }

    .coverage { text-align: center; color: var(--muted); font-size: 0.7em; margin-top: 36px; }
</style>
