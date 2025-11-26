<script>
    import { dreamDraftLocationImages, managerModeImages, beverageImages } from '$lib/utils/leagueInfo';

    export let viewManager, players, changeManager;

    const normalizeKey = (value) =>
        typeof value === 'string'
            ? value.trim().toLowerCase().replace(/\s+/g, ' ')
            : null;

    $: normalizedMode = normalizeKey(viewManager.mode);
    $: modeIcon = normalizedMode ? managerModeImages[normalizedMode] : null;

    $: normalizedBeverage = normalizeKey(viewManager.beverage);
    $: beverageIcon = normalizedBeverage ? beverageImages[normalizedBeverage] : null;
</script>

<style>
    .fantasyInfos {
        display: flex;
        justify-content: space-around;
        align-items: flex-start;
        flex-wrap: wrap;
        padding: 0 0 2em;
        margin: 3em 0 4em;
        border-bottom: 1px solid var(--aaa);
        border-top: 1px solid var(--aaa);
        box-shadow: 0 0 8px 4px var(--ccc);
    }

    .dreamLocation {
        height: 60px;
    }

    .infoSlot {
        text-align: center;
        margin: 1.5em 0.8em 0;
    }

    .infoIcon {
        display: inline-flex;
        height: 64px;
        width: 64px;
        justify-content: center;
        align-items: center;
        border-radius: 100%;
        border: 1px solid var(--ccc);
        overflow: hidden;
        background-color: var(--fff);
		transition: box-shadow 0.4s;
    }

    .playerIcon {
        align-items:flex-end;
    }

    .infoLabel {
        font-size: 0.7em;
        color: var(--blueOne);
        font-weight: 700;
        margin-bottom: 0.8em;
        min-height: 28px;
        width: 80px;
        text-align: center;
        line-height: 1.2em;
    }

    .infoAnswer {
        font-size: 0.8em;
        color: var(--g555);
        margin-top: 0.8em;
        width: 80px;
        text-align: center;
        line-height: 1.2em;
    }

    .tradingScale {
        line-height: 64px;
        font-size: 48px;
        color: var(--blueOne);
    }

    .rookiesOrVets {
        height: 58px;
        vertical-align: middle;
    }

    .infoRival {
        cursor: pointer;
    }

    .infoRival:hover .infoIcon {
        box-shadow: 0 0 6px 4px var(--aaa);
        border: 1px solid var(--aaa);
    }

    .rival {
        height: 100%;
    }

    .rebuildOrWin {
        height: 64px;
    }

    .valuePosition {
        line-height: 64px;
        font-size: 24px;
        color: var(--fff);
    }

    .QB {
        background-color: var(--QB);
    }

    .WR {
        background-color: var(--WR);
    }

    .RB {
        background-color: var(--RB);
    }

    .TE {
        background-color: var(--TE);
    }

    .Picks {
        background: #73b647;
    }
    .K {
        background-color: var(--K);
    }

    .DEF {
        background-color: var(--DEF);
    }

    .CB {
        background-color: #ffcc7a;
    }

    .SS {
        background-color: #b7a1db;
    }

    .FS {
        background-color: #ebe7b3;
    }

    .DE {
        background-color: #b1d0e9;
    }

    .DL {
        background-color: #c392d3;
    }

    .LB {
        background-color: #98c097;
    }

    .favoritePlayer {
        height: 58px;
        vertical-align: bottom;
    }

    .beverageIcon {
        height: 58px;
        width: 58px;
        object-fit: contain;
    }

    /* media queries */

    @media (max-width: 731px) {
        .infoSlot {
            margin: 2em 3em 0;
        }
    }

    @media (max-width: 558px) {
        .infoSlot {
            margin: 2em 2em 0;
        }
    }

    @media (max-width: 461px) {
        .infoSlot {
            margin: 2em 1em 0;
        }
    }
</style>

