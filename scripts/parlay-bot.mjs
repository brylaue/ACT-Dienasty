/*
  Parlay Builder bot for #weeklyparlaybuilder.

  Each team submits one leg per week, either:
    - by REPLYING in the opener's thread with just the leg ("Vikings ML") -
      the team is inferred from the Slack user (static/data/parlay-managers.json)
    - by posting a 🎯-prefixed message in the channel (same inference)
    - or the explicit form:   🎯 LEG | <Team Name> | <leg text>
      (works from anyone, e.g. the commish entering a leg on someone's behalf)
  Latest submission per team wins.

  Modes (first CLI arg):
    tick     hourly Tue-Thu from cron. Works out what's due and posts it:
             the Tuesday opener (10am ET+), the nag (24h before the
             deadline), the slip (at the deadline). Each posts at most once
             per week - it checks the channel first - so a delayed or
             doubled cron is harmless.
    open | nag | compile   force one step by hand (used with --force).

  THE DEADLINE FOLLOWS THE REAL SCHEDULE: 2 hours before the week's
  earliest kickoff (Sleeper's own GraphQL scores feed; ESPN as fallback),
  capped at Thursday 6pm ET.
  Normal weeks that's Thursday 6pm; Thanksgiving (1pm games) it's 11am;
  a Wednesday holiday game pulls it to Wednesday. Everything is computed
  in Eastern time, so DST never shifts it.

  SEASON: runs only in the NFL regular season and stops at the league's
  playoff_week_start (posting one sign-off), so playoff weeks are quiet.

  Needs: SLACK_BOT_TOKEN (xoxb-, scopes: chat:write, channels:history,
  channels:read) with the bot invited to the channel.
*/

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { collectLegs, renderBoard as renderBoardCore, isOpener, isBoard, isLockedBoard } from "../src/lib/server/parlayCore.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const MODE = process.argv[2];
const TOKEN = process.env.SLACK_BOT_TOKEN;
const CHANNEL_NAME = process.env.PARLAY_CHANNEL || "weeklyparlaybuilder";

if (!["tick", "open", "nag", "compile"].includes(MODE)) {
  console.error("usage: node scripts/parlay-bot.mjs tick|open|nag|compile [--force] [--dry]");
  process.exit(1);
}
const DRY = process.argv.includes("--dry"); // print messages instead of posting
if (!TOKEN && !DRY) {
  console.log("SLACK_BOT_TOKEN not set - add it as a repo Actions secret to enable the Parlay Builder bot.");
  process.exit(0);
}

// ── time helpers (everything in Eastern) ──────────────────────────────
const FORCE = process.argv.includes("--force"); // manual runs: skip the posted-already checks
const etNow = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
const etOffsetMs = Date.now() - Date.UTC(etNow.getFullYear(), etNow.getMonth(), etNow.getDate(), etNow.getHours(), etNow.getMinutes(), etNow.getSeconds());
const epochFromET = (y, m, d, h, min = 0) => Date.UTC(y, m, d, h, min) + etOffsetMs; // ET wall time → epoch ms
const etLabel = (ms) => new Date(ms).toLocaleString("en-US", { timeZone: "America/New_York", weekday: "long", hour: "numeric", minute: "2-digit" }).replace(":00", "") + " ET";

