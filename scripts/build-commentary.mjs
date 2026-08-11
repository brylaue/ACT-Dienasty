/*
  Bakes fresh, AI-written one-liners for Trade-o-Meter verdicts and waiver
  headlines into static/data/commentary.json, keyed by transaction id.

  Why: the old approach picked from a small hardcoded pool of ~5 lines per
  tier/category, so with enough trades and waiver moves the same jokes
  started repeating. This script asks Claude for one fresh, specific line
  per NEW transaction (never regenerating ones already baked, so ongoing
  cost stays tiny), and the site substitutes {W}/{L} or {T}/{A}/{D} tokens
  into it client-side exactly like it always did with the template pool -
  see src/lib/utils/helperFunctions/tradeAnalysis.js and waiverHeadlines.js.

  Requires the ANTHROPIC_API_KEY secret. If it's not set, this step logs a
  warning and exits without writing anything - the site just keeps using
  the template pool as a fallback, so a missing/expired key never breaks
  the weekly data refresh for the rest of the site.

  Run weekly (GitHub Action, same cron as the rivalry data bake) or
  manually: ANTHROPIC_API_KEY=sk-... node scripts/build-commentary.mjs
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

// --- gather every trade + waiver transaction across the whole league chain ---

const seasonsRaw = [];
let cur = leagueID;
while (cur && cur != 0) {
  const league = await get(`https://api.sleeper.app/v1/league/${cur}`);
  seasonsRaw.push({ id: cur, league });
  cur = league.previous_league_id;
}

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
  };
};

const digested = allTransactions.map(digest).filter(Boolean);

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

const newTrades = digested.filter(
  (t) => t.type == "trade" && !existing.trades[t.id],
);
const newWaivers = digested.filter(
  (t) => t.type == "waiver" && !existing.waivers[t.id],
);

if (!newTrades.length && !newWaivers.length) {
  console.log("No new transactions since last bake - nothing to generate.");
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
  `${gradeableTrades.length} new gradeable trades, ${classifiedWaivers.length} new waiver moves to write fresh lines for.`,
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

const TRADE_SYSTEM = `You write one-line comedic verdicts for a fantasy football dynasty league's "Trade-o-Meter" feature. Deadpan, dry, fake-news-anchor energy. One sentence, no more than ~25 words. You MUST use the literal tokens {W} (winning team) and {L} (losing team) exactly like that - do not invent team names. Never repeat a joke structure you've already used in this conversation. Reply with ONLY the line, no quotes, no preamble.`;

const WAIVER_SYSTEM = `You write one-line comedic waiver-wire "news" headlines for a fantasy football dynasty league. Deadpan, dry, fake-news-anchor energy, starts with the 🗞️ emoji. One sentence, no more than ~25 words. You MUST use the literal tokens {T} (team making the move) and, when relevant, {A} (players added) and/or {D} (players dropped) exactly like that - do not invent names. Never repeat a joke structure you've already used in this conversation. Reply with ONLY the line, no quotes, no preamble.`;

for (const { t, classified } of gradeableTrades) {
  const line = await askClaude(
    TRADE_SYSTEM,
    `Style examples:\n${TRADE_STYLE_EXAMPLES.map((l) => `- ${l}`).join("\n")}\n\nWrite ONE new line for a trade in tier "${classified.tier}" (value gap ${(classified.gapPct * 100).toFixed(0)}%). Tiers: even = basically fair, edge = slight edge, clear = clear win, fleece = lopsided robbery.`,
  );
  if (line) existing.trades[t.id] = line;
}

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
    `Style examples:\n${WAIVER_STYLE_EXAMPLES.map((l) => `- ${l}`).join("\n")}\n\nWrite ONE new headline for ${kind}.${bidNote}`,
  );
  if (line) existing.waivers[t.id] = line;
}

mkdirSync(join(root, "static/data"), { recursive: true });
writeFileSync(OUT_PATH, JSON.stringify(existing));
console.log(
  `wrote static/data/commentary.json (${Object.keys(existing.trades).length} trades, ${Object.keys(existing.waivers).length} waivers total)`,
);
