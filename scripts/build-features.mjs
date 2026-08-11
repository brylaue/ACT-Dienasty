/*
  Bakes two whole-league snapshots every week, current season only:
  - static/data/power-rankings.json: composite ranking (record + points +
    dynasty roster value) with one fresh AI blurb per team
  - static/data/playoff-odds.json: Monte Carlo playoff-probability sim
    using each team's real scoring so far and the real remaining schedule

  Unlike commentary.json (which caches forever per transaction/week), both
  files here are FULLY REGENERATED every run - they're whole-league state
  that's supposed to change as the season moves, not a per-event archive.

  Requires ANTHROPIC_API_KEY for the Power Rankings blurbs; if it's
  missing, blurbs are skipped but the rankings/odds themselves (pure math,
  no AI needed) still bake normally.

  Run weekly (GitHub Action, same cron as the rest of the league-data bake)
  or manually: ANTHROPIC_API_KEY=sk-... node scripts/build-features.mjs
*/
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const API_KEY = process.env.ANTHROPIC_API_KEY;
// Overridable via ANTHROPIC_MODEL repo variable - see build-commentary.mjs
const MODEL = process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001";

const leagueInfo = readFileSync(join(root, "src/lib/utils/leagueInfo.js"), "utf8");
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

const askClaudeJSON = async (system, user) => {
  if (!API_KEY) return null;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 800,
        system,
        messages: [{ role: "user", content: user }],
      }),
    });
    if (!res.ok) {
      console.warn(`Claude API error ${res.status}: ${await res.text()}`);
      return null;
    }
    const data = await res.json();
    const text = data.content?.find((b) => b.type === "text")?.text?.trim();
    if (!text) return null;
    return JSON.parse(text.replace(/^```(json)?/i, "").replace(/```$/, "").trim());
  } catch (err) {
    console.warn(`Claude JSON call failed: ${err}`);
    return null;
  }
};

// --- gather current-season league state ---

const league = await get(`https://api.sleeper.app/v1/league/${leagueID}`);
const rosters = await get(`https://api.sleeper.app/v1/league/${leagueID}/rosters`);
const users = await get(`https://api.sleeper.app/v1/league/${leagueID}/users`);
const playoffTeams = league.settings?.playoff_teams || 6;
const playoffWeekStart = league.settings?.playoff_week_start || 15;

const userById = Object.fromEntries(users.map((u) => [u.user_id, u]));
const teamName = (roster) => {
  const u = userById[roster.owner_id];
  return u?.metadata?.team_name || u?.display_name || `Team ${roster.roster_id}`;
};

// FantasyCalc dynasty values, for the roster-strength component
const fcRaw = await get(
  "https://api.fantasycalc.com/values/current?isDynasty=true&numQbs=2&numTeams=12&ppr=0.5",
);
const fcValues = {};
for (const entry of fcRaw) {
  if (entry.player?.sleeperId) fcValues[entry.player.sleeperId] = entry.value;
}

const teams = rosters.map((r) => {
  const rosterValue = (r.players || []).reduce((sum, pid) => sum + (fcValues[pid] || 0), 0);
  const fpts = (r.settings?.fpts || 0) + (r.settings?.fpts_decimal || 0) / 100;
  const fptsAgainst = (r.settings?.fpts_against || 0) + (r.settings?.fpts_against_decimal || 0) / 100;
  return {
    rosterID: r.roster_id,
    name: teamName(r),
    wins: r.settings?.wins || 0,
    losses: r.settings?.losses || 0,
    ties: r.settings?.ties || 0,
    fpts,
    fptsAgainst,
    rosterValue,
  };
});

// --- per-team weekly score history, from the already-baked rivalry data
// (this script runs after build-rivalry-data.mjs in the workflow) ---

const RIVALRY_PATH = join(root, "static/data/rivalry-matchups.json");
let weeklyScores = {}; // rosterID -> [scores]
let playedWeeks = [];
if (existsSync(RIVALRY_PATH)) {
  const rivalry = JSON.parse(readFileSync(RIVALRY_PATH, "utf8"));
  const season = rivalry.seasons?.[leagueID];
  if (season) {
    season.weeks.forEach((w, ix) => {
      if (!w) return;
      playedWeeks.push(ix + 1);
      for (const matchupID in w) {
        for (const entry of w[matchupID]) {
          const pts = (entry.points || []).reduce((s, v) => s + (v || 0), 0);
          (weeklyScores[entry.roster_id] ||= []).push(pts);
        }
      }
    });
  }
}

const leagueAvgScores = Object.values(weeklyScores).flat();
const leagueMean = leagueAvgScores.length
  ? leagueAvgScores.reduce((a, b) => a + b, 0) / leagueAvgScores.length
  : 100;
const leagueStdev = leagueAvgScores.length > 1
  ? Math.sqrt(
      leagueAvgScores.reduce((s, v) => s + (v - leagueMean) ** 2, 0) / (leagueAvgScores.length - 1),
    )
  : 20;

const meanStdevFor = (rosterID) => {
  const scores = weeklyScores[rosterID] || [];
  if (scores.length < 2) return { mean: leagueMean, stdev: leagueStdev };
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  const stdev = Math.sqrt(scores.reduce((s, v) => s + (v - mean) ** 2, 0) / (scores.length - 1));
  return { mean, stdev: stdev || leagueStdev * 0.5 };
};

// ============================================================
// POWER RANKINGS
// ============================================================

