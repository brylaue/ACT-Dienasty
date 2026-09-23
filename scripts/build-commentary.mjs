/*
  Bakes fresh, AI-written one-liners for Trade-o-Meter verdicts, waiver
  headlines, and Tuesday Roundup recap flavor lines into
  static/data/commentary.json, keyed by transaction id (trades/waivers) or
  "year-week" (recaps).

  Why: the old approach picked from small hardcoded pools of ~4-5 lines per
  category, so with enough activity the same jokes started repeating. This
  script asks Claude for fresh lines - one per NEW trade/waiver transaction,
  one JSON call per newly-finished week for the recap - and never
  regenerates ones already baked, so ongoing cost stays tiny. The site
  substitutes {W}/{L}/{T}/{A}/{D} tokens (trades/waivers) or just displays
  the recap phrases directly, client-side, exactly like it always did with
  the template pools - see src/lib/utils/helperFunctions/tradeAnalysis.js,
  waiverHeadlines.js, and src/lib/Recap/index.svelte.

  Each transaction/week gets its own independent API call with no memory of
  any other call - left unchecked, that makes the model converge on the
  same handful of go-to phrases across many calls (in practice,
  "irreconcilable differences" alone showed up in 10 of the first 49 waiver
  lines). To prevent that, every call is shown a sample of recently
  generated lines and told not to reuse them, plus a couple of the worst
  offending stock phrases are explicitly banned outright.

  Only bakes commentary for the CURRENT season's leagueID (src/lib/utils/
  leagueInfo.js) - it never walks into previous_league_id / prior seasons,
  so 2025 and earlier are never touched. Next season, updating leagueID the
  same way you always do is all that's needed for this to follow along.

  Requires the ANTHROPIC_API_KEY secret. If it's not set, this step logs a
  warning and exits without writing anything - the site just keeps using
  the template pool as a fallback, so a missing/expired key never breaks
  the weekly data refresh for the rest of the site.

  Run on the weekly cron, the 30-min poll cron (see
  .github/workflows/poll-commentary.yml), or manually:
  ANTHROPIC_API_KEY=sk-... node scripts/build-commentary.mjs
*/
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { classifyTrade, valueForPick } from "../src/lib/utils/helperFunctions/tradeClassification.js";
import { classifyWaiver } from "../src/lib/utils/helperFunctions/waiverHeadlines.js";
import { sleeperPlayers } from "./lib/sleeperPlayers.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_PATH = join(root, "static/data/commentary.json");
// Model is overridable via the ANTHROPIC_MODEL env var (set it as a repo
// Variable in GitHub Settings > Secrets and variables > Actions > Variables
// to experiment without a code change - e.g. "claude-sonnet-4-6" for
// better joke variety, or "claude-fable-5" for the strongest/priciest).
// Haiku default: cheap/fast is plenty for one-liners.
const MODEL = process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001";

const API_KEY = process.env.ANTHROPIC_API_KEY;
if (!API_KEY) {
  console.warn(
    "ANTHROPIC_API_KEY not set - skipping AI commentary bake. " +
      "The site will keep using the template line pool as a fallback. " +
      "Add the secret in GitHub repo Settings > Secrets and variables > Actions to enable fresh takes.",
  );
  process.exit(0);
}

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

// --- gather trade + waiver transactions for the CURRENT season only ---
// (2026 leagueID above, no walk into previous_league_id / prior seasons -
// by design: history from 2025 and earlier is never baked or re-baked,
// this only ever looks at the current season's leagueID going forward)

const league = await get(`https://api.sleeper.app/v1/league/${leagueID}`);
const seasonsRaw = [{ id: leagueID, league }];

const allTransactions = [];
for (const { id } of seasonsRaw) {
  const weekPromises = [];
  for (let w = 1; w <= 18; w++) {
    weekPromises.push(
      get(`https://api.sleeper.app/v1/league/${id}/transactions/${w}`).catch(
        () => [],
      ),
    );
  }
  const weeks = await Promise.all(weekPromises);
  for (const weekTx of weeks) {
    if (Array.isArray(weekTx)) allTransactions.push(...weekTx);
  }
}

