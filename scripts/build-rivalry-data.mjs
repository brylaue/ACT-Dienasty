/*
  Bakes the league's full matchup history into static/data/rivalry-matchups.json.

  Run weekly (GitHub Action) or manually: node scripts/build-rivalry-data.mjs
  The site loads this file instead of hammering the Sleeper API with ~120
  requests per visitor; only the current in-progress season is fetched live.
*/
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// pull the league ID straight from the app config so there's one source of truth
const leagueInfo = readFileSync(
  join(root, "src/lib/utils/leagueInfo.js"),
  "utf8",
);
const leagueID = leagueInfo.match(/leagueID\s*=\s*"(\d+)"/)?.[1];
if (!leagueID) throw new Error("Could not find leagueID in leagueInfo.js");

const get = async (url, retries = 5) => {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url);
      if (res.ok) return res.json();
      if (attempt >= retries) throw new Error(`${res.status} for ${url}`);
    } catch (err) {
      if (attempt >= retries) throw err;
    }
    await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
  }
};

const groupWeek = (entries) => {
  if (!entries || !entries.length) return null;
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
  // unplayed future weeks bake as null so the app knows to skip them
  return hasPoints ? groups : null;
};

const seasons = {};
const chain = [];
let cur = leagueID;

while (cur && cur != 0) {
  const league = await get(`https://api.sleeper.app/v1/league/${cur}`);
  const playoffWeekStart = league.settings.playoff_week_start || 15;

  const weekPromises = [];
  for (let i = 1; i < playoffWeekStart; i++) {
    weekPromises.push(
      get(`https://api.sleeper.app/v1/league/${cur}/matchups/${i}`),
    );
  }
  // any failed fetch throws and aborts the bake: better no commit than a
  // committed file with silent holes in the history
  const weeksRaw = await Promise.all(weekPromises);

  // playoff games come from the winners bracket (consolation games are not
  // playoffs, so the losers bracket is ignored)
  const bracket = await get(
    `https://api.sleeper.app/v1/league/${cur}/winners_bracket`,
  ).catch(() => []);
  const playoffGames = [];
  const playoffWeeks = {};
  const resolved = (bracket || []).filter(
    (g) => Number.isInteger(g.t1) && Number.isInteger(g.t2),
  );
  if (resolved.length) {
    const weeksNeeded = [
      ...new Set(resolved.map((g) => playoffWeekStart + g.r - 1)),
    ];
    const weekData = await Promise.all(
      weeksNeeded.map((w) =>
        get(`https://api.sleeper.app/v1/league/${cur}/matchups/${w}`),
      ),
    );
    weeksNeeded.forEach((w, ix) => {
      const grouped = groupWeek(weekData[ix]);
      if (grouped) playoffWeeks[w] = grouped;
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

  seasons[cur] = {
    year: league.season,
    status: league.status,
    previousLeagueID: league.previous_league_id,
    weeks: weeksRaw.map(groupWeek),
    playoffWeeks,
    playoffGames,
  };
  chain.push(cur);
  console.log(
    `baked ${league.season} (${league.status}): ${seasons[cur].weeks.filter(Boolean).length} played weeks, ${playoffGames.length} playoff games`,
  );
  cur = league.previous_league_id;
}

const output = {
  generated: new Date().toISOString(),
  leagueID,
  chain,
  seasons,
};

mkdirSync(join(root, "static/data"), { recursive: true });
writeFileSync(
  join(root, "static/data/rivalry-matchups.json"),
  JSON.stringify(output),
);
console.log(
  `wrote static/data/rivalry-matchups.json (${chain.length} seasons)`,
);

/*
  Transactions archive: raw Sleeper transaction arrays for COMPLETED seasons,
  baked once and reused forever. Without this, four pages (/transactions,
  /records, /rivalry, /manager) each trigger ~160 browser requests to Sleeper
  on a cold load (9 seasons x 18 weeks), ~145 of which re-fetch history that
  can never change. The client (leagueTransactions.js) loads this file and
  only fetches the current, still-in-progress season live.

  Incremental: seasons already in the file are never re-fetched, so after the
  first bake this step costs nothing until a season newly completes.
*/
const ARCHIVE_PATH = join(root, "static/data/transactions-archive.json");
let archive = { seasons: {} };
if (existsSync(ARCHIVE_PATH)) {
  try {
    archive = JSON.parse(readFileSync(ARCHIVE_PATH, "utf8"));
    archive.seasons ||= {};
  } catch {
    /* corrupt file - rebuild from scratch */
    archive = { seasons: {} };
  }
}

let archivedNew = 0;
for (const lid of chain) {
  if (seasons[lid].status !== "complete") continue; // only immutable seasons
  if (archive.seasons[lid]) continue; // already baked - free
  const weekPromises = [];
  for (let w = 1; w <= 18; w++) {
    weekPromises.push(
      get(`https://api.sleeper.app/v1/league/${lid}/transactions/${w}`).catch(
        () => [],
      ),
    );
  }
  const weeks = await Promise.all(weekPromises);
  const all = [];
  for (const weekTx of weeks) {
    if (Array.isArray(weekTx)) all.push(...weekTx);
  }
  archive.seasons[lid] = all;
  archivedNew++;
  console.log(
    `archived ${seasons[lid].year} transactions: ${all.length} entries`,
  );
}

if (archivedNew || !existsSync(ARCHIVE_PATH)) {
  archive.generated = new Date().toISOString();
  writeFileSync(ARCHIVE_PATH, JSON.stringify(archive));
  console.log(
    `wrote static/data/transactions-archive.json (${Object.keys(archive.seasons).length} completed seasons)`,
  );
} else {
  console.log("transactions archive unchanged (no newly completed seasons)");
}
