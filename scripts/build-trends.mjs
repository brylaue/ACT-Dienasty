/*
  Trends ledger: one snapshot per bake of every team's rank, roster value,
  playoff odds and record - so the site can show incline/decline over any
  period instead of a single "vs last bake" arrow.

  Backfill (runs once, idempotent): reconstructs each roster's composition
  at monthly checkpoints from Jan 1 of the current season by rewinding every
  completed transaction (trades, waivers, drops, the rookie draft) from
  today's rosters, then values each snapshot at TODAY's FantasyCalc prices.
  That is a benchmark of roster BUILDING - what each manager assembled -
  not a record of historical market prices (which nobody archives).
  Values everywhere in this file = players + future picks, so points are
  comparable with each other.

  Output: static/data/trends.json
    { generated, season, teams: {rosterID: name}, points: [
        { d: "2026-01-01", week: null, source: "backfill", teams: {rid: {rank: null, valueRank, value}} },
        { d: "2026-08-31", week: 1, source: "bake", teams: {rid: {rank, valueRank, value, playoffPct, wins, losses, ties}} }
    ] }
*/
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { leagueID } from "../src/lib/utils/leagueInfo.js";
import { valueForPick } from "../src/lib/utils/helperFunctions/tradeClassification.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(root, "static/data/trends.json");
const get = async (url) => {
  const r = await fetch(url, { headers: { "user-agent": "act-dienasty-trends" } });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
};
const day = (ms) => new Date(ms).toISOString().slice(0, 10);

const state = await get("https://api.sleeper.app/v1/state/nfl");
const season = Number(state.league_season || state.season);
const league = await get(`https://api.sleeper.app/v1/league/${leagueID}`);
const rosters = await get(`https://api.sleeper.app/v1/league/${leagueID}/rosters`);
const tradedPicks = await get(`https://api.sleeper.app/v1/league/${leagueID}/traded_picks`);
const fcRaw = await get("https://api.fantasycalc.com/values/current?isDynasty=true&numQbs=2&numTeams=12&ppr=0.5");
const fcPlayers = {};
const fcPicks = [];
for (const e of fcRaw) {
  if (e.player?.sleeperId) fcPlayers[e.player.sleeperId] = e.value;
  else fcPicks.push({ name: e.player?.name || "", value: e.value });
}
const pickValue = (s, r) => valueForPick(fcPicks, s, r);

const rosterIDs = rosters.map((r) => r.roster_id);
const pickKey = (p) => `${p.season}-${p.round}-${p.roster_id}`; // roster_id = original owner

// --- current state ---------------------------------------------------------
const now = {};
for (const r of rosters) now[r.roster_id] = { players: new Set(r.players || []), picks: new Set() };
// every future pick: original owner holds it unless traded_picks says otherwise (last hop wins)
const futureSeasons = [season + 1, season + 2, season + 3];
const currentOwner = {};
for (const tp of tradedPicks) currentOwner[pickKey(tp)] = tp.owner_id; // Sleeper appends hops chronologically
for (const s of futureSeasons) for (const round of [1, 2, 3, 4]) for (const orig of rosterIDs) {
  const key = `${s}-${round}-${orig}`;
  const owner = currentOwner[key] ?? orig;
  now[owner]?.picks.add(key);
}

// --- events to rewind (newest first) --------------------------------------
const events = [];
const maxLeg = Math.max(1, Number(state.week) || 1);
for (let leg = 1; leg <= maxLeg + 1; leg++) {
  let txs = [];
  try { txs = await get(`https://api.sleeper.app/v1/league/${leagueID}/transactions/${leg}`); } catch { /* no such leg */ }
  for (const t of txs || []) {
    if (t.status !== "complete") continue;
    events.push({ at: t.status_updated || t.created, adds: t.adds || {}, drops: t.drops || {}, picks: t.draft_picks || [] });
  }
}
// the rookie draft: each selection added a player and consumed a pick
try {
  const draft = await get(`https://api.sleeper.app/v1/draft/${league.draft_id}`);
  if (draft.status === "complete") {
    const slotToRoster = draft.slot_to_roster_id || {};
    const picks = await get(`https://api.sleeper.app/v1/draft/${league.draft_id}/picks`);
    const at = draft.last_picked || draft.start_time || Date.now();
    for (const p of picks) {
      const orig = slotToRoster[p.draft_slot] ?? p.roster_id;
      events.push({ at, adds: { [p.player_id]: p.roster_id }, drops: {}, picks: [], consumed: { key: `${season}-${p.round}-${orig}`, by: p.roster_id } });
    }
  }
} catch { /* no draft data - checkpoints before the draft just carry the rookies */ }
events.sort((a, b) => b.at - a.at);

