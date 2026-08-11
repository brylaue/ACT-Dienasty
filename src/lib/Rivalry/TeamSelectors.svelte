<script>
	import { goto } from "$app/navigation";
	import { getFranchises } from "$lib/utils/helperFunctions/rivalryMatchups";

    export let teamOne, teamTwo, leagueTeamManagers;

    const franchises = getFranchises(leagueTeamManagers);
    const franchiseFor = (rosterID) => franchises.find((f) => f.rosterID == rosterID);

    $: optionsOne = franchises.filter(f => f.rosterID != teamTwo);
    $: optionsTwo = franchises.filter(f => f.rosterID != teamOne);

    const analyzeRivalry = (t1, t2) => {
        if(!t1 || !t2) {
            return;
        }
        goto(`/rivalry?team_one=${t1}&team_two=${t2}`, {noscroll: true, keepfocus: true})
    }

    $: analyzeRivalry(teamOne, teamTwo)
</script>

<style>
    .selectors {
        display: flex;
        justify-content: space-evenly;
        align-items: flex-start;
        max-width: 900px;
        margin: 3em auto 2em;
    }
    .team {
        text-align: center;
        max-width: 300px;
    }
    .vs {
        display: inline-block;
        margin: 1em 0;
    }
    .container {
        display: inline-block;
        position: relative;
    }
    .selectInput {
        padding: 0.5em 2em;
        font-size: 1.2em;
        border-radius: 6px;
        background-color: var(--fff);
        appearance: none !important;
        -webkit-appearance: none !important;
        -moz-appearance: none !important;
        background-image: url(/dropdown.png);
        background-repeat: no-repeat;
        text-align: center;
        color: var(--g000);
        max-width: 280px;
        text-overflow: ellipsis;
    }
    .left {
        border: 1px solid var(--barChartOne);
        background-position: 100%;
    }
    select.left:focus {
        outline: none;
        border: 3px solid var(--barChartOne);
    }
    .right {
        border: 1px solid var(--barChartSix);
        background-position: 0%;
    }
    select.right:focus {
        outline: none;
        border: 3px solid var(--barChartSix);
    }
    select option {
        text-align: left;
    }
    .avatar {
        width: 60px;
        height: 60px;
        border-radius: 50%;
        border: 2px solid;
        position: absolute;
        transform: translate(0%, -50%);
        top: 50%;
        background-color: var(--fff);
    }
    .avatarLeft {
        border-color: var(--barChartOne);
        border-right: none;
        left: -18%
    }
    .avatarRight {
        border-color: var(--barChartSix);
        border-left: none;
        right: -18%
    }
    .aka {
        font-size: 0.7em;
        font-style: italic;
        color: var(--g999);
        margin-top: 0.5em;
        line-height: 1.4;
    }
    @media (max-width: 650px) {
        .selectInput {
            padding: 0.3em 1.9em;
            font-size: 1em;
            max-width: 220px;
        }
        .avatar {
            width: 40px;
            height: 40px;
        }
        .avatarLeft {
            left: -12%
        }
        .avatarRight {
            right: -12%
        }
    }
    @media (max-width: 530px) {
        .selectors {
            flex-direction: column;
            align-items: center;
        }
        .avatarRight {
            border-right: none;
            left: -12%
        }
        .right {
            background-position: 100%;
        }
    }
</style>

<div class="selectors">
    <!-- franchise 1 -->
    <div class="team">
        <div class="container">
            <select class="selectInput left" id="teamOne" name="teamOne" bind:value={teamOne}>
                <option value={null}>Select a team</option>
                {#each optionsOne as franchise}
                    <option value={franchise.rosterID}>{franchise.name}</option>
                {/each}
            </select>
            {#if teamOne && franchiseFor(teamOne)}
                <img class="avatar avatarLeft" src="{franchiseFor(teamOne).avatar}" alt="team one avatar"/>
            {/if}
        </div>
        {#if teamOne && franchiseFor(teamOne)?.formerNames.length}
            <div class="aka">a.k.a. {franchiseFor(teamOne).formerNames.join(", ")}</div>
        {/if}
    </div>
    <!-- vs -->
    <span class="vs">vs</span>
    <!-- franchise 2 -->
    <div class="team">
        <div class="container">
            <select class="selectInput right" id="teamTwo" name="teamTwo" bind:value={teamTwo}>
                <option value={null}>Select a team</option>
                {#each optionsTwo as franchise}
                    <option value={franchise.rosterID}>{franchise.name}</option>
                {/each}
            </select>
            {#if teamTwo && franchiseFor(teamTwo)}
                <img class="avatar avatarRight" src="{franchiseFor(teamTwo).avatar}" alt="team two avatar"/>
            {/if}
        </div>
        {#if teamTwo && franchiseFor(teamTwo)?.formerNames.length}
            <div class="aka">a.k.a. {franchiseFor(teamTwo).formerNames.join(", ")}</div>
        {/if}
    </div>
</div>
