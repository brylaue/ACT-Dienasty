<script>
    import { goto } from "$app/navigation";
	import { getDatesActive, getRosterIDFromManagerID, getTeamNameFromTeamManagers } from "$lib/utils/helperFunctions/universalFunctions";
    import {dynasty} from "$lib/utils/leagueInfo"

    let { manager, leagueTeamManagers, key } = $props();

    let retired = false;

    // manager.roster is deprecated, pages should be using managerID now
    let rosterID = manager.roster;
    let year = null;

    if(manager.managerID) {
        const dates = getDatesActive(leagueTeamManagers, manager.managerID);
        if(dates.end) retired = true;

        ({rosterID, year} = getRosterIDFromManagerID(leagueTeamManagers, manager.managerID) || {rosterID, year});
    }

    const commissioner = manager.managerID ? leagueTeamManagers.users[manager.managerID].is_owner : false;
</script>

<style>
    .manager {
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        align-items: center;
        gap: 0.75em;
        padding: 1em;
        background-color: var(--fff);
        background-repeat: no-repeat;
        background-position: 15% 50%;
        margin: 0.5em 0;
        border-radius: 2em;
        border: 1px solid var(--ccc);
        box-shadow: 0 0 6px 0 var(--bbb);
        cursor: pointer;
    }

    .manager:hover {
        box-shadow: 0 0 10px 0 bar(--g999);
        background-color: bar(--eee);
    }

    .primary {
        display: flex;
        align-items: center;
        gap: 0.75em;
        flex: 1 1 260px;
        min-width: 0;
    }

    .identity {
        display: flex;
        flex-direction: column;
        min-width: 0;
    }

    .photo {
        height: 40px;
        width: 40px;
        border-radius: 100%;
        vertical-align: middle;
        box-shadow: 0 0 2px 1px var(--bbb);
    }

    .name {
        text-align: left;
        display: block;
        color: var(--g555);
        line-height: 1.2em;
        font-weight: 700;
    }

    .team {
        text-align: left;
        display: block;
        font-style: italic;
        line-height: 1.2em;
        color: var(--g555);
        font-weight: 300;
        margin-top: 0.25em;
    }

    .info {
        display: flex;
        flex-wrap: wrap;
        justify-content: flex-end;
        gap: 0.5em;
        flex: 1 1 300px;
    }

    .infoSlot {
        text-align: center;
        margin: 0;
        width: 63px;
        flex: 0 0 auto;
    }

    .infoIcon {
        display: inline-flex;
        height: 40px;
        width: 40px;
        justify-content: center;
        align-items: center;
        border-radius: 100%;
        border: 1px solid #ccc;
        overflow: hidden;
        background-color: var(--fff);
    }

    .infoImg {
        height: 30px;
    }

    .infoAnswer {
        font-size: 0.8em;
        color: var(--g555);
        width: 63px;
        text-align: center;
        line-height: 1.2em;
    }

    .contactLink {
        text-decoration: none;
        color: inherit;
        cursor: pointer;
    }

    .contactLink:hover .infoIcon {
        border-color: var(--blueTwo, #1976d2);
        box-shadow: 0 0 4px var(--blueTwo, #1976d2);
    }

    .contactLink:hover .infoAnswer {
        color: var(--blueTwo, #1976d2);
    }

    .avatarHolder {
        display: inline-flex;
        position: relative;
    }

    .commissionerBadge {
        display: flex;
        justify-content: center;
        align-items: center;
        position: absolute;
        bottom: -10px;
        right: -10px;
        height: 25px;
        width: 25px;
        font-weight: 600;
        border-radius: 15px;
        background-color: var(--blueTwo);
        border: 1px solid var(--blueOne);
        color: #fff;
    }

    @media (max-width: 700px) {
        .manager {
            padding: 0.85em;
        }

        .primary {
            flex: 1 1 100%;
        }

        .info {
            justify-content: flex-start;
        }

        .infoSlot {
            width: 58px;
        }
    }

	@media (max-width: 665px) {
        .name {
            font-size: 0.9em;
        }

        .team {
            font-size: 0.8em;
        }
    }

	@media (max-width: 595px) {
        .manager {
            padding: 0.75em;
            margin: 0.3em 0;
            border-radius: 1.5em;
            flex-direction: column;
            align-items: flex-start;
            gap: 0.5em;
        }

        .commissionerBadge {
            height: 15px;
            width: 15px;
            font-size: 0.8em;
        }

        .info {
            width: 100%;
            gap: 0.4em;
        }

        .infoSlot {
            text-align: center;
            margin: 0;
            width: 56px;
        }

        .infoIcon {
            height: 30px;
            width: 30px;
        }

        .infoImg {
            height: 25px;
        }

        .infoAnswer {
            font-size: 0.7em;
            width: 56px;
        }
    }

    @media (max-width: 475px) {
        .primary {
            width: 100%;
        }

        .name {
            font-size: 0.8em;
        }

        .team {
            font-size: 0.7em;
        }

        .photo {
            height: 25px;
            width: 25px;
        }

        .infoSlot {
            text-align: center;
            margin: 0 0.4em;
            width: 49px;
        }

        .infoIcon {
            height: 25px;
            width: 25px;
        }

        .infoImg {
            height: 22px;
        }

        .infoAnswer {
            font-size: 0.6em;
            width: 49px;
        }
    }

    @media (max-width: 370px) {
        .infoTeam {
            display: none;
        }
    }

    .question {
        background-color: #fff;
    }
</style>

<div class="manager" style="{retired ? "background-image: url(/retired.png); background-color: var(--ddd)": ""}" onclick={() => goto(`/manager?manager=${key}`)}>
    <div class="primary">
        <div class="avatarHolder">
            <img class="photo" src="{manager.photo}" alt="{manager.name}" />
            {#if commissioner}
                <div class="commissionerBadge">
                    <span>C</span>
                </div>
            {/if}
        </div>
        <div class="identity">
            <div class="name">{manager.name}</div>
            <div class="team">{getTeamNameFromTeamManagers(leagueTeamManagers, rosterID, year)}</div>
        </div>
    </div>
    <div class="info">
        <!-- Favorite team (optional) -->
        <div class="infoSlot infoTeam">
            {#if manager.favoriteTeam}
                <div class="infoIcon">
                    <img class="infoImg" src="https://sleepercdn.com/images/team_logos/nfl/{manager.favoriteTeam}.png" alt="favorite team"/>
                </div>
            {:else}
                <div class="infoIcon question">
                    <img class="infoImg" src="/managers/question.jpg" alt="favorite team"/>
                </div>
            {/if}
        </div>
        <!-- Preferred contact -->
        <div class="infoSlot">
            {#if manager.preferredContact}
                {#if manager.preferredContact === 'Text' && manager.phoneNumber}
                    <a class="contactLink" href="sms:{manager.phoneNumber.replace(/\D/g, '')}" onclick={(e) => e.stopPropagation()}>
                        <div class="infoIcon">
                            <img class="infoImg" src="/{manager.preferredContact}.png" alt="{manager.preferredContact}"/>
                        </div>
                        <div class="infoAnswer">
                            {manager.phoneNumber}
                        </div>
                    </a>
                {:else}
                    <div class="infoIcon">
                        <img class="infoImg" src="/{manager.preferredContact}.png" alt="{manager.preferredContact}"/>
                    </div>
                    <div class="infoAnswer">
                        {manager.preferredContact}
                    </div>
                {/if}
            {:else}
                <div class="infoIcon question">
                    <img class="infoImg" src="/managers/question.jpg" alt="favorite team"/>
                </div>
            {/if}
        </div>
        <!-- Rebuild mode (optional and only displayed for dynasty leagues) -->
        {#if dynasty}
            <div class="infoSlot infoRebuild">
                {#if manager.mode}
                    <div class="infoIcon">
                        <img class="infoImg" src="/{manager.mode.replace(' ', '%20')}.png" alt="win now or rebuild"/>
                    </div>
                    <div class="infoAnswer">
                        {manager.mode}
                    </div>
                {:else}
                    <div class="infoIcon question">
                        <img class="infoImg" src="/managers/question.jpg" alt="favorite team"/>
                    </div>
                {/if}
            </div>
        {/if}
    </div>
</div>