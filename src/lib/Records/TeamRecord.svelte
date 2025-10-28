<script>
    import { renderManagerNames } from '$lib/utils/helperFunctions/universalFunctions';

    export let teamName;
    export let managerIDs;
    export let leagueTeamManagers;
    export let rosterID;
    export let year = null;
    export let compressed = false;
    export let points = null;

    // Get current season if year not specified
    $: currentYear = year || leagueTeamManagers.currentSeason;
    
    // Get manager names for display
    $: managerNames = managerIDs && managerIDs.length > 0 ? managerIDs.map(managerID => {
        const user = leagueTeamManagers.users[managerID];
        return user ? user.display_name : 'Unknown Manager';
    }).join(', ') : 'Unknown Team';
    
    // Add co-owner indicator if multiple managers
    $: displayManagers = managerIDs && managerIDs.length > 1 ? 
        `Co-owners: ${managerNames}` : 
        managerNames;

    // Get team name from current season if not provided
    $: displayTeamName = teamName || (leagueTeamManagers.teamManagersMap[currentYear]?.[rosterID]?.team?.name) || 'Unknown Team';
</script>

<div class="team-record" class:compressed>
    {#if compressed}
        <div class="team-compressed">
            <div class="team-name">{displayTeamName}</div>
            {#if points !== null}
                <div class="points">{points}</div>
            {/if}
            <div class="managers">{displayManagers}</div>
        </div>
    {:else}
        <div class="team-full">
            <div class="team-name">{displayTeamName}</div>
            <div class="managers">{displayManagers}</div>
        </div>
    {/if}
</div>

<style>
    .team-record {
        display: flex;
        flex-direction: column;
        gap: 0.25em;
    }

    .team-compressed {
        display: flex;
        flex-direction: column;
        align-items: center;
        text-align: center;
        gap: 0.25em;
    }

    .team-full {
        display: flex;
        flex-direction: column;
        gap: 0.25em;
    }

    .team-name {
        font-weight: bold;
        font-size: 1em;
    }

    .managers {
        font-size: 0.85em;
        color: var(--g999);
        font-style: italic;
        line-height: 1.2;
    }

    .points {
        font-weight: bold;
        font-size: 1.1em;
    }

    .compressed .team-name {
        font-size: 0.9em;
    }

    .compressed .managers {
        font-size: 0.75em;
    }
</style>