const norm = (val, arr) => {
  const min = Math.min(...arr);
  const max = Math.max(...arr);
  return max > min ? (val - min) / (max - min) : 0.5;
};

const winPcts = teams.map((t) => t.wins / Math.max(t.wins + t.losses + t.ties, 1));
const fptsArr = teams.map((t) => t.fpts);
const valueArr = teams.map((t) => t.rosterValue);

const ranked = teams
  .map((t, ix) => ({
    ...t,
    composite:
      0.5 * norm(winPcts[ix], winPcts) +
      0.3 * norm(t.fpts, fptsArr) +
      0.2 * norm(t.rosterValue, valueArr),
  }))
  .sort((a, b) => b.composite - a.composite)
  .map((t, ix) => ({ ...t, rank: ix + 1 }));

const blurbs = await askClaudeJSON(
  `You write short, punchy one-line blurbs for a fantasy football dynasty league's weekly Power Rankings. Deadpan, confident, a little cocky for teams near the top and a little pitying for teams near the bottom - but never mean-spirited. Reply with ONLY a JSON object mapping each rosterID (as a string) to a blurb under 15 words, no trailing period. Vary phrasing and structure widely across teams - don't reuse the same setup twice.`,
  `Current Power Rankings (rank, team, record, points for, roster dynasty value):\n${ranked
    .map((t) => `${t.rank}. ${t.name} — ${t.wins}-${t.losses}${t.ties ? `-${t.ties}` : ""}, ${t.fpts.toFixed(1)} pts, roster value ${Math.round(t.rosterValue)}`)
    .join("\n")}\n\nWrite one blurb per team, keyed by this rosterID mapping:\n${ranked.map((t) => `"${t.rosterID}": rank ${t.rank}`).join("\n")}`,
);

for (const t of ranked) {
  t.blurb = blurbs?.[String(t.rosterID)] || null;
}

mkdirSync(join(root, "static/data"), { recursive: true });
writeFileSync(
  join(root, "static/data/power-rankings.json"),
  JSON.stringify({ generated: new Date().toISOString(), teams: ranked }),
);
console.log(`wrote static/data/power-rankings.json (${ranked.length} teams)`);

// ============================================================
// PLAYOFF ODDS (Monte Carlo)
// ============================================================

const remainingWeeks = [];
for (let w = 1; w < playoffWeekStart; w++) {
  if (!playedWeeks.includes(w)) remainingWeeks.push(w);
}

// try to get the real remaining schedule (pairings) from Sleeper; if a
// week has no pairings yet, that week just re-pairs randomly in the sim
const schedule = {};
for (const w of remainingWeeks) {
  try {
    const matchups = await get(`https://api.sleeper.app/v1/league/${leagueID}/matchups/${w}`);
    const pairs = {};
    for (const m of matchups || []) {
      if (m.matchup_id == null) continue;
      (pairs[m.matchup_id] ||= []).push(m.roster_id);
    }
    schedule[w] = Object.values(pairs).filter((p) => p.length === 2);
  } catch {
    schedule[w] = null;
  }
}

const gaussian = (mean, stdev) => {
  const u1 = Math.random() || 1e-9;
  const u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return mean + z * stdev;
};

const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

const SIMS = 3000;
const madePlayoffs = Object.fromEntries(teams.map((t) => [t.rosterID, 0]));

for (let sim = 0; sim < SIMS; sim++) {
  const state = Object.fromEntries(
    teams.map((t) => [t.rosterID, { wins: t.wins, losses: t.losses, ties: t.ties, fpts: t.fpts }]),
  );

  for (const w of remainingWeeks) {
    let pairs = schedule[w];
    if (!pairs || !pairs.length) {
      pairs = [];
      const ids = shuffle(teams.map((t) => t.rosterID));
      for (let i = 0; i < ids.length - 1; i += 2) pairs.push([ids[i], ids[i + 1]]);
    }
    for (const [a, b] of pairs) {
      const { mean: ma, stdev: sa } = meanStdevFor(a);
      const { mean: mb, stdev: sb } = meanStdevFor(b);
      const scoreA = Math.max(gaussian(ma, sa), 0);
      const scoreB = Math.max(gaussian(mb, sb), 0);
      state[a].fpts += scoreA;
      state[b].fpts += scoreB;
      if (scoreA > scoreB) state[a].wins++, state[b].losses++;
      else if (scoreB > scoreA) state[b].wins++, state[a].losses++;
      else state[a].ties++, state[b].ties++;
    }
  }

  const finalOrder = teams
    .map((t) => ({ rosterID: t.rosterID, ...state[t.rosterID] }))
    .sort((x, y) => y.wins - x.wins || y.fpts - x.fpts);

  finalOrder.slice(0, playoffTeams).forEach((t) => madePlayoffs[t.rosterID]++);
}

const odds = teams
  .map((t) => ({
    rosterID: t.rosterID,
    name: t.name,
    wins: t.wins,
    losses: t.losses,
    ties: t.ties,
    playoffPct: Math.round((madePlayoffs[t.rosterID] / SIMS) * 1000) / 10,
  }))
  .sort((a, b) => b.playoffPct - a.playoffPct);

writeFileSync(
  join(root, "static/data/playoff-odds.json"),
  JSON.stringify({
    generated: new Date().toISOString(),
    playoffTeams,
    remainingWeeks: remainingWeeks.length,
    simulations: SIMS,
    teams: odds,
  }),
);
console.log(`wrote static/data/playoff-odds.json (${odds.length} teams, ${remainingWeeks.length} weeks remaining, ${SIMS} sims)`);