// ── league context ────────────────────────────────────────────────────────
const leagueInfo = readFileSync(join(root, "src/lib/utils/leagueInfo.js"), "utf8");
let userTeam = {};
try { userTeam = JSON.parse(readFileSync(join(root, "static/data/parlay-managers.json"), "utf8")).users || {}; } catch { /* map optional */ }
const LEAGUE_ID_FROM_CONFIG = leagueInfo.match(/leagueID\s*=\s*["']([0-9]+)["']/)[1];
const get = async (url) => { const r = await fetch(url); if (!r.ok) throw new Error(`${r.status} ${url}`); return r.json(); };

const state = await get("https://api.sleeper.app/v1/state/nfl");
const nflWeek = Number(process.env.PARLAY_TEST_WEEK) || Number(state.week) || 1; // week being bet on (env override = test only)
const lastWeek = state.season_type === "regular" ? nflWeek - 1 : 0;

// ── follow the league chain into the new season if leagueInfo.js is stale ──
let leagueID = LEAGUE_ID_FROM_CONFIG;
let leagueMeta = await get(`https://api.sleeper.app/v1/league/${leagueID}`);
if (String(leagueMeta.season) !== String(state.season) && state.season_type === "regular") {
  const anyOwner = (await get(`https://api.sleeper.app/v1/league/${leagueID}/rosters`))[0]?.owner_id;
  const candidates = anyOwner ? await get(`https://api.sleeper.app/v1/user/${anyOwner}/leagues/nfl/${state.season}`).catch(() => []) : [];
  const next = candidates.find((l) => String(l.previous_league_id) === String(leagueID));
  if (next) {
    console.log(`leagueInfo.js still points at the ${leagueMeta.season} league - following the chain to ${next.league_id} (${state.season}). Update src/lib/utils/leagueInfo.js when you can.`);
    leagueID = next.league_id; leagueMeta = next;
  } else {
    console.log(`leagueInfo.js points at the ${leagueMeta.season} league and no ${state.season} successor was found - update leagueID in src/lib/utils/leagueInfo.js.`);
    process.exit(0);
  }
}
const rosters = await get(`https://api.sleeper.app/v1/league/${leagueID}/rosters`);
const users = await get(`https://api.sleeper.app/v1/league/${leagueID}/users`);
const teamName = (rid) => {
  const r = rosters.find((x) => x.roster_id === rid);
  const u = users.find((x) => x.user_id === r?.owner_id);
  return (u?.metadata?.team_name || u?.display_name || `Roster ${rid}`).trim();
};
const allTeams = rosters.map((r) => teamName(r.roster_id));

// ── season gating: regular season only, stop at the playoffs ──────────
const playoffStart = Number(leagueMeta.settings?.playoff_week_start) || 15;
if (state.season_type !== "regular") { console.log(`NFL ${state.season_type} - the Parlay Builder only runs in the regular season.`); process.exit(0); }
const seasonOver = nflWeek >= playoffStart;

// ── the week's real deadline: 2h before the earliest kickoff, capped at Thu 6pm ET ──
const monday = new Date(etNow); monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7)); monday.setHours(0, 0, 0, 0);
const thursday6 = epochFromET(monday.getFullYear(), monday.getMonth(), monday.getDate() + 3, 18);
// kickoff times come from Sleeper itself (its GraphQL "scores" query, the
// same unauthenticated endpoint the tradeblock sync uses) - start_time is
// epoch ms. ESPN's public scoreboard is the fallback; if both fail, the
// deadline is simply the standard Thursday 6pm ET.
let earliestKick = null;
try {
  const r = await fetch("https://sleeper.com/graphql", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: `query { scores(sport: "nfl", season_type: "regular", season: "${state.season}", week: ${nflWeek}) { start_time status } }` }),
  });
  const d = await r.json();
  const times = (d.data?.scores || []).map((g) => Number(g.start_time)).filter((x) => x > Date.now() - 6 * 3600e3);
  if (times.length) earliestKick = Math.min(...times);
} catch { /* fall through to ESPN */ }
if (!earliestKick) {
  try {
    const sb = await get(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?seasontype=2&week=${nflWeek}`);
    const dates = (sb.events || []).map((e) => Date.parse(e.date)).filter((x) => x > Date.now() - 6 * 3600e3);
    if (dates.length) earliestKick = Math.min(...dates);
  } catch { /* neither source - standard deadline applies */ }
}
if (process.env.PARLAY_TEST_KICKOFF) earliestKick = Date.parse(process.env.PARLAY_TEST_KICKOFF); // test only
const deadline = earliestKick ? Math.min(thursday6, earliestKick - 2 * 3600e3) : thursday6;
const earlyWeek = deadline < thursday6 - 60e3;
const nagAt = deadline - 24 * 3600e3;
const deadlineLabel = `${etLabel(deadline)}${earlyWeek ? ` (early kickoff ${etLabel(earliestKick)})` : ""}`;

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
  { ts: "3", text: "🎯 LEG | Immigrants | Bijan anytime TD" },
  { ts: "2", text: "🎯 Bills -3.5", user: "US0P6RDSR" },
  { ts: "2.5", text: "Derrick Henry anytime td", user: "US7R5B3C3" },
  { ts: "2.6", text: "Bryan I don't even have time to do my real work lol, you're good", user: "US0P6RDSR" },
  { ts: "1", text: "🎰 *Week 3 Parlay Builder is OPEN* ...", bot_id: "B1", reply_count: 2 },
];
const DRY_REPLIES = [
  { ts: "1", text: "🎰 *Week 3 Parlay Builder is OPEN* ...", bot_id: "B1" },
  { ts: "1.1", text: "Vikings ML", user: "U02SQMEQ4R1" },
  { ts: "1.2", text: "I'll take Davante Adams anytime TD", user: "UTB8NMCLQ" },
  { ts: "1.3", text: "Garrett Wilson Anytime TD - free money", user: "URQFMR589" },
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
    if (method === "conversations.replies") return { messages: DRY_REPLIES, has_more: false, response_metadata: {} };
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

// legs submitted since Monday 00:00 ET this week (shared parser in
// src/lib/server/parlayCore.js - the instant events endpoint uses the same)
const readLegs = async () => {
  const oldest = String(Math.floor(monday.getTime() / 1000));
  const messages = []; const openers = [];
  for (let cursor = ""; ;) {
    const d = await slackGet("conversations.history", { channel: channelID, oldest, limit: 200, cursor });
    for (const msg of d.messages || []) { messages.push(msg); if (isOpener(msg.text) && msg.reply_count) openers.push(msg.ts); }
    cursor = d.response_metadata?.next_cursor;
    if (!cursor || !d.has_more) break;
  }
  const replies = [];
  for (const ts of openers) {
    for (let cursor = ""; ;) {
      const d = await slackGet("conversations.replies", { channel: channelID, ts, limit: 200, cursor });
      for (const msg of d.messages || []) if (msg.ts !== ts) replies.push(msg);
      cursor = d.response_metadata?.next_cursor;
      if (!cursor || !d.has_more) break;
    }
  }
  const teamOfUser = (uid) => (userTeam[uid] != null ? teamName(Number(userTeam[uid])) : null);
  const legs = collectLegs({ messages, replies, allTeams, teamOfUser });
  // acknowledge every registered leg with a ✅ (needs reactions:write; a
  // missing scope just logs a hint)
  let reactHint = false;
  for (const v of Object.values(legs)) {
    try { await slack("reactions.add", { channel: channelID, timestamp: v.ts, name: "white_check_mark" }); }
    catch (err) { const m = String(err.message); if (/already_reacted/.test(m)) continue; if (/missing_scope|not_allowed/.test(m)) reactHint = true; }
  }
  if (reactHint) console.log("Can't ✅ legs: add the reactions:write scope to the Slack app and reinstall it.");
  return Object.fromEntries(Object.entries(legs).map(([t, v]) => [t, v.leg]));
};

// ── what has the bot already posted this week? (dedupe for tick) ──────
const postedThisWeek = async () => {
  const oldest = String(Math.floor(monday.getTime() / 1000));
  const flags = { opener: false, nag: false, slip: false, signoff: false, boardTs: null };
  for (let cursor = ""; ;) {
    const d = await slackGet("conversations.history", { channel: channelID, oldest, limit: 200, cursor });
    for (const m of d.messages || []) {
      if (!m.bot_id) continue;
      const t = m.text || "";
      if (isOpener(t)) flags.opener = true;
      if (/legs in\.\*|All \d+ legs are in/.test(t)) flags.nag = true;
      // only a slip posted at the real deadline counts as a lock - an early
      // manual compile (or a test) just becomes the live board again
      if (isLockedBoard(t) && Number(m.ts) * 1000 >= deadline - 30 * 60e3) flags.slip = true;
      if (isBoard(t) && !flags.boardTs) flags.boardTs = m.ts; // newest wins
      if (/wrap on the Parlay Builder/.test(t)) flags.signoff = true;
    }
    cursor = d.response_metadata?.next_cursor;
    if (!cursor || !d.has_more) break;
  }
  return flags;
};

// ── the live board: a pinned message the bot edits as legs land ──────────
const renderBoard = (legs, locked) => renderBoardCore({
  legs, allTeams, week: nflWeek, placerName: placer?.name || null, deadlineLabel,
  kickoffLabel: etLabel(earliestKick || thursday6 + 2 * 3600e3), locked,
});
let boardTs = null;
const updateBoard = async (legs, locked = false) => {
  const text = renderBoard(legs, locked);
  if (boardTs) {
    await slack("chat.update", { channel: channelID, ts: boardTs, text });
  } else {
    const res = await slack("chat.postMessage", { channel: channelID, text });
    boardTs = res.ts;
    await slack("pins.add", { channel: channelID, timestamp: boardTs }).catch(() => {});
  }
  return boardTs;
};

const postOpener = async () => {
  const hook = placer
    ? `On the hook this week: *${placer.name}* (league-low ${placer.pts} last week). They place the bet.`
    : `First week - agree on who places it, or nominate last season's Toilet Bowl champ for old times' sake.`;
  await slack("chat.postMessage", {
    channel: channelID,
    text: `🎰 *Week ${nflWeek} Parlay Builder is OPEN*\n${hook}\n*Post your leg here* - just the bet, e.g. "Vikings ML" - we know whose team you are, and you'll get a ✅ when it's logged. (Entering one for someone else? Post \`🎯 LEG | Their Team | the leg\`.)\n*Legs lock ${deadlineLabel}.* Miss it and the placer picks your leg for you - no appeals.`,
  });
  await updateBoard(await readLegs(), false);
  console.log(`opened week ${nflWeek}; deadline ${deadlineLabel}; board pinned`);
};
const postNag = async () => {
  const legs = await readLegs();
  const missing = allTeams.filter((t) => !legs[t]);
  if (!missing.length) {
    await slack("chat.postMessage", { channel: channelID, text: `✅ All ${allTeams.length} legs are in for week ${nflWeek}. Slip drops ${deadlineLabel}.` });
  } else {
    await slack("chat.postMessage", {
      channel: channelID,
      text: `⏰ *${Object.keys(legs).length}/${allTeams.length} legs in.* Still missing: ${missing.map((t) => `*${t}*`).join(", ")}.\nDeadline is *${deadlineLabel}* - after that the placer chooses for you, and history says they will not be kind.`,
    });
  }
  await updateBoard(legs, false);
  console.log(`nagged; ${missing.length} team(s) missing`);
};
const postSlip = async () => {
  const legs = await readLegs();
  const inCount = Object.keys(legs).length;
  const missing = allTeams.filter((t) => !legs[t]);
  await updateBoard(legs, true); // the pinned board becomes the final slip
  const placerLine = placer ? `*${placer.name}*, you're up` : "placer TBD";
  await slack("chat.postMessage", {
    channel: channelID,
    text: `🔒 *Week ${nflWeek} legs are locked* - ${inCount}/${allTeams.length} in. The pinned slip is final; ${placerLine}.${missing.length ? ` Placer picks for: ${missing.join(", ")}.` : ""}`,
  });
  console.log(`locked ${inCount}/${allTeams.length} legs for week ${nflWeek}`);
};
const postSignoff = async () => {
  await slack("chat.postMessage", { channel: channelID, text: `🏁 That's a wrap on the ${state.season} Parlay Builder - ${playoffStart - 1} weeks of legs, one slip a week, and at least one bet that hit. Back next September. Good luck in the playoffs (and the Toilet Bowl).` });
  console.log("season sign-off posted");
};

// ── modes ─────────────────────────────────────────────────────────────────
if (MODE === "tick") {
  const flags = FORCE ? { opener: false, nag: false, slip: false, signoff: false, boardTs: null } : await postedThisWeek();
  boardTs = flags.boardTs;
  const now = Date.now();
  const tuesday10 = epochFromET(monday.getFullYear(), monday.getMonth(), monday.getDate() + 1, 10);
  if (seasonOver) {
    if (nflWeek === playoffStart && now >= tuesday10 && !flags.signoff) await postSignoff(); else console.log("season over - nothing to do");
  } else if (now >= deadline && !flags.slip) {
    await postSlip();
  } else if (now >= nagAt && now < deadline && !flags.nag) {
    if (!flags.opener) await postOpener();
    await postNag();
  } else if (now >= tuesday10 && now < nagAt && !flags.opener) {
    await postOpener();
  } else if (!flags.slip && flags.opener) {
    const legs = await readLegs();          // ✅ new legs, refresh the pinned board
    await updateBoard(legs, false);
    console.log(`board refreshed: ${Object.keys(legs).length}/${allTeams.length} legs (deadline ${deadlineLabel})`);
  } else {
    console.log(`nothing due (deadline ${deadlineLabel}; opener ${flags.opener}, nag ${flags.nag}, slip ${flags.slip})`);
  }
} else if (MODE === "open") {
  boardTs = (await postedThisWeek()).boardTs;
  if (seasonOver) { if (nflWeek === playoffStart) await postSignoff(); else console.log("season over"); } else await postOpener();
} else if (MODE === "nag") {
  boardTs = (await postedThisWeek()).boardTs;
  await postNag();
} else if (MODE === "compile") {
  boardTs = (await postedThisWeek()).boardTs;
  await postSlip();
}
