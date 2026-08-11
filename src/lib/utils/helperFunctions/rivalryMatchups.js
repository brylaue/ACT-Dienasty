import { getLeagueData } from "./leagueData";
import { leagueID } from "$lib/utils/leagueInfo";
import { waitForAll } from "./multiPromise";
import { retryFetch } from "$lib/utils/errorHandler";

/*
  Franchise-based rivalry engine.

  Rivalries are computed by roster ID (the franchise), not by manager/user ID.
  Roster IDs are stable across every season of a chained dynasty league, so
  ownership changes and display-name changes no longer split or lose history.

  Season matchup data is cached per league ID, so switching between rivalry
  pairs after the first load is instant instead of refetching ~120 weeks.
*/

// leagueID -> Promise<{ year, previousLeagueID, weeks }>
const seasonCache = {};

// Pre-baked matchup history, generated weekly by scripts/build-rivalry-data.mjs
// and committed to static/data/. One CDN-cached request covers every completed
// season; only the current in-progress season is fetched live from Sleeper.
let bakedPromise = null;
const loadBaked = () => {
  if (bakedPromise) return bakedPromise;
  bakedPromise = fetch("/data/rivalry-matchups.json")
    .then((res) => (res.ok ? res.json() : null))
    .catch(() => null);
  return bakedPromise;
};

export const loadSeason = (curLeagueID) => {
  if (seasonCache[curLeagueID]) return seasonCache[curLeagueID];
  seasonCache[curLeagueID] = (async () => {
    // completed seasons never change - serve them from the baked file
    const baked = await loadBaked();
    const bakedSeason = baked?.seasons?.[curLeagueID];
    if (bakedSeason && bakedSeason.status == "complete") {
      return bakedSeason;
    }

    const leagueData = await getLeagueData(curLeagueID);
    if (!leagueData || leagueData.error) {
      throw new Error(`Failed to load league data for ${curLeagueID}`);
    }
    const year = leagueData.season;
    const playoffWeekStart = leagueData.settings.playoff_week_start || 15;

    const matchupsPromises = [];
    for (let i = 1; i < playoffWeekStart; i++) {
      matchupsPromises.push(
        retryFetch(
          `https://api.sleeper.app/v1/league/${curLeagueID}/matchups/${i}`,
        )
          .then((res) => (res.ok ? res.json() : null))
          .catch(() => null),
      );
    }
    const weeksRaw = await waitForAll(...matchupsPromises);

    // group each week's entries by matchup_id once, so every rivalry pair
    // reuses the same pre-grouped data
    const weeks = weeksRaw.map((weekEntries) => {
      if (!weekEntries || !weekEntries.length) return null;
      const groups = {};
      for (const entry of weekEntries) {
        if (entry.matchup_id == null) continue;
        if (!groups[entry.matchup_id]) groups[entry.matchup_id] = [];
        groups[entry.matchup_id].push({
          roster_id: entry.roster_id,
          starters: entry.starters,
          points: entry.starters_points,
        });
      }
      return groups;
    });

    // playoff games come from the winners bracket (consolation excluded)
    const playoffGames = [];
    const playoffWeeks = {};
    try {
      const bracketRes = await retryFetch(
        `https://api.sleeper.app/v1/league/${curLeagueID}/winners_bracket`,
      );
      const bracket = bracketRes.ok ? await bracketRes.json() : [];
      const resolved = (bracket || []).filter(
        (g) => Number.isInteger(g.t1) && Number.isInteger(g.t2),
      );
      if (resolved.length) {
        const weeksNeeded = [
          ...new Set(resolved.map((g) => playoffWeekStart + g.r - 1)),
        ];
        const weekData = await waitForAll(
          ...weeksNeeded.map((w) =>
            retryFetch(
              `https://api.sleeper.app/v1/league/${curLeagueID}/matchups/${w}`,
            )
              .then((res) => (res.ok ? res.json() : null))
              .catch(() => null),
          ),
        );
        weeksNeeded.forEach((w, ix) => {
          const entries = weekData[ix];
          if (!entries || !entries.length) return;
          const groups = {};
          let hasPoints = false;
          for (const entry of entries) {
            if (entry.matchup_id == null) continue;
            if (!groups[entry.matchup_id]) groups[entry.matchup_id] = [];
            groups[entry.matchup_id].push({
              roster_id: entry.roster_id,
              starters: entry.starters,
              points: entry.starters_points,
            });
            if ((entry.points || 0) > 0) hasPoints = true;
          }
          if (hasPoints) playoffWeeks[w] = groups;
        });
        for (const g of resolved) {
          playoffGames.push({
            week: playoffWeekStart + g.r - 1,
            round: g.r,
            t1: g.t1,
            t2: g.t2,
            place: g.p ?? null,
          });
        }
      }
    } catch (err) {
      console.error("Playoff bracket load failed:", err);
    }

    return {
      year,
      previousLeagueID: leagueData.previous_league_id,
      weeks,
      playoffWeeks,
      playoffGames,
    };
  })().catch(async (err) => {
    // live fetch failed: last week's baked copy beats an error screen
    const baked = await loadBaked();
    if (baked?.seasons?.[curLeagueID]) {
      return baked.seasons[curLeagueID];
    }
    throw err;
  });
  // let a failed season be retried on the next selection
  seasonCache[curLeagueID].catch(() => {
    delete seasonCache[curLeagueID];
  });
  return seasonCache[curLeagueID];
};

const totalPoints = (side) =>
  (side.points || []).reduce((t, v) => t + (v || 0), 0);

