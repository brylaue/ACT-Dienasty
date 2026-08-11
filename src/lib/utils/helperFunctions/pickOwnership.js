import { leagueID } from "$lib/utils/leagueInfo";
import { retryFetch } from "$lib/utils/errorHandler";
import { waitForAll } from "./multiPromise";
import { getTradeValues, valueForPick } from "./tradeAnalysis";

/*
  Future draft pick ownership.

  Every franchise starts each future season owning its own picks 1..rounds;
  Sleeper's traded_picks endpoint then tells us which ones have moved.
  Pick values come from FantasyCalc (same source as the Trade-o-Meter) to
  rank total draft capital per team.
*/

const getJson = async (url) => {
  const res = await retryFetch(url);
  if (!res.ok) throw new Error(`${res.status} for ${url}`);
  return res.json();
};

export const getPickMatrix = async () => {
  const [league, drafts, tradedPicks] = await waitForAll(
    getJson(`https://api.sleeper.app/v1/league/${leagueID}`),
    getJson(`https://api.sleeper.app/v1/league/${leagueID}/drafts`),
    getJson(`https://api.sleeper.app/v1/league/${leagueID}/traded_picks`),
  );

  const currentSeason = parseInt(league.season);
  const totalRosters = league.total_rosters || 12;
  const rounds = drafts?.[0]?.settings?.rounds || 4;

  // include the current season only if its rookie draft hasn't happened yet
  const currentDraft = (drafts || []).find(
    (d) => parseInt(d.season) == currentSeason,
  );
  const seasons = [];
  if (!currentDraft || currentDraft.status != "complete") {
    seasons.push(currentSeason);
  }
  seasons.push(currentSeason + 1, currentSeason + 2);

  // ownership[season][round][originalRosterID] = current owner rosterID
  const ownership = {};
  for (const season of seasons) {
    ownership[season] = {};
    for (let round = 1; round <= rounds; round++) {
      ownership[season][round] = {};
      for (let orig = 1; orig <= totalRosters; orig++) {
        ownership[season][round][orig] = orig;
      }
    }
  }
  for (const pick of tradedPicks || []) {
    const season = parseInt(pick.season);
    if (!ownership[season]?.[pick.round]) continue;
    ownership[season][pick.round][pick.roster_id] = pick.owner_id;
  }

  // invert: holdings[ownerRosterID][season][round] = [originRosterID, ...]
  const holdings = {};
  for (let r = 1; r <= totalRosters; r++) {
    holdings[r] = {};
    for (const season of seasons) {
      holdings[r][season] = {};
      for (let round = 1; round <= rounds; round++) {
        holdings[r][season][round] = [];
      }
    }
  }
  for (const season of seasons) {
    for (let round = 1; round <= rounds; round++) {
      for (let orig = 1; orig <= totalRosters; orig++) {
        const owner = ownership[season][round][orig];
        if (holdings[owner]) {
          holdings[owner][season][round].push(orig);
        }
      }
    }
  }

  // FantasyCalc draft capital totals (best effort - matrix works without it)
  let capital = null;
  try {
    const values = await getTradeValues();
    capital = {};
    for (let r = 1; r <= totalRosters; r++) {
      let total = 0;
      let count = 0;
      for (const season of seasons) {
        for (let round = 1; round <= rounds; round++) {
          for (const _origin of holdings[r][season][round]) {
            total += valueForPick(values.picks, season, round);
            count++;
          }
        }
      }
      capital[r] = { total, count };
    }
  } catch (err) {
    console.error("FantasyCalc unavailable for draft capital:", err);
  }

  return { seasons, rounds, totalRosters, holdings, capital };
};
