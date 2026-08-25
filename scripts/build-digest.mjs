// Composes the Oracle's Weekly Digest from the freshly-baked data files and
// posts it to the league Slack via an incoming webhook (SLACK_WEBHOOK_URL).
// Runs in the Tuesday workflow AFTER the feature bakes. Posts only during
// the regular season (or when FORCE_DIGEST=1) so preseason Tuesdays stay
// quiet. Always prints the digest to stdout for the Actions log.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const load = (p) => {
  try {
    return JSON.parse(readFileSync(join(root, "static/data", p), "utf8"));
  } catch {
    return null;
  }
};

const state = await (await fetch("https://api.sleeper.app/v1/state/nfl")).json();
const inSeason = state.season_type === "regular";

const pr = load("power-rankings.json");
const odds = load("playoff-odds.json");
const rw = load("record-watch.json");
const tb = load("tradeblock.json");
const knowledge = load("knowledge.json");

const lines = [];
lines.push(`:crystal_ball: *The Oracle's Weekly Digest* — ${state.season} Week ${state.week}`);

if (pr?.teams?.length) {
  lines.push("", "*Power Rankings*");
  pr.teams.slice(0, 5).forEach((t, i) => {
    const move = t.prevRank ? (t.prevRank > i + 1 ? ` :arrow_up:${t.prevRank - i - 1}` : t.prevRank < i + 1 ? ` :arrow_down:${i + 1 - t.prevRank}` : "") : "";
    lines.push(`${i + 1}. ${String(t.name || "").trim()}${move}`);
  });
}

if (odds?.teams?.length) {
  const top = [...odds.teams].sort((a, b) => (b.playoffPct ?? 0) - (a.playoffPct ?? 0)).slice(0, 3);
  if (top.some((t) => t.playoffPct != null)) {
    lines.push("", "*Playoff Picture*");
    for (const t of top) lines.push(`• ${String(t.name || "").trim()}: ${Math.round(t.playoffPct)}% playoffs${t.titlePct != null ? `, ${Math.round(t.titlePct)}% title` : ""}`);
  }
}

// this week's matchups with all-time series, from the baked schedule
const sched = knowledge?.schedule;
if (sched && typeof sched === "object") {
  const wk = sched[`week ${state.week}`];
  if (wk?.length) {
    lines.push("", `*Week ${state.week} Matchups*`);
    for (const game of wk) lines.push(`• ${game}`);
  }
}

if (rw?.weekHistory) {
  lines.push("", `*Record to beat this week:* ${rw.weekHistory}`);
}

if (tb?.teams?.length) {
  const items = tb.teams.reduce((a, t) => a + (t.items?.length || 0), 0);
  if (items) lines.push("", `*Trade Block:* ${items} item${items === 1 ? "" : "s"} listed — act-dienasty.vercel.app/tradeblock`);
}

lines.push("", "_Ask anything: act-dienasty.vercel.app/ask or `/oracle` right here._");
const digest = lines.join("\n");
console.log("---- digest preview ----\n" + digest + "\n------------------------");

const webhook = process.env.SLACK_WEBHOOK_URL;
if (!webhook) {
  console.log("SLACK_WEBHOOK_URL not set - digest not posted (preview only).");
  process.exit(0);
}
if (!inSeason && process.env.FORCE_DIGEST !== "1") {
  console.log(`season_type=${state.season_type} - digest only posts in the regular season.`);
  process.exit(0);
}
const res = await fetch(webhook, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ text: digest }),
});
console.log(res.ok ? "digest posted to Slack" : `webhook failed: ${res.status}`);
if (!res.ok) process.exit(1);
