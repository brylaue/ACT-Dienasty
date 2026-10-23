import { getLeagueStandings, getLeagueTeamManagers } from "#lib/utils/helper.js";

export async function load() {
  const standingsData = getLeagueStandings();
  const leagueTeamManagersData = getLeagueTeamManagers();

  return {
    standingsData,
    leagueTeamManagersData,
  };
}