// minimal, self-contained version of the client's digestTransaction: just
// enough shape for classifyTrade/classifyWaiver (id, type, rosters, moves)
const digest = (transaction) => {
  if (transaction.status == "failed") return null;
  const rosters = transaction.roster_ids;
  const bid = transaction.settings?.waiver_bid;
  const moves = [];
  const handled = [];

  for (const player in transaction.adds || {}) {
    if (!player) continue;
    handled.push(player);
    const move = new Array(rosters.length).fill(null);
    const ownerIx = rosters.indexOf(transaction.adds[player]);
    if (transaction.drops && transaction.drops[player]) {
      move[ownerIx] = { type: "trade", player };
      move[rosters.indexOf(transaction.drops[player])] = "origin";
    } else {
      move[ownerIx] = { type: "Added", player, bid };
    }
    moves.push(move);
  }
  for (const player in transaction.drops || {}) {
    if (handled.indexOf(player) > -1 || !player) continue;
    const move = new Array(rosters.length).fill(null);
    move[rosters.indexOf(transaction.drops[player])] = {
      type: "Dropped",
      player,
    };
    moves.push(move);
  }
  for (const pick of transaction.draft_picks || []) {
    const move = new Array(rosters.length).fill(null);
    move[rosters.indexOf(pick.owner_id)] = {
      type: "trade",
      pick: { season: pick.season, round: pick.round },
    };
    move[rosters.indexOf(pick.previous_owner_id)] = "origin";
    moves.push(move);
  }
  for (const wb of transaction.waiver_budget || []) {
    const move = new Array(rosters.length).fill(null);
    move[rosters.indexOf(wb.receiver)] = {
      type: "trade",
      budget: { amount: wb.amount },
    };
    move[rosters.indexOf(wb.sender)] = "origin";
    moves.push(move);
  }

  return {
    id: transaction.transaction_id,
    type: transaction.type == "trade" ? "trade" : "waiver",
    rosters,
    moves,
    statusUpdated: transaction.status_updated || 0,
  };
};

const digested = allTransactions.map(digest).filter(Boolean);
// newest first: on a big backfill we want the most recent activity baked
// before older history, since that's what people are actually looking at
digested.sort((a, b) => b.statusUpdated - a.statusUpdated);

// --- load existing baked commentary so we only pay for NEW transactions ---

let existing = { trades: {}, waivers: {} };
if (existsSync(OUT_PATH)) {
  try {
    existing = JSON.parse(readFileSync(OUT_PATH, "utf8"));
  } catch {
    /* start fresh on corrupt file */
  }
}
existing.trades ||= {};
existing.tradeMeta ||= {}; // value gaps frozen at bake time, for a future GM Report Card
existing.waivers ||= {};
existing.recaps ||= {};
existing.predictions ||= {};

const newTrades = digested.filter(
  (t) => t.type == "trade" && !existing.trades[t.id],
);
const newWaivers = digested.filter(
  (t) => t.type == "waiver" && !existing.waivers[t.id],
);

// --- figure out which weeks of the current season are finished but don't
// have a Tuesday Roundup recap baked yet (reads the rivalry data bake that
// runs right before this script in the same workflow, so it always has
// the latest "which weeks have final scores" info) ---

const RIVALRY_PATH = join(root, "static/data/rivalry-matchups.json");
let newRecapWeeks = [];
let predictionWeekInfo = null; // upcoming week needing a matchup-prediction bake
if (existsSync(RIVALRY_PATH)) {
  try {
    const rivalry = JSON.parse(readFileSync(RIVALRY_PATH, "utf8"));
    const season = rivalry.seasons?.[leagueID];
    if (season) {
      season.weeks.forEach((w, ix) => {
        if (!w) return; // null = not played yet
        const week = ix + 1;
        const key = `${season.year}-${week}`;
        // ctxV 2 = bench phrase written knowing the win/loss context, plus
        // tinker keys; older bakes of the current season regenerate once
        if (!existing.recaps[key] || existing.recaps[key].ctxV !== 2) {
          newRecapWeeks.push({ year: season.year, week, key });
        }
      });
      // the first unplayed week is the upcoming one - flag it here (BEFORE
      // the early exit below) so predictions still bake on quiet runs with
      // no new transactions or finished weeks
      const upcomingIx = season.weeks.findIndex((w) => !w);
      if (
        upcomingIx !== -1 &&
        !existing.predictions[`${season.year}-${upcomingIx + 1}`]
      ) {
        predictionWeekInfo = { year: season.year, week: upcomingIx + 1 };
      }
    }
  } catch {
    /* rivalry data missing/corrupt - skip recap/prediction baking this run */
  }
}

// trade re-evaluations refresh once per completed week (poll runs in
// between see the same week and skip)
existing.tradeNow ||= {};
const nflState = await get("https://api.sleeper.app/v1/state/nfl").catch(() => null);
const completedWeek = nflState?.season_type === "regular" ? Math.max(Number(nflState.week) - 1, 0)
  : nflState?.season_type === "post" ? 18 : 0;
const staleTradeNow = completedWeek >= 1
  ? Object.keys(existing.tradeMeta || {}).filter((id) => existing.tradeNow[id]?.week !== completedWeek)
  : [];

