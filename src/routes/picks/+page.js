import { getLeagueTeamManagers } from "$lib/utils/helper";

export async function load() {
  return {
    leagueTeamManagerData: getLeagueTeamManagers(),
  };
}