// --- checkpoints ------------------------------------------------------------
const checkpoints = [];
for (let m = 1; m <= 12; m++) {
  const d = new Date(Date.UTC(season, m - 1, 1, 12));
  if (d.getTime() < Date.now() - 36e5) checkpoints.push(d);
}
const valueOf = (st) => {
  let v = 0;
  for (const pid of st.players) v += fcPlayers[pid] || 0;
  for (const key of st.picks) { const [s, r] = key.split("-").map(Number); v += pickValue(s, r); }
  return Math.round(v);
};
const rankAll = (values) => {
  const order = Object.entries(values).sort((a, b) => b[1] - a[1]).map(([rid]) => Number(rid));
  return Object.fromEntries(order.map((rid, i) => [rid, i + 1]));
};

const backfillPoints = [];
for (const cp of checkpoints) {
  // deep copy of now, then undo everything that happened after the checkpoint
  const st = {};
  for (const rid of rosterIDs) st[rid] = { players: new Set(now[rid].players), picks: new Set(now[rid].picks) };
  for (const ev of events) {
    if (ev.at <= cp.getTime()) break;
    for (const [pid, rid] of Object.entries(ev.adds)) st[rid]?.players.delete(pid);
    for (const [pid, rid] of Object.entries(ev.drops)) st[rid]?.players.add(pid);
    for (const p of ev.picks) {
      const key = pickKey(p);
      st[p.owner_id]?.picks.delete(key);
      st[p.previous_owner_id]?.picks.add(key);
    }
    if (ev.consumed) st[ev.consumed.by]?.picks.add(ev.consumed.key);
  }
  const values = Object.fromEntries(rosterIDs.map((rid) => [rid, valueOf(st[rid])]));
  const ranks = rankAll(values);
  backfillPoints.push({
    d: day(cp.getTime()),
    week: null,
    source: "backfill",
    teams: Object.fromEntries(rosterIDs.map((rid) => [rid, { rank: null, valueRank: ranks[rid], value: values[rid] }])),
  });
}

// --- today's live point -----------------------------------------------------
const readJSON = (p) => (existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null);
const pr = readJSON(join(root, "static/data/power-rankings.json"));
const odds = readJSON(join(root, "static/data/playoff-odds.json"));
const prBy = Object.fromEntries((pr?.teams || []).map((t) => [t.rosterID, t]));
const oddsBy = Object.fromEntries((odds?.teams || []).map((t) => [t.rosterID, t]));
const liveValues = Object.fromEntries(rosterIDs.map((rid) => [rid, valueOf(now[rid])]));
const liveRanks = rankAll(liveValues);
const today = {
  d: day(Date.now()),
  week: state.season_type === "regular" && state.week > 0 ? Number(state.week) : null,
  source: "bake",
  teams: Object.fromEntries(rosterIDs.map((rid) => [rid, {
    rank: prBy[rid]?.rank ?? null, // composite power rank (bake only)
    valueRank: liveRanks[rid], // roster-value rank (comparable with backfill)
    value: liveValues[rid],
    playoffPct: oddsBy[rid]?.playoffPct ?? null,
    wins: prBy[rid]?.wins ?? 0,
    losses: prBy[rid]?.losses ?? 0,
    ties: prBy[rid]?.ties ?? 0,
  }])),
};

// --- merge with the existing ledger ----------------------------------------
const existing = readJSON(OUT);
const sameSeason = existing && existing.season === season;
let points = sameSeason ? existing.points.filter((p) => p.source !== "backfill") : [];
const hasBackfill = sameSeason && existing.points.some((p) => p.source === "backfill");
// keep the first backfill ever computed (it's a benchmark, not a moving target)
points = [...(hasBackfill ? existing.points.filter((p) => p.source === "backfill") : backfillPoints), ...points];
points = points.filter((p) => p.d !== today.d || p.source === "backfill");
points.push(today);
points.sort((a, b) => a.d.localeCompare(b.d));

const names = {};
for (const r of rosters) names[r.roster_id] = prBy[r.roster_id]?.name?.trim() || `Team ${r.roster_id}`;
writeFileSync(OUT, JSON.stringify({
  generated: new Date().toISOString(),
  season,
  about: "Backfill points reconstruct roster composition at monthly checkpoints, valued at the prices on the day the backfill ran. Bake points are live snapshots. Values = players + future picks (FantasyCalc superflex 0.5 PPR).",
  teams: names,
  points,
}, null, 1));
console.log(`wrote static/data/trends.json (${points.length} points: ${points.filter((p) => p.source === "backfill").length} backfill + ${points.filter((p) => p.source === "bake").length} bake; ${events.length} events rewound)`);