if (
  !newTrades.length &&
  !newWaivers.length &&
  !newRecapWeeks.length &&
  !predictionWeekInfo &&
  !staleTradeNow.length
) {
  console.log(
    "No new transactions, finished weeks, upcoming-week predictions, or stale trade re-evals since last bake - nothing to generate.",
  );
  process.exit(0);
}

// --- classify what's new (name-agnostic - see classifyTrade/classifyWaiver) ---

let fcValues = null;
const gradeableTrades = [];
for (const t of newTrades) {
  if (!fcValues) {
    const raw = await get(
      "https://api.fantasycalc.com/values/current?isDynasty=true&numQbs=2&numTeams=12&ppr=0.5",
    );
    const players = {};
    const picks = [];
    for (const entry of raw) {
      if (entry.player?.position === "PICK") {
        picks.push({ name: entry.player.name, value: entry.value });
      } else if (entry.player?.sleeperId) {
        players[entry.player.sleeperId] = entry.value;
      }
    }
    fcValues = { players, picks };
  }
  const classified = classifyTrade(t, fcValues);
  if (classified) gradeableTrades.push({ t, classified });
}

const classifiedWaivers = newWaivers
  .map((t) => ({ t, classified: classifyWaiver(t, null) }))
  .filter((x) => x.classified);

console.log(
  `${gradeableTrades.length} new gradeable trades, ${classifiedWaivers.length} new waiver moves, ${newRecapWeeks.length} new Tuesday Roundup recap(s) to write fresh lines for.`,
);

// --- ask Claude for one fresh line per transaction ---

const TRADE_STYLE_EXAMPLES = [
  "🚨 FLEECE ALERT: the league office should investigate {W} immediately.",
  "{W} nudges ahead on paper. {L} calls it 'a vibes pick.'",
  "The calculator has {W} up big. {L} is officially 'trusting their gut.'",
  "A fair trade? In THIS league? Groundbreaking.",
];

const WAIVER_STYLE_EXAMPLES = [
  "🗞️ {T} sign {A}. Sources describe the locker room mood as \u201ccautiously optimistic.\u201d",
  "🗞️ {T} release {D}, thanking them for \u201cthe memories. Mostly the bad ones.\u201d",
  "🗞️ {T} swap {D} for {A}. {D}'s agent was notified via group chat.",
];

const askClaude = async (system, user) => {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 150,
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
  return text || null;
};

const TRADE_SYSTEM = `You write one-line comedic verdicts for a fantasy football dynasty league's "Trade-o-Meter" feature. Deadpan, dry, fake-news-anchor energy. One sentence, no more than ~25 words. You MUST use the literal tokens {W} (winning team) and {L} (losing team) exactly like that - do not invent team names. Vary your joke structure and vocabulary widely - don't lean on any one stock phrase or setup. Reply with ONLY the line, no quotes, no preamble.`;

const WAIVER_SYSTEM = `You write one-line comedic waiver-wire "news" headlines for a fantasy football dynasty league. Deadpan, dry, fake-news-anchor energy, starts with the 🗞️ emoji. One sentence, no more than ~25 words. You MUST use the literal tokens {T} (team making the move) and, when relevant, {A} (players added) and/or {D} (players dropped) exactly like that - do not invent names. Vary your joke structure and vocabulary widely - don't lean on any one stock phrase or setup. NEVER use "irreconcilable differences," "philosophical differences," "creative differences," or any close variant - these are overused, avoid them entirely. Reply with ONLY the line, no quotes, no preamble.`;

// Each transaction gets its own independent API call with no memory of any
// other call - so without seeing what's already been generated, the model
// tends to converge on the same handful of go-to phrases across calls
// (e.g. "irreconcilable differences" showed up in >30% of early waiver
// lines). To fix that, every call is shown a sample of recently-generated
// lines (seeded from what's already baked, then updated as this run goes)
// and told explicitly not to reuse them.
const RECENT_AVOID_COUNT = 20;
const avoidBlock = (recentLines) => {
  if (!recentLines.length) return "";
  const sample = recentLines.slice(-RECENT_AVOID_COUNT);
  return `\n\nLines already used recently - do NOT reuse these phrases, setups, or similar structures:\n${sample.map((l) => `- ${l}`).join("\n")}`;
};