<div class="fantasyInfos">
    <!-- Rookies or Vets (optional) -->
    {#if viewManager.rookieOrVets}
        <div class="infoSlot">
            <div class="infoLabel">
                Rookie or Vet Preference
            </div>
            <div class="infoIcon">
                <img class="rookiesOrVets" src="/{viewManager.rookieOrVets}.png" alt="rookie or vet preference"/>
            </div>
            <div class="infoAnswer">
                {viewManager.rookieOrVets}
            </div>
        </div>
    {/if}
    <!-- Favorite fantasy position (optional) -->
    {#if viewManager.valuePosition}
        <div class="infoSlot">
            <div class="infoLabel">
                Favorite Fantasy Asset
            </div>
            <div class="infoIcon {viewManager.valuePosition}">
                <span class="valuePosition">{viewManager.valuePosition}</span>
            </div>
        </div>
    {/if}
    {#if viewManager.tradingScale}
        <!-- Trading Scale -->
        <div class="infoSlot">
            <div class="infoLabel">
                Desire to Trade
            </div>
            <div class="infoIcon">
                <span class="tradingScale">{viewManager.tradingScale}</span>
            </div>
            <div class="infoAnswer">
                {viewManager.tradingScale} out of 10
            </div>
        </div>
    {/if}
    {#if viewManager.dreamDraftLocation}
        <div class="infoSlot">
            <div class="infoLabel">
                Dream Draft Location
            </div>
            <div class="infoIcon">
                {#if dreamDraftLocationImages[viewManager.dreamDraftLocation]}
                    <img class="dreamLocation" src="{dreamDraftLocationImages[viewManager.dreamDraftLocation]}" alt="dream draft location icon"/>
                {:else}
                    <span class="valuePosition">{viewManager.dreamDraftLocation}</span>
                {/if}
            </div>
            <div class="infoAnswer">
                {viewManager.dreamDraftLocation}
            </div>
        </div>
    {/if}
    <!-- Favorite player (optioonal) -->
    {#if viewManager.favoritePlayer}
        <div class="infoSlot">
            <div class="infoLabel">
                Favorite Player
            </div>
            <div class="infoIcon playerIcon">
                <img class="favoritePlayer" src="https://sleepercdn.com/content/nfl/players/{viewManager.favoritePlayer}.jpg" alt="favorite player"/>
            </div>
            <div class="infoAnswer">
                {players[viewManager.favoritePlayer].fn} {players[viewManager.favoritePlayer].ln}
            </div>
        </div>
    {/if}
    <!-- Rebuild Mod (optional) -->
    {#if viewManager.mode}
        <div class="infoSlot">
            <div class="infoLabel">
                Win Now or Rebuild?
            </div>
            <div class="infoIcon">
                {#if modeIcon}
                    <img class="rebuildOrWin" src="{modeIcon}" alt="win now or rebuild"/>
                {:else}
                    <img class="rebuildOrWin" src="/managers/question.jpg" alt="win now or rebuild"/>
                {/if}
            </div>
            <div class="infoAnswer">
                {viewManager.mode}
            </div>
        </div>
    {/if}
    {#if viewManager.beverage}
        <div class="infoSlot">
            <div class="infoLabel">
                Beverage of Choice
            </div>
            <div class="infoIcon">
                {#if beverageIcon}
                    <img class="beverageIcon" src="{beverageIcon}" alt="{viewManager.beverage} icon"/>
                {:else}
                    <span class="valuePosition">{viewManager.beverage}</span>
                {/if}
            </div>
            <div class="infoAnswer">
                {viewManager.beverage}
            </div>
        </div>
    {/if}
    <!-- Rival -->
    <div class="infoSlot infoRival" onclick={() => changeManager(viewManager.rival.link)}>
        <div class="infoLabel">
            Rival
        </div>
        <div class="infoIcon">
            <img class="rival" src="{viewManager.rival.image}" alt="rival"/>
        </div>
        <div class="infoAnswer">
            {viewManager.rival.name}
        </div>
    </div>
</div>