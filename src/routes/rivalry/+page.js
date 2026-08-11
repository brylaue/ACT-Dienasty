import {
  getLeagueTeamManagers,
  loadPlayers,
  getLeagueTransactions,
} from "$lib/utils/helper";

export async function load({ url, fetch }) {
  const teamOne = url?.searchParams?.get("team_one");
  const teamTwo = url?.searchParams?.get("team_two");

  return {
    leagueTeamManagerData: getLeagueTeamManagers(),
    playersData: loadPlayers(fetch),
    transactionsData: getLeagueTransactions(),
    teamOne: teamOne ? parseInt(teamOne) : null,
    teamTwo: teamTwo ? parseInt(teamTwo) : null,
  };
}
