import { leagueID, managers } from "$lib/utils/leagueInfo";
import { get } from "svelte/store";
import { teamManagersStore } from "$lib/stores";
import { waitForAll } from "./multiPromise";
import { getManagers, getTeamData } from "./universalFunctions";
import { getLeagueData } from "./leagueData";
import { retryFetch } from "$lib/utils/errorHandler";

export const getLeagueTeamManagers = async () => {
  if (get(teamManagersStore) && get(teamManagersStore).currentSeason) {
    return get(teamManagersStore);
  }
  let currentLeagueID = leagueID;
  let teamManagersMap = {};
  let finalUsers = {};
  let currentSeason = null;

  // loop through all seasons and create a [year][roster_id]: team, managers object
  while (currentLeagueID && currentLeagueID != 0) {
    const [usersRaw, leagueData, rostersRaw] = await waitForAll(
      retryFetch(`https://api.sleeper.app/v1/league/${currentLeagueID}/users`),
      getLeagueData(currentLeagueID),
      retryFetch(
        `https://api.sleeper.app/v1/league/${currentLeagueID}/rosters`,
      ),
    );

    if (!leagueData || leagueData.error) {
      throw new Error(
        `Failed to load league data for league ${currentLeagueID}`,
      );
    }
    if (!usersRaw.ok || !rostersRaw.ok) {
      throw new Error(
        `Sleeper API error loading users/rosters for league ${currentLeagueID}`,
      );
    }

    const [users, rosters] = await waitForAll(
      usersRaw.json(),
      rostersRaw.json(),
    );

    const year = parseInt(leagueData.season);
    currentLeagueID = leagueData.previous_league_id;
    if (!currentSeason) {
      currentSeason = year;
    }
    teamManagersMap[year] = {};
    const processedUsers = processUsers(users);

    // in order to not overwrite most recent data, only add new entries to finalUsers
    for (const processedUserKey in processedUsers) {
      if (finalUsers[processedUserKey]) continue;
      finalUsers[processedUserKey] = processedUsers[processedUserKey];
    }
    for (const roster of rosters) {
      teamManagersMap[year][roster.roster_id] = {
        team: getTeamData(processedUsers, roster.owner_id),
        managers: getManagers(roster, processedUsers),
      };
    }
  }
  const response = {
    currentSeason,
    teamManagersMap,
    users: finalUsers,
  };
  teamManagersStore.update(() => response);
  return response;
};

const processUsers = (rawUsers) => {
  let finalUsers = {};
  for (const user of rawUsers) {
    user.user_name = user.user_name ?? user.display_name;
    finalUsers[user.user_id] = user;
    const manager = managers.find((m) => m.managerID === user.user_id);
    if (manager) {
      finalUsers[user.user_id].display_name = manager.name;
    }
  }
  return finalUsers;
};