const emptyRecord = () => ({ wins: 0, losses: 0, ties: 0, fpts: 0, games: 0 });

const tallyGame = (record, pts, oppPts) => {
  record.games++;
  record.fpts += pts;
  if (pts > oppPts) record.wins++;
  else if (pts < oppPts) record.losses++;
  else record.ties++;
};

export const getRivalryMatchups = async (rosterIDOne, rosterIDTwo) => {
  rosterIDOne = parseInt(rosterIDOne);
  rosterIDTwo = parseInt(rosterIDTwo);
  if (!rosterIDOne || !rosterIDTwo || rosterIDOne == rosterIDTwo) {
    return null;
  }

  const rivalry = {
    points: { one: 0, two: 0 },
    wins: { one: 0, two: 0 },
    ties: 0,
    matchups: [],
    // all-time regular season records for each franchise (vs the whole league)
    overall: { one: emptyRecord(), two: emptyRecord() },
    // head-to-head in the playoffs (winners bracket only)
    playoffs: {
      wins: { one: 0, two: 0 },
      ties: 0,
      points: { one: 0, two: 0 },
      meetings: 0,
    },
  };

  let curLeagueID = leagueID;
  while (curLeagueID && curLeagueID != 0) {
    let season;
    try {
      season = await loadSeason(curLeagueID);
    } catch (err) {
      console.error(`Skipping rivalry season ${curLeagueID}:`, err);
      break;
    }

    for (let weekIx = 0; weekIx < season.weeks.length; weekIx++) {
      const groups = season.weeks[weekIx];
      if (!groups) continue;
      const week = weekIx + 1;

      for (const matchupID in groups) {
        const pair = groups[matchupID];
        if (pair.length != 2) continue;
        const [a, b] = pair;
        const aPts = totalPoints(a);
        const bPts = totalPoints(b);
        // skip unplayed weeks (both sides at 0 in the future)
        if (aPts == 0 && bPts == 0) continue;

        // overall franchise records (any opponent)
        if (a.roster_id == rosterIDOne) tallyGame(rivalry.overall.one, aPts, bPts);
        if (b.roster_id == rosterIDOne) tallyGame(rivalry.overall.one, bPts, aPts);
        if (a.roster_id == rosterIDTwo) tallyGame(rivalry.overall.two, aPts, bPts);
        if (b.roster_id == rosterIDTwo) tallyGame(rivalry.overall.two, bPts, aPts);

        // head-to-head
        const ids = [a.roster_id, b.roster_id];
        if (ids.includes(rosterIDOne) && ids.includes(rosterIDTwo)) {
          const one = a.roster_id == rosterIDOne ? a : b;
          const two = a.roster_id == rosterIDOne ? b : a;
          const onePts = totalPoints(one);
          const twoPts = totalPoints(two);
          rivalry.points.one += onePts;
          rivalry.points.two += twoPts;
          if (onePts > twoPts) rivalry.wins.one++;
          else if (onePts < twoPts) rivalry.wins.two++;
          else rivalry.ties++;
          rivalry.matchups.push({
            week,
            year: season.year,
            matchup: [one, two],
          });
        }
      }
    }

    // head-to-head playoff meetings (winners bracket games only)
    for (const game of season.playoffGames || []) {
      const ids = [game.t1, game.t2];
      if (!(ids.includes(rosterIDOne) && ids.includes(rosterIDTwo))) continue;
      const groups = season.playoffWeeks?.[game.week];
      if (!groups) continue;
      let one = null;
      let two = null;
      for (const matchupID in groups) {
        for (const entry of groups[matchupID]) {
          if (entry.roster_id == rosterIDOne) one = entry;
          if (entry.roster_id == rosterIDTwo) two = entry;
        }
      }
      if (!one || !two) continue;
      const onePts = totalPoints(one);
      const twoPts = totalPoints(two);
      if (onePts == 0 && twoPts == 0) continue;
      rivalry.playoffs.meetings++;
      rivalry.playoffs.points.one += onePts;
      rivalry.playoffs.points.two += twoPts;
      if (onePts > twoPts) rivalry.playoffs.wins.one++;
      else if (onePts < twoPts) rivalry.playoffs.wins.two++;
      else rivalry.playoffs.ties++;
      rivalry.matchups.push({
        week: game.week,
        year: season.year,
        matchup: [one, two],
        playoff: true,
        place: game.place,
      });
    }

    curLeagueID = season.previousLeagueID;
  }

  rivalry.matchups.sort((a, b) => b.year - a.year || b.week - a.week);
  return rivalry;
};

/*
  Build the franchise list for the selector: one entry per current roster,
  with the full name history ("a.k.a.") across all seasons.
*/
export const getFranchises = (leagueTeamManagers) => {
  const currentSeason = leagueTeamManagers.currentSeason;
  const map = leagueTeamManagers.teamManagersMap;
  const years = Object.keys(map)
    .map(Number)
    .sort((a, b) => b - a);

  const franchises = [];
  const currentRosters = map[currentSeason] || {};
  for (const rosterID in currentRosters) {
    const current = currentRosters[rosterID].team;
    const names = [];
    for (const year of years) {
      const entry = map[year]?.[rosterID];
      if (!entry) continue;
      const name = entry.team?.name;
      if (name && name != current.name && !names.includes(name)) {
        names.push(name);
      }
    }
    franchises.push({
      rosterID: parseInt(rosterID),
      name: current.name,
      avatar: current.avatar,
      formerNames: names,
    });
  }
  franchises.sort((a, b) => a.name.localeCompare(b.name));
  return franchises;
};