const recentTradeLines = Object.values(existing.trades);
for (const { t, classified } of gradeableTrades) {
  const line = await askClaude(
    TRADE_SYSTEM,
    `Style examples:\n${TRADE_STYLE_EXAMPLES.map((l) => `- ${l}`).join("\n")}\n\nWrite ONE new line for a trade in tier "${classified.tier}" (value gap ${(classified.gapPct * 100).toFixed(0)}%). Tiers: even = basically fair, edge = slight edge, clear = clear win, fleece = lopsided robbery.${avoidBlock(recentTradeLines)}`,
  );
  if (line) {
    existing.trades[t.id] = line;
    // freeze the trade's value picture NOW - grading old trades with
    // today's values is nonsense, so a future GM Report Card needs the
    // numbers as they stood when the trade happened
    if (classified?.totals && t.rosters?.length >= 2) {
      const raw0 = allTransactions.find((x) => x.transaction_id === t.id);
      const assetsAtTrade = raw0 ? t.rosters.map((rid) => ({
        players: Object.entries(raw0.adds || {}).filter(([pid, owner]) => owner === rid && raw0.drops?.[pid] != null)
          .map(([pid]) => ({ pid, value: fcValues.players[pid] ?? null })),
        picks: (raw0.draft_picks || []).filter((pk) => pk.owner_id === rid)
          .map((pk) => ({ season: pk.season, round: pk.round, value: valueForPick(fcValues.picks, pk.season, pk.round) })),
      })) : null;
      existing.tradeMeta[t.id] = {
        at: t.status_updated || Date.now(),
        rosters: t.rosters, // every side, in move order
        totals: classified.totals, // dynasty value each side received, at trade time
        gapPct: classified.gapPct,
        tier: classified.tier,
        winnerRoster: t.rosters[classified.winnerIx] ?? null,
        assets: assetsAtTrade, // per-asset values frozen at trade time
      };
    }
    recentTradeLines.push(line);
  }
}

const recentWaiverLines = Object.values(existing.waivers);
for (const { t, classified } of classifiedWaivers) {
  const kind =
    classified.category == "SWAP"
      ? "a swap (drop one player, add another)"
      : classified.category == "ADD"
        ? "a straight add (no drop)"
        : "a straight drop (no add)";
  const bidNote = classified.bid ? ` FAAB bid: $${classified.bid}.` : "";
  const line = await askClaude(
    WAIVER_SYSTEM,
    `Style examples:\n${WAIVER_STYLE_EXAMPLES.map((l) => `- ${l}`).join("\n")}\n\nWrite ONE new headline for ${kind}.${bidNote}${avoidBlock(recentWaiverLines)}`,
  );
  if (line) {
    existing.waivers[t.id] = line;
    recentWaiverLines.push(line);
  }
}

// --- Tuesday Roundup (recap page): one Claude call per finished week, asking for all 4
// flavor lines (bench/toilet/blowout/heartbreak) at once as JSON, since
// they're all about the same week and this keeps it to 1 call/week instead
// of 4. Mirrors the exact stats src/lib/Recap/index.svelte computes client-
// side (top score, low score, bench points left on the bench, closest and
// widest margins) so the AI is reacting to the real week, not guessing. ---

const RECAP_SYSTEM = `You write short, dry, deadpan flavor lines for a fantasy football dynasty league's weekly "Tuesday Roundup" recap. You'll get stats for one specific week and must reply with ONLY a JSON object (no markdown fences, no preamble) with exactly these keys, each a short phrase (not a full sentence, no trailing period) that could follow a dash after a stat, e.g. "left 42.1 points riding the pine — {your bench phrase}":
{"bench": "...", "toilet": "...", "blowout": "...", "heartbreak": "...", "tinker": "...", "leftAlone": "..."}
- bench: reacts to a team leaving points on the bench. The stats say whether they WON or LOST that game - the phrase MUST fit that result. If they won anyway, never imply the outcome could have changed; mock the wasted points instead. If they lost by less than the bench total, twist the knife
- tinker: reacts to a team whose lineup changes GAINED points versus simply re-submitting last week's lineup - tinkering vindicated
- leftAlone: reacts to a team whose lineup changes LOST points versus last week's lineup - they outsmarted themselves
- toilet: reacts to the lowest score of the week
- blowout: reacts to the week's widest margin of victory
- heartbreak: reacts to the week's closest margin of victory
Keep each phrase under 12 words. Vary your phrasing and vocabulary widely across all four, and across different weeks - don't lean on any one stock phrase or setup. NEVER use "irreconcilable differences," "philosophical differences," "creative differences," or any close variant. Reply with ONLY the JSON object.`;

const askClaudeJSON = async (system, user) => {
  const text = await askClaude(system, user);
  if (!text) return null;
  try {
    // strip markdown fences if the model added them anyway
    return JSON.parse(text.replace(/^```(json)?/i, "").replace(/```$/, "").trim());
  } catch {
    console.warn(`Could not parse recap JSON: ${text}`);
    return null;
  }
};

