// Bakes static/data/matchups-archive.json: full per-player box scores for
// every week in league history. Completed seasons are immutable, so this is
// incremental - once a season is archived it is never refetched. The current
// season refreshes every run until it completes.
//
// Shape: { generated, seasons: { [year]: { leagueID, lineup: [slot,...],
//   weeks: [ [ { r: rosterID, m: matchupID, pts, starters: [ids],
//               pp: { playerID: points } } ] ] } } }
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(root, "static/data/matchups-archive.json");

const get = async (url) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
};

const leagueIDFile = readFileSync(join(root, "src/lib/utils/leagueInfo.js"), "utf8");
const currentLid = leagueIDFile.match(/leagueID\s*=\s*["'](\d+)["']/)[1];

const existing = existsSync(OUT)
  ? JSON.parse(readFileSync(OUT, "utf8"))
  : { seasons: {} };

// walk the league chain oldest-known info from each league object
const chain = [];
let lid = currentLid;
while (lid && lid !== "0") {
  const lg = await get(`https://api.sleeper.app/v1/league/${lid}`);
  chain.push(lg);
  lid = lg.previous_league_id;
}

const state = await get("https://api.sleeper.app/v1/state/nfl");
const out = { generated: new Date().toISOString(), seasons: existing.seasons || {} };

for (const lg of chain) {
  const year = lg.season;
  const isComplete = lg.status === "complete";
  if (isComplete && out.seasons[year]?.complete) continue; // immutable, skip

  const lastWeek = (lg.settings?.playoff_week_start || 15) + 2; // through championship
  const weeks = [];
  for (let wk = 1; wk <= lastWeek; wk++) {
    let ms = [];
    try {
      ms = await get(`https://api.sleeper.app/v1/league/${lg.league_id}/matchups/${wk}`);
    } catch { /* week unavailable */ }
    weeks.push(
      (ms || [])
        .filter((m) => m && m.roster_id != null)
        .map((m) => ({
          r: m.roster_id,
          m: m.matchup_id,
          pts: m.points ?? 0,
          starters: m.starters || [],
          pp: Object.fromEntries(
            Object.entries(m.players_points || {}).map(([id, p]) => [id, Math.round((p || 0) * 100) / 100])
          ),
        }))
    );
  }
  out.seasons[year] = {
    leagueID: lg.league_id,
    complete: isComplete,
    lineup: (lg.roster_positions || []).filter((p) => p !== "BN"),
    weeks,
  };
  console.log(`season ${year}: ${weeks.reduce((a, w) => a + w.length, 0)} team-weeks${isComplete ? " (complete, frozen)" : " (in progress)"}`);
}

writeFileSync(OUT, JSON.stringify(out));
console.log(`wrote ${OUT} (${Math.round(JSON.stringify(out).length / 1024)}KB)`);
