import { leagueID } from "$lib/utils/leagueInfo";
import { loadSeason } from "./rivalryMatchups";

/*
  Luck Index: actual record vs "all-play" record.

  All-play imagines every team played every other team every week. A team's
  all-play win% is how good they actually were; the gap between their real
  win% and all-play win% is schedule luck. Runs entirely on the pre-baked
  matchup data.
*/

const blank = () => ({
  wins: 0,
  losses: 0,
  ties: 0,
  apWins: 0,
  apLosses: 0,
  apTies: 0,
});

const totalPoints = (side) =>
  (side.points || []).reduce((t, v) => t + (v || 0), 0);

export const getLuckIndex = async () => {
  const byYear = {};
  let cur = leagueID;

  while (cur && cur != 0) {
    let season;
    try {
      season = await loadSeason(cur);
    } catch (err) {
      console.error(`Luck index skipping ${cur}:`, err);
      break;
    }

    const yearTally = {};
    const ensure = (r) => (yearTally[r] = yearTally[r] || blank());

    for (const groups of season.weeks) {
      if (!groups) continue;
      const scores = [];
      for (const matchupID in groups) {
        const pair = groups[matchupID];
        if (pair.length != 2) continue;
        const [a, b] = pair;
        const aPts = totalPoints(a);
        const bPts = totalPoints(b);
        if (aPts == 0 && bPts == 0) continue;
        scores.push([a.roster_id, aPts], [b.roster_id, bPts]);
        // actual head-to-head result
        if (aPts > bPts) {
          ensure(a.roster_id).wins++;
          ensure(b.roster_id).losses++;
        } else if (aPts < bPts) {
          ensure(b.roster_id).wins++;
          ensure(a.roster_id).losses++;
        } else {
          ensure(a.roster_id).ties++;
          ensure(b.roster_id).ties++;
        }
      }
      // all-play: compare every team's score to every other team's that week
      for (const [rosterID, pts] of scores) {
        const t = ensure(rosterID);
        for (const [otherID, otherPts] of scores) {
          if (otherID == rosterID) continue;
          if (pts > otherPts) t.apWins++;
          else if (pts < otherPts) t.apLosses++;
          else t.apTies++;
        }
      }
    }

    if (Object.keys(yearTally).length) {
      byYear[season.year] = yearTally;
    }
    cur = season.previousLeagueID;
  }

  // aggregate all-time
  const all = {};
  for (const year in byYear) {
    for (const rosterID in byYear[year]) {
      all[rosterID] = all[rosterID] || blank();
      for (const k in byYear[year][rosterID]) {
        all[rosterID][k] += byYear[year][rosterID][k];
      }
    }
  }

  const finalize = (tally) => {
    const rows = [];
    for (const rosterID in tally) {
      const t = tally[rosterID];
      const games = t.wins + t.losses + t.ties;
      const apGames = t.apWins + t.apLosses + t.apTies;
      if (!games) continue;
      const winPct = (t.wins + t.ties * 0.5) / games;
      const apPct = apGames ? (t.apWins + t.apTies * 0.5) / apGames : 0;
      rows.push({
        rosterID: parseInt(rosterID),
        ...t,
        winPct,
        apPct,
        luck: (winPct - apPct) * 100,
      });
    }
    rows.sort((a, b) => b.luck - a.luck);
    return rows;
  };

  const years = Object.keys(byYear).sort((a, b) => b - a);
  const result = { years, all: finalize(all), byYear: {} };
  for (const year of years) {
    result.byYear[year] = finalize(byYear[year]);
  }
  return result;
};
