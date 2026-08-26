<script>
    // The 1.13 compensatory pick (Toilet Bowl prize) exists in the
    // constitution but NOT in Sleeper - this banner keeps it visible
    // anywhere the league looks at picks. Data comes from the weekly
    // knowledge bake and re-resolves itself each season.
    import { onMount } from 'svelte';

    let cp = $state(null);

    onMount(async () => {
        try {
            const res = await fetch('/data/knowledge.json');
            if (!res.ok) return;
            const k = await res.json();
            cp = k?.upcomingDraft?.compPick || null;
        } catch { /* banner simply doesn't render */ }
    });
</script>

<style>
    .compBanner {
        display: flex;
        align-items: flex-start;
        gap: 12px;
        max-width: 900px;
        margin: 18px auto 6px;
        padding: 14px 18px;
        border: 1px solid var(--accent, #2563eb);
        border-left-width: 5px;
        border-radius: 12px;
        background: color-mix(in srgb, var(--accent, #2563eb) 6%, var(--fff, #fff));
    }
    .compIcon { font-size: 1.5em; line-height: 1.2; }
    .compBody { font-size: 0.92em; line-height: 1.5; color: var(--blk, #111); }
    .compBody strong { color: var(--accent, #2563eb); }
    .compNote { display: block; margin-top: 4px; font-size: 0.85em; color: var(--g555, #555); }
</style>

{#if cp}
    <div class="compBanner" role="note">
        <span class="compIcon">🚽🏆</span>
        <span class="compBody">
            <strong>Pick {cp.pick} — {cp.holderName}</strong> ({cp.holderOwner}) holds the {cp.season} compensatory
            pick for winning the {cp.wonYear} Toilet Bowl. It slots between rounds 1 and 2 and is fully tradable.
            <span class="compNote">Not shown on Sleeper's draft board — the commissioner inserts it manually on draft day.</span>
        </span>
    </div>
{/if}
