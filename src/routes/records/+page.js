import {
  getLeagueRecords,
  getLeagueTeamManagers,
  getLeagueTransactions,
  waitForAll,
} from "#lib/utils/helper.js";

export async function load() {
  const recordsInfo = waitForAll(
    getLeagueRecords(false),
    getLeagueTransactions(false),
    getLeagueTeamManagers(),
  );

  return {
    recordsInfo,
  };
}
