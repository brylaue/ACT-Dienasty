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

    const getContactHref = (preferredContact, phoneNumber) => {
        const sanitized = phoneNumber?.replace(/[^\d+]/g, '');
        if (!sanitized) return null;
        return preferredContact && preferredContact.toLowerCase() === 'text'
            ? `sms:${sanitized}`
            : `tel:${sanitized}`;
    };

    const beverageIcons = {
        ipa: '/beverages/ipa.svg',
        negroni: '/beverages/negroni.svg',
        bourbon: '/beverages/bourbon.svg',
        'coors-light': '/beverages/coors-light.svg',
        'smokey-scotch': '/beverages/smokey-scotch.svg',
        'chocolate-milk': '/beverages/chocolate-milk.svg',
    };

    const getBeverageIcon = (beverage) => {
        if (!beverage) return null;
        const slug = beverage.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
        if (!slug) return '/beverages/beverage-default.svg';
        return beverageIcons[slug] || '/beverages/beverage-default.svg';
    };
</script>

<style>
    .manager {
        display: flex;
        justify-content: left;
        align-items: center;
        padding: 1em 0;
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

    .photo {
        height: 40px;
        width: 40px;
        border-radius: 100%;
        vertical-align: middle;
        margin-left: 1em;
        box-shadow: 0 0 2px 1px var(--bbb);
    }

    .name {
        text-align: center;
        display: inline-block;
        color: var(--g555);
        line-height: 1.2em;
        margin-left: 1em;
        font-weight: 700;
    }

    .team {
        text-align: center;
        display: inline-block;
        font-style: italic;
        line-height: 1.2em;
        color: var(--g555);
        font-weight: 300;
        margin-left: 1em;
    }

    .spacer {
        flex-grow: 1;
    }

    .info {
        display: flex;
    }

    .infoSlot {
        text-align: center;
        margin: 0 0.5em;
        width: 63px;
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
        display: block;
        color: inherit;
        text-decoration: none;
    }

    .contactNumber {
        display: block;
        margin-top: 0.2em;
        color: var(--blueTwo);
        font-weight: 600;
        word-break: break-word;
    }

    .contactNumber:hover {
        text-decoration: underline;
    }

    .infoBeverage .infoAnswer {
        font-size: 0.75em;
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

	@media (max-width: 665px) {
        .name {
            font-size: 0.9em;
            margin-left: 0.5em;
        }

        .team {
            font-size: 0.8em;
            margin-left: 0.5em;
        }
    }

	@media (max-width: 595px) {
        .manager {
            padding: 0.5em 0;
            margin: 0.3em 0;
            border-radius: 1.5em;
        }

        .photo {
            height: 30px;
            width: 30px;
            margin-left: 0.5em;
        }

        .commissionerBadge {
            height: 15px;
            width: 15px;
            font-size: 0.8em;
        }

        .infoSlot {
            text-align: center;
            margin: 0 0.4em;
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
        .name {
            font-size: 0.8em;
            margin-left: 0.4em;
        }

        .team {
            font-size: 0.7em;
            margin-left: 0.4em;
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
    <div class="avatarHolder">
        <img class="photo" src="{manager.photo}" alt="{manager.name}" />
        {#if commissioner}
            <div class="commissionerBadge">
                <span>C</span>
            </div>
        {/if}
    </div>
    <div class="name">{manager.name}</div>
    <div class="team">{getTeamNameFromTeamManagers(leagueTeamManagers, rosterID, year)}</div>
    <div class="spacer" />
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
                <div class="infoIcon">
                    <img class="infoImg" src="/{manager.preferredContact}.png" alt="{manager.preferredContact}"/>
                </div>
                <div class="infoAnswer">
                    {#if manager.phoneNumber}
                        {#if getContactHref(manager.preferredContact, manager.phoneNumber)}
                            <a class="contactLink" href={getContactHref(manager.preferredContact, manager.phoneNumber)}>
                                {manager.preferredContact}
                                <span class="contactNumber">{manager.phoneNumber}</span>
                            </a>
                        {:else}
                            <span class="contactLink">
                                {manager.preferredContact}
                                <span class="contactNumber">{manager.phoneNumber}</span>
                            </span>
                        {/if}
                    {:else}
                        {manager.preferredContact}
                    {/if}
                </div>
            {:else}
                <div class="infoIcon question">
                    <img class="infoImg" src="/managers/question.jpg" alt="favorite team"/>
                </div>
            {/if}
        </div>
        <!-- Beverage -->
        <div class="infoSlot infoBeverage">
            {#if manager.beverage}
                <div class="infoIcon">
                    <img class="infoImg" src="{getBeverageIcon(manager.beverage) || '/beverages/beverage-default.svg'}" alt="{manager.beverage}"/>
                </div>
                <div class="infoAnswer">
                    {manager.beverage}
                </div>
            {:else}
                <div class="infoIcon question">
                    <img class="infoImg" src="/managers/question.jpg" alt="beverage"/>
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