const recentRecapLines = Object.values(existing.recaps).flatMap((r) => [
  r.bench,
  r.toilet,
  r.blowout,
  r.heartbreak,
].filter(Boolean));

// bench points the honest way: best LEGAL lineup minus actual starters.
const SLOT_ELIG = {
  QB: ["QB"], RB: ["RB"], WR: ["WR"], TE: ["TE"], K: ["K"], DEF: ["DEF"],
  FLEX: ["RB", "WR", "TE"], WRRB_FLEX: ["WR", "RB"], REC_FLEX: ["WR", "TE"],
  SUPER_FLEX: ["QB", "RB", "WR", "TE"],
  DL: ["DL"], LB: ["LB"], DB: ["DB"], IDP_FLEX: ["DL", "LB", "DB"],
};
const optimalPoints = (playerIDs, pointsMap, posOf, slots) => {
  const lineupSlots = (slots || []).filter((sl) => SLOT_ELIG[sl]);
  const pool = (playerIDs || []).map((id) => ({ pos: posOf(id), pts: pointsMap?.[id] || 0 })).filter((pl) => pl.pos);
  const order = [...lineupSlots].sort((a, b) => SLOT_ELIG[a].length - SLOT_ELIG[b].length);
  const used = new Set();
  let total = 0;
  for (const slot of order) {
    let best = -Infinity, bi = -1;
    for (let i = 0; i < pool.length; i++) {
      if (used.has(i) || !SLOT_ELIG[slot].includes(pool[i].pos)) continue;
      if (pool[i].pts > best) { best = pool[i].pts; bi = i; }
    }
    if (bi >= 0) { used.add(bi); total += Math.max(best, 0); }
  }
  return total;
};
let _litePos = null;
const litePos = (id) => {
  if (!_litePos) {
    _litePos = {};
    try {
      const lite = JSON.parse(readFileSync(join(root, "static/data/players-lite.json"), "utf8"));
      for (const [pid, v] of Object.entries(lite)) _litePos[pid] = String(v).split("|")[1] || null;
    } catch { /* empty map - bench falls back to 0 delta */ }
  }
  return _litePos[id];
};
const _league = await get(`https://api.sleeper.app/v1/league/${leagueID}`).catch(() => null);
const slotsFor = _league?.roster_positions || [];

