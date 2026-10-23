import { getAwards, getLeagueTeamManagers } from "#lib/utils/helper.js";

export async function load() {
  const awardsData = getAwards();
  const teamManagersData = getLeagueTeamManagers();

  return {
    awardsData,
    teamManagersData,
  };
}
