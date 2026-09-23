/*
  Parlay Builder bot for #weeklyparlaybuilder.

  Each team submits one leg per week through the Slack Workflow form, which
  posts a line matching:   🎯 LEG | <Team Name> | <leg text>
  (Typing that format by hand in the channel works too.)

  Modes (first CLI arg):
    open     Tuesday  - announce the week, name who's on the hook
             (last week's lowest starter score, straight from Sleeper)
    nag      Wednesday - remind ONLY the teams that haven't submitted
    compile  Thursday 6pm ET - lock it and post the full slip as ONE line

  Runs from GitHub Actions cron (see parlay-builder.yml). Crons are pinned
  to UTC, so each mode runs at two UTC hours and the script itself checks
  Eastern time - that keeps the 6pm deadline honest across DST.

  Needs: SLACK_BOT_TOKEN (xoxb-, scopes: chat:write, channels:history,
  channels:read) with the bot invited to the channel.
*/

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const MODE = process.argv[2];
const TOKEN = process.env.SLACK_BOT_TOKEN;
const CHANNEL_NAME = process.env.PARLAY_CHANNEL || "weeklyparlaybuilder";

if (!["open", "nag", "compile"].includes(MODE)) {
  console.error("usage: node scripts/parlay-bot.mjs open|nag|compile [--force]");
  process.exit(1);
}
const DRY = process.argv.includes("--dry"); // print messages instead of posting
if (!TOKEN && !DRY) {
  console.log("SLACK_BOT_TOKEN not set - add it as a repo Actions secret to enable the Parlay Builder bot.");
  process.exit(0);
}

// ── ET gating: crons fire at two UTC hours; only the one matching ET runs ──
const FORCE = process.argv.includes("--force");
const etNow = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
const WANT_ET_HOUR = { open: 10, nag: 18, compile: 18 }[MODE];
if (!FORCE && etNow.getHours() !== WANT_ET_HOUR) {
  console.log(`ET hour is ${etNow.getHours()}, mode "${MODE}" wants ${WANT_ET_HOUR} - the other cron slot handles this one.`);
  process.exit(0);
}

// ── league context ────────────────────────────────────────────────────────
const leagueInfo = readFileSync(join(root, "src/lib/utils/leagueInfo.js"), "utf8");
const leagueID = leagueInfo.match(/leagueID\s*=\s*["']([0-9]+)["']/)[1];
const get = async (url) => { const r = await fetch(url); if (!r.ok) throw new Error(`${r.status} ${url}`); return r.json(); };

const state = await get("https://api.sleeper.app/v1/state/nfl");
const nflWeek = Number(state.week) || 1;                 // week being bet on
const lastWeek = state.season_type === "regular" ? nflWeek - 1 : 0;

const rosters = await get(`https://api.sleeper.app/v1/league/${leagueID}/rosters`);
const users = await get(`https://api.sleeper.app/v1/league/${leagueID}/users`);
const teamName = (rid) => {
  const r = rosters.find((x) => x.roster_id === rid);
  const u = users.find((x) => x.user_id === r?.owner_id);
  return (u?.metadata?.team_name || u?.display_name || `Roster ${rid}`).trim();
};
const allTeams = rosters.map((r) => teamName(r.roster_id));

// last week's lowest STARTER score = this week's placer
let placer = null;
if (lastWeek >= 1) {
  const m = await get(`https://api.sleeper.app/v1/league/${leagueID}/matchups/${lastWeek}`);
  let low = Infinity, lowRid = null;
  for (const e of m) {
    const pts = (e.starters_points || []).reduce((t, v) => t + (v || 0), 0);
    if (pts > 0 && pts < low) { low = pts; lowRid = e.roster_id; }
  }
  if (lowRid != null) placer = { name: teamName(lowRid), pts: Math.round(low * 100) / 100 };
}

// ── slack helpers ─────────────────────────────────────────────────────────
const DRY_HISTORY = [
  { text: "🎯 LEG | Immigrants | Bijan anytime TD" },
  { text: "🎯 LEG | The Maniacs | Bills -3.5" },
  { text: "🎯 LEG | Risky Business | Over 47.5 CIN/BAL" },
];
const slack = async (method, payload) => {
  if (DRY) { console.log(`\n[dry] ${method} →\n${payload.text || JSON.stringify(payload)}`); return { ts: "0" }; }
  const r = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8", authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(payload),
  });
  const d = await r.json();
  if (!d.ok) throw new Error(`${method}: ${d.error}`);
  return d;
};
const slackGet = async (method, params) => {
  if (DRY) {
    if (method === "conversations.list") return { channels: [{ id: "DRY", name: CHANNEL_NAME }] };
    if (method === "conversations.history") return { messages: DRY_HISTORY, has_more: false, response_metadata: {} };
  }
  const qs = new URLSearchParams(params).toString();
  const r = await fetch(`https://slack.com/api/${method}?${qs}`, { headers: { authorization: `Bearer ${TOKEN}` } });
  const d = await r.json();
  if (!d.ok) throw new Error(`${method}: ${d.error}`);
  return d;
};