for (const { year, week, key } of newRecapWeeks) {
  let entries;
  try {
    entries = await get(
      `https://api.sleeper.app/v1/league/${leagueID}/matchups/${week}`,
    );
  } catch (err) {
    console.warn(`Could not fetch matchups for week ${week}: ${err}`);
    continue;
  }
  if (!Array.isArray(entries) || !entries.length) continue;

  const teams = [];
  const pairs = {};
  for (const e of entries) {
    const starterPts = (e.starters_points || []).reduce((t, v) => t + (v || 0), 0);
    const optimal = optimalPoints(e.players, e.players_points, litePos, slotsFor);
    const team = {
      rosterID: e.roster_id,
      pts: starterPts,
      // legal-swap value, not the raw bench sum
      bench: Math.max(Math.round((optimal - starterPts) * 10) / 10, 0),
    };
    teams.push(team);
    if (e.matchup_id != null) {
      (pairs[e.matchup_id] = pairs[e.matchup_id] || []).push(team);
    }
  }
  const played = teams.filter((t) => t.pts > 0);
  if (!played.length) continue; // week not actually final yet, skip for now

  const top = [...played].sort((a, b) => b.pts - a.pts)[0];
  const toilet = [...played].sort((a, b) => a.pts - b.pts)[0];
  const benchKing = [...played].sort((a, b) => b.bench - a.bench)[0];

  let blowout = null;
  let heartbreak = null;
  for (const id in pairs) {
    const p = pairs[id];
    if (p.length != 2 || (p[0].pts == 0 && p[1].pts == 0)) continue;
    const margin = Math.abs(p[0].pts - p[1].pts);
    if (!blowout || margin > blowout.margin) blowout = { margin };
    if (!heartbreak || margin < heartbreak.margin) heartbreak = { margin };
  }

  const benchPair = Object.values(pairs).find((p) => p.length == 2 && p.includes(benchKing));
  const benchWon = benchPair ? benchKing.pts > benchPair.find((x) => x != benchKing).pts : null;
  const benchLost = benchPair && !benchWon && benchKing.bench > Math.abs(benchPair[0].pts - benchPair[1].pts);

  // stand-pat counterfactual: what if each team had re-submitted LAST
  // week's starters? (a departed/unrostered starter scores 0 - you can't
  // start what you dropped). Only lineups that actually changed count.
  let bestTinker = null, worstTinker = null;
  if (week > 1) {
    const prevEntries = await get(`https://api.sleeper.app/v1/league/${leagueID}/matchups/${week - 1}`).catch(() => []);
    for (const e of entries) {
      const prev = prevEntries.find((x) => x.roster_id === e.roster_id);
      if (!prev?.starters?.length) continue;
      const changed = [...prev.starters].sort().join() !== [...(e.starters || [])].sort().join();
      if (!changed) continue;
      const standPat = prev.starters.reduce((t, pid) => t + ((e.players || []).includes(pid) ? e.players_points?.[pid] || 0 : 0), 0);
      const actual = (e.starters_points || []).reduce((t, v) => t + (v || 0), 0);
      const delta = Math.round((actual - standPat) * 10) / 10;
      if (delta > 0 && (!bestTinker || delta > bestTinker.delta)) bestTinker = { delta, actual, standPat };
      if (delta < 0 && (!worstTinker || delta < worstTinker.delta)) worstTinker = { delta, actual, standPat };
    }
  }

  const stats = [
    `Bench Warmer: ${benchKing.bench.toFixed(1)} points left on the bench in a game they ${benchWon ? "WON anyway" : benchLost ? "LOST by less than that" : "LOST"}.`,
    `Toilet Bowl: lowest score of the week was ${toilet.pts.toFixed(1)} points.`,
    blowout ? `Blowout: widest margin of victory this week was ${blowout.margin.toFixed(1)} points.` : null,
    heartbreak ? `Heartbreak: closest margin of victory this week was ${heartbreak.margin.toFixed(1)} points.` : null,
    bestTinker ? `Tinkerer: one team's lineup changes GAINED ${bestTinker.delta.toFixed(1)} points versus re-submitting last week's lineup.` : `Tinkerer: no lineup changes gained points this week - reply "tinker" with a phrase anyway, generic.`,
    worstTinker ? `Overthinker: one team's lineup changes COST ${Math.abs(worstTinker.delta).toFixed(1)} points versus standing pat with last week's lineup.` : `Overthinker: nobody tinkered themselves out of points this week - reply "leftAlone" with a generic phrase anyway.`,
  ].filter(Boolean).join("\n");

  const result = await askClaudeJSON(
    RECAP_SYSTEM,
    `${year} Week ${week} stats:\n${stats}${avoidBlock(recentRecapLines)}`,
  );
  if (result && result.bench && result.toilet) {
    existing.recaps[key] = { ...result, ctxV: 2 };
    recentRecapLines.push(...[result.bench, result.toilet, result.blowout, result.heartbreak, result.tinker, result.leftAlone].filter(Boolean));
  }
}

// ============================================================
// Matchup Predictor: one AI preview per matchup for the upcoming week
// (the first week with no scores yet), skipped once the season is over.
// predictionWeekInfo was detected up top, before the early exit, so this
// still runs on quiet weeks with no new transactions or finished weeks.
// ============================================================

