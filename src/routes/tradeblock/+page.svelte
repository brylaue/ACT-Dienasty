<script>
    /*
      Auto-synced from Sleeper: whatever managers flag on their trade block
      in the app (players AND draft picks) shows up here after the next
      data refresh - no manual editing. Baked by scripts/build-tradeblock.mjs.
    */
    let data = $state(null);
    let loading = $state(true);

    (async () => {
        try {
            const res = await fetch('/data/tradeblock.json');
            data = res.ok ? await res.json() : null;
        } catch {
            data = null;
        }
        loading = false;
    })();

    const posVar = (pos) => ['QB', 'RB', 'WR', 'TE'].includes(pos) ? `var(--${pos})` : 'var(--blueTwo)';
</script>

<svelte:head>
    <title>Trade Block | League Page</title>
</svelte:head>

<div class="holder">
    <h2>📋 Trade Block</h2>
    <p class="subtitle">Synced straight from Sleeper — flag a player or pick on your block in the app and it shows up here.</p>

    {#if loading}
        <p class="empty">Checking the block...</p>
    {:else if !data?.teams?.length}
        <p class="empty">Nobody's shopping anything right now. Put a player on your trade block in the Sleeper app and it'll appear here after the next sync.</p>
    {:else}
        <div class="list">
            {#each data.teams as team (team.rosterID)}
                <div class="card">
                    <div class="manager">
                        {#if team.avatar}
                            <img class="avatar" src={team.avatar} alt={team.teamName} />
                        {/if}
                        <span class="mname">{team.teamName}</span>
                        <span class="count">{team.items.length} on the block</span>
                    </div>
                    <div class="items">
                        {#each team.items as item}
                            <div class="item" class:pick={item.type === 'pick'}>
                                <span class="chipBar" style="background: {item.type === 'pick' ? 'var(--gold)' : posVar(item.position)}"></span>
                                <span class="chipBody">
                                    <span class="chip">{item.label}</span>
                                    {#if item.detail}
                                        <span class="note">{item.detail}</span>
                                    {/if}
                                </span>
                                {#if item.likes > 0}
                                    <span class="likes" title="{item.likes} team{item.likes === 1 ? '' : 's'} interested">❤️ {item.likes}</span>
                                {/if}
                            </div>
                        {/each}
                    </div>
                </div>
            {/each}
        </div>
        {#if data.generated}
            <p class="generated">Last synced {new Date(data.generated).toLocaleString()}</p>
        {/if}
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
        max-width: 460px;
        margin-left: auto;
        margin-right: auto;
    }
    .empty {
        text-align: center;
        color: var(--g555);
        margin: 60px auto;
        max-width: 420px;
        line-height: 1.6;
    }
    .list {
        display: flex;
        flex-direction: column;
        gap: 14px;
    }
    .card {
        background: var(--fff);
        border: 1px solid var(--ddd);
        border-top: 3px solid var(--gold);
        border-radius: 12px;
        padding: 16px 18px;
        box-shadow: 0 1px 4px rgba(2, 28, 61, 0.07);
    }
    .manager {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-bottom: 12px;
    }
    .avatar {
        width: 34px;
        height: 34px;
        border-radius: 50%;
        object-fit: cover;
        border: 2px solid var(--blueTwo);
    }
    .mname {
        font-weight: 700;
        color: var(--blueOne);
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .count {
        font-size: 0.68em;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--gold);
        white-space: nowrap;
    }
    .items {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
    }
    .item {
        display: flex;
        align-items: center;
        background: var(--eee);
        border-radius: 8px;
        overflow: hidden;
    }
    .chipBar {
        width: 4px;
        align-self: stretch;
        flex-shrink: 0;
    }
    .chipBody {
        display: flex;
        flex-direction: column;
        padding: 6px 10px;
    }
    .chip {
        font-weight: 600;
        font-size: 0.85em;
        color: var(--ink);
        line-height: 1.2;
    }
    .note {
        font-size: 0.68em;
        color: var(--g555);
        letter-spacing: 0.03em;
    }
    .likes {
        font-size: 0.72em;
        font-weight: 700;
        padding: 2px 8px 2px 2px;
        color: var(--g555);
        white-space: nowrap;
    }
    .generated {
        text-align: center;
        color: var(--g999);
        font-size: 0.7em;
        margin-top: 24px;
    }
</style>
