/*
  Bakes fresh, AI-written one-liners for Trade-o-Meter verdicts, waiver
  headlines, and Sunday Shame recap flavor lines into
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
import { classifyTrade } from "../src/lib/utils/helperFunctions/tradeClassification.js";
import { classifyWaiver } from "../src/lib/utils/helperFunctions/waiverHeadlines.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_PATH = join(root, "static/data/commentary.json");
const MODEL = "claude-haiku-4-5-20251001"; // cheap/fast is plenty for one-liners

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
existing.waivers ||= {};
existing.recaps ||= {};

const newTrades = digested.filter(
  (t) => t.type == "trade" && !existing.trades[t.id],
);
const newWaivers = digested.filter(
  (t) => t.type == "waiver" && !existing.waivers[t.id],
);

// --- figure out which weeks of the current season are finished but don't
// have a Sunday Shame recap baked yet (reads the rivalry data bake that
// runs right before this script in the same workflow, so it always has
// the latest "which weeks have final scores" info) ---

const RIVALRY_PATH = join(root, "static/data/rivalry-matchups.json");
let newRecapWeeks = [];
if (existsSync(RIVALRY_PATH)) {
  try {
    const rivalry = JSON.parse(readFileSync(RIVALRY_PATH, "utf8"));
    const season = rivalry.seasons?.[leagueID];
    if (season) {
      season.weeks.forEach((w, ix) => {
        if (!w) return; // null = not played yet
        const week = ix + 1;
        const key = `${season.year}-${week}`;
        if (!existing.recaps[key]) {
          newRecapWeeks.push({ year: season.year, week, key });
        }
      });
    }
  } catch {
    /* rivalry data missing/corrupt - skip recap baking this run */
  }
}

if (!newTrades.length && !newWaivers.length && !newRecapWeeks.length) {
  console.log("No new transactions or finished weeks since last bake - nothing to generate.");
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
  `${gradeableTrades.length} new gradeable trades, ${classifiedWaivers.length} new waiver moves, ${newRecapWeeks.length} new Sunday Shame recap(s) to write fresh lines for.`,
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

// --- Sunday Shame: one Claude call per finished week, asking for all 4
// flavor lines (bench/toilet/blowout/heartbreak) at once as JSON, since
// they're all about the same week and this keeps it to 1 call/week instead
// of 4. Mirrors the exact stats src/lib/Recap/index.svelte computes client-
// side (top score, low score, bench points left on the bench, closest and
// widest margins) so the AI is reacting to the real week, not guessing. ---

const RECAP_SYSTEM = `You write short, dry, deadpan flavor lines for a fantasy football dynasty league's weekly "Sunday Shame" recap. You'll get stats for one specific week and must reply with ONLY a JSON object (no markdown fences, no preamble) with exactly these keys, each a short phrase (not a full sentence, no trailing period) that could follow a dash after a stat, e.g. "left 42.1 points riding the pine — {your bench phrase}":
{"bench": "...", "toilet": "...", "blowout": "...", "heartbreak": "..."}
- bench: reacts to a team leaving a lot of points on the bench (worse if they also lost with the bench points sitting right there)
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
    const totalPts = Object.values(e.players_points || {}).reduce((t, v) => t + (v || 0), 0);
    const team = {
      rosterID: e.roster_id,
      pts: starterPts,
      bench: Math.max(totalPts - starterPts, 0),
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

  const benchLost = Object.values(pairs).some(
    (p) =>
      p.length == 2 &&
      p.includes(benchKing) &&
      benchKing.pts < p.find((x) => x != benchKing).pts &&
      benchKing.bench > Math.abs(p[0].pts - p[1].pts),
  );

  const stats = [
    `Bench Warmer: ${benchKing.bench.toFixed(1)} points left on the bench${benchLost ? " in a game they LOST" : ""}.`,
    `Toilet Bowl: lowest score of the week was ${toilet.pts.toFixed(1)} points.`,
    blowout ? `Blowout: widest margin of victory this week was ${blowout.margin.toFixed(1)} points.` : null,
    heartbreak ? `Heartbreak: closest margin of victory this week was ${heartbreak.margin.toFixed(1)} points.` : null,
  ].filter(Boolean).join("\n");

  const result = await askClaudeJSON(
    RECAP_SYSTEM,
    `${year} Week ${week} stats:\n${stats}${avoidBlock(recentRecapLines)}`,
  );
  if (result && result.bench && result.toilet) {
    existing.recaps[key] = result;
    recentRecapLines.push(result.bench, result.toilet, result.blowout, result.heartbreak);
  }
}

mkdirSync(join(root, "static/data"), { recursive: true });
writeFileSync(OUT_PATH, JSON.stringify(existing));
console.log(
  `wrote static/data/commentary.json (${Object.keys(existing.trades).length} trades, ${Object.keys(existing.waivers).length} waivers, ${Object.keys(existing.recaps).length} recap weeks total)`,
);