if (predictionWeekInfo) {
  const { year, week } = predictionWeekInfo;
  const predKey = `${year}-${week}`;
  if (!existing.predictions[predKey]) {
    const matchups = await get(
      `https://api.sleeper.app/v1/league/${leagueID}/matchups/${week}`,
    ).catch(() => []);
    const pairs = {};
    for (const m of matchups || []) {
      if (m.matchup_id == null) continue;
      (pairs[m.matchup_id] ||= []).push(m.roster_id);
    }
    const validPairs = Object.values(pairs).filter((p) => p.length === 2);

    if (validPairs.length) {
      const rosters = await get(`https://api.sleeper.app/v1/league/${leagueID}/rosters`);
      const users = await get(`https://api.sleeper.app/v1/league/${leagueID}/users`);
      const userById = Object.fromEntries(users.map((u) => [u.user_id, u]));
      const rosterById = Object.fromEntries(rosters.map((r) => [r.roster_id, r]));
      const nameFor = (rosterID) => {
        const r = rosterById[rosterID];
        const u = r && userById[r.owner_id];
        return u?.metadata?.team_name || u?.display_name || `Team ${rosterID}`;
      };
      const recordFor = (rosterID) => {
        const s = rosterById[rosterID]?.settings || {};
        return `${s.wins || 0}-${s.losses || 0}${s.ties ? `-${s.ties}` : ""}`;
      };

      // all-time head-to-head series per pairing, franchise-based by roster
      // ID (matches how the Rivalry page tracks franchises), from the
      // already-baked rivalry data - regular season + playoffs combined
      let h2hFor = () => null;
      try {
        const rivalry = JSON.parse(readFileSync(RIVALRY_PATH, "utf8"));
        h2hFor = (ra, rb) => {
          let aWins = 0, bWins = 0, ties = 0;
          for (const lid of rivalry.chain || []) {
            const season = rivalry.seasons[lid];
            const weekGroups = [
              ...season.weeks.filter(Boolean),
              ...Object.values(season.playoffWeeks || {}),
            ];
            for (const w of weekGroups) {
              for (const mid in w) {
                const entries = w[mid];
                const ea = entries.find((e) => e.roster_id === ra);
                const eb = entries.find((e) => e.roster_id === rb);
                if (!ea || !eb) continue;
                const pa = (ea.points || []).reduce((s, v) => s + (v || 0), 0);
                const pb = (eb.points || []).reduce((s, v) => s + (v || 0), 0);
                if (pa > pb) aWins++;
                else if (pb > pa) bWins++;
                else ties++;
              }
            }
          }
          return aWins + bWins + ties > 0 ? { aWins, bWins, ties } : null;
        };
      } catch {
        /* rivalry data unavailable - predictions just won't show h2h */
      }

      const matchupList = validPairs.map(([a, b], ix) => ({
        ix,
        a: { rosterID: a, name: nameFor(a), record: recordFor(a) },
        b: { rosterID: b, name: nameFor(b), record: recordFor(b) },
        h2h: h2hFor(a, b),
      }));

      const PREDICTION_SYSTEM = `You write short, confident, deadpan matchup previews for a fantasy football dynasty league's upcoming week. You'll get a list of matchups (each with two teams and their records) and must reply with ONLY a JSON object (no markdown fences, no preamble) mapping each matchup's index (as a string) to a one-sentence preview under 20 words. Lean into records where they're lopsided, stay neutral and teasing where they're close. Vary phrasing and structure widely across matchups. NEVER use "irreconcilable differences," "philosophical differences," "creative differences," or any close variant.`;

      const predResult = await askClaudeJSON(
        PREDICTION_SYSTEM,
        `${year} Week ${week} matchups:\n${matchupList.map((m) => `${m.ix}: ${m.a.name} (${m.a.record}) vs ${m.b.name} (${m.b.record})`).join("\n")}`,
      );

      if (predResult) {
        existing.predictions[predKey] = matchupList.map((m) => ({
          teamA: m.a.name,
          teamB: m.b.name,
          recordA: m.a.record,
          recordB: m.b.record,
          h2h: m.h2h, // {aWins, bWins, ties} all-time, or null
          blurb: predResult[String(m.ix)] || null,
        }));
      }
    }
  }
}

mkdirSync(join(root, "static/data"), { recursive: true });

