<script>
    import {round} from '$lib/utils/helper'
    import { getRosterIDFromManagerID } from '$lib/utils/helperFunctions/universalFunctions';
	import RecordsAndRankings from './RecordsAndRankings.svelte';

    let { key, leagueManagerRecords, leagueTeamManagers, leagueWeekHighs, leagueWeekLows, allTimeBiggestBlowouts, allTimeClosestMatchups, mostSeasonLongPoints, leastSeasonLongPoints, transactionTotals } = $props();

    let winPercentages = $state([]);
    let lineupIQs = $state([]);
    let fptsHistories = $state([]);
    let tradesData = $state([]);
    let waiversData = $state([]);

    let showTies = $state(false);
    
    for(const managerID in transactionTotals.allTime) {
        tradesData.push({
            managerID,
            trades: transactionTotals.allTime[managerID].trade,
        })
        waiversData.push({
            managerID,
            waivers: transactionTotals.allTime[managerID].waiver,
        })
    }


    const setRankingsData = (lRR) => {
        winPercentages = [];
        lineupIQs = [];
        fptsHistories = [];
        tradesData = [];
        waiversData = [];
        showTies = false;

        // Aggregate data by team/roster instead of individual managers
        const teamAggregatedData = {};

        for(const managerID in lRR) {
            const leagueManagerRecord = lRR[managerID];
            const rosterInfo = getRosterIDFromManagerID(leagueTeamManagers, managerID);
            const rosterID = rosterInfo ? rosterInfo.rosterID : null;
            
            if (!rosterID) continue;

            if (!teamAggregatedData[rosterID]) {
                teamAggregatedData[rosterID] = {
                    rosterID: rosterID,
                    wins: 0,
                    ties: 0,
                    losses: 0,
                    fptsFor: 0,
                    fptsAgainst: 0,
                    potentialPoints: 0,
                    trades: 0,
                    waivers: 0,
                    managerIDs: new Set(),
                    teamName: null
                };
            }

            // Aggregate stats for this team
            const teamData = teamAggregatedData[rosterID];
            teamData.wins += leagueManagerRecord.wins;
            teamData.ties += leagueManagerRecord.ties;
            teamData.losses += leagueManagerRecord.losses;
            teamData.fptsFor += leagueManagerRecord.fptsFor;
            teamData.fptsAgainst += leagueManagerRecord.fptsAgainst;
            if (leagueManagerRecord.potentialPoints) {
                teamData.potentialPoints += leagueManagerRecord.potentialPoints;
            }
            teamData.managerIDs.add(managerID);

            // Get team name from current season
            if (!teamData.teamName && leagueTeamManagers.teamManagersMap[leagueTeamManagers.currentSeason]?.[rosterID]) {
                teamData.teamName = leagueTeamManagers.teamManagersMap[leagueTeamManagers.currentSeason][rosterID].team.name;
            }
        }

        // Add transaction data
        for(const managerID in transactionTotals.allTime) {
            const rosterInfo = getRosterIDFromManagerID(leagueTeamManagers, managerID);
            const rosterID = rosterInfo ? rosterInfo.rosterID : null;
            
            if (!rosterID) continue;

            if (!teamAggregatedData[rosterID]) {
                teamAggregatedData[rosterID] = {
                    rosterID: rosterID,
                    wins: 0,
                    ties: 0,
                    losses: 0,
                    fptsFor: 0,
                    fptsAgainst: 0,
                    potentialPoints: 0,
                    trades: 0,
                    waivers: 0,
                    managerIDs: new Set(),
                    teamName: null
                };
            }

            teamAggregatedData[rosterID].trades += transactionTotals.allTime[managerID].trade;
            teamAggregatedData[rosterID].waivers += transactionTotals.allTime[managerID].waiver;
            teamAggregatedData[rosterID].managerIDs.add(managerID);
        }

        // Convert aggregated data to display format
        for(const rosterID in teamAggregatedData) {
            const teamData = teamAggregatedData[rosterID];
            const denominator = (teamData.wins + teamData.ties + teamData.losses) > 0 ? (teamData.wins + teamData.ties + teamData.losses) : 1;
            
            winPercentages.push({
                rosterID: rosterID,
                teamName: teamData.teamName,
                managerIDs: Array.from(teamData.managerIDs),
                percentage: round((teamData.wins + teamData.ties / 2) / denominator * 100),
                wins: teamData.wins,
                ties: teamData.ties,
                losses: teamData.losses,
            })

            let lineupIQ = {
                rosterID: rosterID,
                teamName: teamData.teamName,
                managerIDs: Array.from(teamData.managerIDs),
                fpts: round(teamData.fptsFor),
            }

            if(teamData.potentialPoints > 0) {
                lineupIQ.iq = round(teamData.fptsFor / teamData.potentialPoints * 100);
                lineupIQ.potentialPoints = round(teamData.potentialPoints);
            }

            lineupIQs.push(lineupIQ)
        
            fptsHistories.push({
                rosterID: rosterID,
                teamName: teamData.teamName,
                managerIDs: Array.from(teamData.managerIDs),
                fptsFor: round(teamData.fptsFor),
                fptsAgainst: round(teamData.fptsAgainst),
                fptsPerGame: round(teamData.fptsFor / denominator),
            })

            tradesData.push({
                rosterID: rosterID,
                teamName: teamData.teamName,
                managerIDs: Array.from(teamData.managerIDs),
                trades: teamData.trades,
            })

            waiversData.push({
                rosterID: rosterID,
                teamName: teamData.teamName,
                managerIDs: Array.from(teamData.managerIDs),
                waivers: teamData.waivers,
            })
        
            if(teamData.ties > 0) showTies = true;
        }

        winPercentages.sort((a, b) => b.percentage - a.percentage);
        lineupIQs.sort((a, b) => b.iq - a.iq);
        fptsHistories.sort((a, b) => b.fptsFor - a.fptsFor);
        tradesData.sort((a, b) => b.trades - a.trades);
        waiversData.sort((a, b) => b.waivers - a.waivers);
    }

    $effect(() => {
        setRankingsData(leagueManagerRecords);
    });
</script>

<RecordsAndRankings
    blowouts={allTimeBiggestBlowouts}
    closestMatchups={allTimeClosestMatchups}
    weekRecords={leagueWeekHighs}
    weekLows={leagueWeekLows}
    seasonLongRecords={mostSeasonLongPoints}
    seasonLongLows={leastSeasonLongPoints}
    {showTies}
    {winPercentages}
    {fptsHistories}
    {lineupIQs}
    {tradesData}
    {waiversData}
    prefix="All-Time"
    allTime={true}
    {leagueTeamManagers}
    {key}
/>