// plain-English failure reasons instead of stack traces
const explain = (err) => {
  const m = String(err?.message || err);
  if (/missing_scope/.test(m)) return `${m}\n→ Add the missing scope under OAuth & Permissions in the Slack app, click "Reinstall to Workspace", then paste the NEW token into the SLACK_BOT_TOKEN secret.`;
  if (/invalid_auth|not_authed|token_revoked/.test(m)) return `${m}\n→ The SLACK_BOT_TOKEN secret isn't a valid bot token (should start with xoxb-). Re-copy it from OAuth & Permissions.`;
  if (/not_in_channel|channel_not_found/.test(m)) return `${m}\n→ Run /invite @Parlay Builder inside #${CHANNEL_NAME}.`;
  return m;
};
process.on("unhandledRejection", (err) => { console.error(`Parlay bot failed: ${explain(err)}`); process.exit(1); });

// find the channel id: public channels first (needs channels:read), then
// private ones if the app has groups:read - a private channel needs the
// bot invited AND those scopes
const findChannel = async (types) => {
  for (let cursor = ""; ;) {
    const d = await slackGet("conversations.list", { types, limit: 200, exclude_archived: true, cursor });
    const hit = d.channels.find((c) => c.name === CHANNEL_NAME);
    if (hit) return hit.id;
    cursor = d.response_metadata?.next_cursor;
    if (!cursor) return null;
  }
};
let channelID = await findChannel("public_channel");
if (!channelID) {
  try { channelID = await findChannel("private_channel"); }
  catch (err) { console.error(`Couldn't list private channels (${err.message}). If #${CHANNEL_NAME} is private, add scopes groups:read + groups:history, reinstall the app, update the secret.`); }
}
if (!channelID) { console.error(`channel #${CHANNEL_NAME} not found. Check the exact channel name, and that the bot was invited (/invite @Parlay Builder).`); process.exit(1); }

// legs submitted since Monday 00:00 ET this week
const readLegs = async () => {
  const monday = new Date(etNow);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7)); // back to Monday
  monday.setHours(0, 0, 0, 0);
  const oldest = String(Math.floor(monday.getTime() / 1000));
  const legs = {}; // teamName -> latest leg text (messages arrive newest-first; first seen wins)
  for (let cursor = ""; ;) {
    const d = await slackGet("conversations.history", { channel: channelID, oldest, limit: 200, cursor });
    for (const msg of d.messages || []) {
      const m = (msg.text || "").match(/LEG\s*\|\s*([^|]+?)\s*\|\s*(.+)/);
      if (!m) continue;
      const team = allTeams.find((t) => t.toLowerCase() === m[1].trim().toLowerCase());
      if (team && !legs[team]) legs[team] = m[2].trim().replace(/\s+/g, " ");
    }
    cursor = d.response_metadata?.next_cursor;
    if (!cursor || !d.has_more) break;
  }
  return legs;
};

// ── modes ─────────────────────────────────────────────────────────────────
if (MODE === "open") {
  const hook = placer
    ? `On the hook this week: *${placer.name}* (league-low ${placer.pts} last week). They place the bet Thursday.`
    : `First week - agree on who places it, or nominate last season's Toilet Bowl champ for old times' sake.`;
  await slack("chat.postMessage", {
    channel: channelID,
    text: `🎰 *Week ${nflWeek} Parlay Builder is OPEN*\n${hook}\nOne leg per team - use the *Add my leg* workflow (⚡ shortcut in this channel), or post \`🎯 LEG | Your Team | your leg\`.\n*Legs lock Thursday 6:00pm ET.* Miss it and the placer picks your leg for you - no appeals.`,
  });
  console.log(`opened week ${nflWeek}${placer ? `, placer ${placer.name}` : ""}`);
} else if (MODE === "nag") {
  const legs = await readLegs();
  const missing = allTeams.filter((t) => !legs[t]);
  if (!missing.length) {
    await slack("chat.postMessage", { channel: channelID, text: `✅ All 12 legs are in for week ${nflWeek}. Slip drops tomorrow at 6pm ET.` });
  } else {
    await slack("chat.postMessage", {
      channel: channelID,
      text: `⏰ *${Object.keys(legs).length}/${allTeams.length} legs in.* Still missing: ${missing.map((t) => `*${t}*`).join(", ")}.\nDeadline is *tomorrow 6:00pm ET* - after that the placer chooses for you, and history says they will not be kind.`,
    });
  }
  console.log(`nagged; ${missing.length} team(s) missing`);
} else if (MODE === "compile") {
  const legs = await readLegs();
  const inCount = Object.keys(legs).length;
  const missing = allTeams.filter((t) => !legs[t]);
  const slip = allTeams.filter((t) => legs[t]).map((t) => legs[t]).join("  •  ");
  const placerLine = placer ? `Placer: *${placer.name}*` : "Placer: TBD";
  const missingLine = missing.length ? `\nMissing (placer picks these): ${missing.join(", ")}` : "";
  const res = await slack("chat.postMessage", {
    channel: channelID,
    text: `🔒 *WEEK ${nflWeek} SLIP — ${inCount}/12 legs* · ${placerLine}\n${slip || "(no legs submitted - somehow, this league found a new low)"}${missingLine}\n_Placer: copy the line above into the book and reply here with the slip screenshot before kickoff._`,
  });
  await slack("pins.add", { channel: channelID, timestamp: res.ts }).catch(() => {});
  console.log(`compiled ${inCount}/12 legs for week ${nflWeek}`);
}
