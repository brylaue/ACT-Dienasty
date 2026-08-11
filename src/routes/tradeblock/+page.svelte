<script>
    import { managers } from '$lib/utils/leagueInfo';
    import { tradeBlock } from '$lib/utils/tradeBlock';

    const rows = tradeBlock
        .map((entry) => {
            const manager = managers.find((m) => m.managerID == entry.managerID);
            if (!manager || !entry.items?.length) return null;
            return { manager, items: entry.items };
        })
        .filter(Boolean);
</script>

<svelte:head>
    <title>Trade Block | League Page</title>
</svelte:head>

<div class="holder">
    <h2>📋 Trade Block</h2>
    <p class="subtitle">What managers around the league are open to moving right now.</p>

    {#if !rows.length}
        <p class="empty">Nobody's put anything on the block yet.</p>
    {:else}
        <div class="list">
            {#each rows as row}
                <div class="card">
                    <div class="manager">
                        {#if row.manager.photo}
                            <img class="avatar" src={row.manager.photo} alt={row.manager.name} />
                        {/if}
                        <span class="mname">{row.manager.name}</span>
                    </div>
                    <div class="items">
                        {#each row.items as item}
                            <div class="item">
                                <span class="chip" class:pick={item.pick}>
                                    {item.player || item.pick}
                                </span>
                                {#if item.note}
                                    <span class="note">{item.note}</span>
                                {/if}
                            </div>
                        {/each}
                    </div>
                </div>
            {/each}
        </div>
    {/if}

    <p class="howto">
        Want your name up here? Tell the commissioner what you're shopping.
    </p>
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
    }
    .empty {
        text-align: center;
        color: var(--g555);
        margin: 60px auto;
    }
    .list {
        display: flex;
        flex-direction: column;
        gap: 12px;
    }
    .card {
        background: var(--fff);
        border: 1px solid var(--ddd);
        border-left: 3px solid var(--QB);
        border-radius: 8px;
        padding: 14px 16px;
        box-shadow: 0 1px 3px rgba(0,0,0,0.04);
    }
    .manager {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-bottom: 10px;
    }
    .avatar {
        width: 32px;
        height: 32px;
        border-radius: 50%;
        object-fit: cover;
        border: 2px solid var(--blueTwo);
    }
    .mname {
        font-weight: 600;
        color: var(--blueOne);
    }
    .items {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
    }
    .item {
        display: flex;
        align-items: center;
        gap: 6px;
        background: var(--eee);
        border-radius: 6px;
        padding: 6px 10px;
    }
    .chip {
        font-weight: 600;
        font-size: 0.85em;
        color: var(--blueOne);
    }
    .chip.pick { color: var(--RB); }
    .note {
        font-size: 0.75em;
        color: var(--g555);
        font-style: italic;
    }
    .howto {
        text-align: center;
        color: var(--g999);
        font-size: 0.75em;
        margin-top: 32px;
    }
</style>