// ── "where it stands now": weekly present-tense re-grade of past trades ──
// The original verdict stays frozen; this block is OVERWRITTEN each
// completed week with how the deal is actually playing out - points the
// moved players scored for their new teams, injuries, whether they're even
// still rostered, and what the picks price at today. Picks can't score
// until a draft, so they're tracked by calculator value (vs their frozen
// at-trade value when we have it).
if (staleTradeNow.length) {
  console.log(`${staleTradeNow.length} trade re-eval(s) for completed week ${completedWeek}`);
  if (!fcValues) {
    const raw = await get("https://api.fantasycalc.com/values/current?isDynasty=true&numQbs=2&numTeams=12&ppr=0.5").catch(() => []);
    const players = {}; const picks = [];
    for (const entry of raw) {
      if (entry.player?.position === "PICK") picks.push({ name: entry.player.name, value: entry.value });
      else if (entry.player?.sleeperId) players[entry.player.sleeperId] = entry.value;
    }
    fcValues = { players, picks };
  }
  const allPlayers = await sleeperPlayers(get).catch(() => ({}));
  const curRosters = await get(`https://api.sleeper.app/v1/league/${leagueID}/rosters`).catch(() => []);
  const onRosterNow = {}; // pid -> roster_id
  for (const r of curRosters) for (const pid of r.players || []) onRosterNow[pid] = r.roster_id;
  const leagueUsers = await get(`https://api.sleeper.app/v1/league/${leagueID}/users`).catch(() => []);
  const rosterNames = {};
  for (const r of curRosters) {
    const u = leagueUsers.find((x) => x.user_id === r.owner_id);
    rosterNames[r.roster_id] = u?.metadata?.team_name || u?.display_name || `Roster ${r.roster_id}`;
  }
  const teamNameOf = (rid) => rosterNames[rid] || `Roster ${rid}`;
  const matchupCache = {};
  const matchupsFor = async (w) => (matchupCache[w] ||= await get(`https://api.sleeper.app/v1/league/${leagueID}/matchups/${w}`).catch(() => []));

  const TRADE_NOW_SYSTEM = `You write a one-to-two sentence present-tense re-assessment of a past fantasy football dynasty trade, given how it is ACTUALLY playing out. Dry, deadpan, honest - credit aging like fine wine or curdling as the stats warrant. Use the real team names given. Max 35 words. Reply with ONLY the line, no quotes, no preamble.`;

  for (const id of staleTradeNow) {
    const meta = existing.tradeMeta[id];
    const raw = allTransactions.find((x) => x.transaction_id === id);
    if (!meta || !raw) continue;
    const tradeWeek = Math.max(Number(raw.leg) || 1, 1);
    const sides = [];
    for (const rid of meta.rosters) {
      const gotPlayers = Object.entries(raw.adds || {})
        .filter(([pid, owner]) => owner === rid && raw.drops?.[pid] != null)
        .map(([pid]) => pid);
      const gotPicks = (raw.draft_picks || []).filter((pk) => pk.owner_id === rid);
      const faab = (raw.waiver_budget || []).filter((wb) => wb.receiver === rid).reduce((a, b) => a + b.amount, 0);
      const players = [];
      for (const pid of gotPlayers) {
        let pts = 0; let started = 0; let weeksOn = 0;
        for (let w = tradeWeek; w <= completedWeek; w++) {
          const entry = (await matchupsFor(w)).find((m) => m.roster_id === rid);
          if (!entry || !(entry.players || []).includes(pid)) continue;
          weeksOn++;
          pts += entry.players_points?.[pid] || 0;
          if ((entry.starters || []).includes(pid)) started++;
        }
        const pl = allPlayers[pid];
        players.push({
          pid,
          name: pl ? `${pl.first_name} ${pl.last_name}` : `#${pid}`,
          pts: Math.round(pts * 10) / 10,
          started, weeksOn,
          status: pl?.injury_status || (pl?.status === "Injured Reserve" ? "IR" : null),
          stillOn: onRosterNow[pid] === rid,
          valueNow: fcValues.players[pid] ?? null,
        });
      }
      const atAssets = meta.assets?.[meta.rosters.indexOf(rid)];
      const picks = gotPicks.map((pk) => {
        // a pick whose draft already happened isn't an asset anymore - it
        // conveyed into a player at that draft
        const conveyed = Number(pk.season) <= Number(nflState?.season || 0);
        const valueNow = conveyed ? null : valueForPick(fcValues.picks, pk.season, pk.round);
        const atTrade = atAssets?.picks?.find((x) => x.season === pk.season && x.round === pk.round)?.value ?? null;
        return { label: `${pk.season} R${pk.round}`, conveyed, valueNow, valueAtTrade: conveyed ? null : atTrade };
      });
      sides.push({
        rosterID: rid,
        pts: Math.round(players.reduce((a, b) => a + b.pts, 0) * 10) / 10,
        players, picks, faab: faab || undefined,
      });
    }
    // one AI line per trade; stats digest keeps it grounded in what happened
    const digestLines = sides.map((sd) => {
      const pl = sd.players.map((x) => `${x.name} ${x.pts} pts in ${x.weeksOn} wks (started ${x.started})${x.status ? `, ${x.status}` : ""}${x.stillOn ? "" : ", NO LONGER ON ROSTER"}`).join("; ") || "no players";
      const pk = sd.picks.map((x) => x.conveyed ? `${x.label} (already conveyed at that draft)` : `${x.label} now ~${x.valueNow}${x.valueAtTrade ? ` (was ${x.valueAtTrade} at trade)` : ""}`).join("; ");
      return `${teamNameOf(sd.rosterID).trim()} got: ${pl}${pk ? ` | picks: ${pk}` : ""}${sd.faab ? ` | $${sd.faab} FAAB` : ""}`;
    }).join("\n");
    const line = API_KEY ? await askClaude(
      TRADE_NOW_SYSTEM,
      `Original call at trade time: tier "${meta.tier}", value winner ${teamNameOf(meta.winnerRoster).trim()}.\nThrough week ${completedWeek}, here is what each side's haul has actually done:\n${digestLines}\n\nWrite the present-tense re-assessment.`,
    ) : null;
    existing.tradeNow[id] = { week: completedWeek, at: Date.now(), sides, line: line || null };
  }
}

writeFileSync(OUT_PATH, JSON.stringify(existing));
console.log(
  `wrote static/data/commentary.json (${Object.keys(existing.trades).length} trades, ${Object.keys(existing.waivers).length} waivers, ${Object.keys(existing.recaps).length} recap weeks, ${Object.keys(existing.predictions).length} prediction weeks total)`,
);
