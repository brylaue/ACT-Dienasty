import { getLeagueTeamManagers } from "#lib/utils/helper.js";

export async function load() {
  return {
    leagueTeamManagerData: getLeagueTeamManagers(),
  };
}
