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
    tick     every 15 min from cron, all week. Works out what's due and posts it:
             the Tuesday opener (10am ET+), the nag (24h before the
             deadline), the slip (at the deadline). Each posts at most once
             per week - it checks the channel first - so a delayed or
             doubled cron is harmless.
    open | nag | compile   force one step by hand (used with --force).

  THE DEADLINE FOLLOWS THE REAL SCHEDULE: 15 minutes before the kickoff of
  the earliest game that has a leg in it (ESPN's scoreboard, which also
  supplies the DraftKings lines and the bye list). Thursday night's game if
  anyone has a leg in it; otherwise the next game up. It moves as legs are
  added. Without a slate it falls back to Sleeper's earliest kickoff, then
  Thursday 8:15pm ET. Everything is computed in Eastern time, so DST never
  shifts it. Legs for a team on a bye, or a game inside its last 15
  minutes, get a ⚠️ and don't count.

  SEASON: runs only in the NFL regular season and stops at the league's
  playoff_week_start (posting one sign-off), so playoff weeks are quiet.

  Needs: SLACK_BOT_TOKEN (xoxb-, scopes: chat:write, channels:history,
  channels:read) with the bot invited to the channel.
*/

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { boardUnchanged, isBoard, isOpener, isStaleLock, lockNoticeOf, parseBoardHeader, reactionPlan, renderBoard as renderBoardCore, renderInvalidLeg, renderLockNotice, seasonRecord as seasonRecordCore, weekFlags } from "../src/lib/server/parlayCore.js";
import { reopenWeek } from "../src/lib/server/parlayReopen.js";
import { LOCK_LEAD_MS, evaluateWeek, fetchSlate, lockTime, parseSlate, priceLegs } from "../src/lib/server/parlaySlate.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const MODE = process.argv[2];
const TOKEN = process.env.SLACK_BOT_TOKEN;
const CHANNEL_NAME = process.env.PARLAY_CHANNEL || "weeklyparlaybuilder";

if (!["tick", "open", "nag", "compile"].includes(MODE)) {
  console.error("usage: node scripts/parlay-bot.mjs tick|open|nag|compile [--force] [--dry]");
  process.exit(1);
}
const DRY = process.argv.includes("--dry"); // print messages instead of posting
if (DRY) console.log(`DRY RUN - Slack is stubbed; legs come from ${process.env.PARLAY_TEST_FIXTURE ? "the test fixture" : "built-in sample data"}, NOT your channel.`);
if (!TOKEN && !DRY) {
  console.log("SLACK_BOT_TOKEN not set - add it as a repo Actions secret to enable the Parlay Builder bot.");
  process.exit(0);
}

// ── time helpers (everything in Eastern) ──────────────────────────────
const NOW = Number(process.env.PARLAY_TEST_NOW) || Date.now(); // test-only clock override
const etNow = new Date(new Date(NOW).toLocaleString("en-US", { timeZone: "America/New_York" }));
const etOffsetMs = NOW - Date.UTC(etNow.getFullYear(), etNow.getMonth(), etNow.getDate(), etNow.getHours(), etNow.getMinutes(), etNow.getSeconds());
const epochFromET = (y, m, d, h, min = 0) => Date.UTC(y, m, d, h, min) + etOffsetMs; // ET wall time → epoch ms
const etLabel = (ms) => new Date(ms).toLocaleString("en-US", { timeZone: "America/New_York", weekday: "long", hour: "numeric", minute: "2-digit" }).replace(":00", "") + " ET";

// ── league context ────────────────────────────────────────────────────────
const leagueInfo = readFileSync(join(root, "src/lib/utils/leagueInfo.js"), "utf8");
let userTeam = {}, seedResults = {};
try { const cfg = JSON.parse(readFileSync(join(root, "static/data/parlay-managers.json"), "utf8")); userTeam = cfg.users || {}; seedResults = cfg.seedResults || {}; } catch { /* map optional */ }
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

// ── the week's real deadline: 15 min before the first game that has a leg ──
const monday = new Date(etNow); monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7)); monday.setHours(0, 0, 0, 0);
const mondayEpochMs = epochFromET(monday.getFullYear(), monday.getMonth(), monday.getDate(), 0); // Monday 00:00 ET, as epoch
const thursdayKick = epochFromET(monday.getFullYear(), monday.getMonth(), monday.getDate() + 3, 20, 15); // the usual TNF kickoff, last-resort fallback
// ESPN's scoreboard: kickoffs, byes and DraftKings game lines. Optional - if
// it can't be had, the bot still runs (no validation, no odds, simpler deadline).
const slate = process.env.PARLAY_TEST_SLATE ? parseSlate(JSON.parse(readFileSync(process.env.PARLAY_TEST_SLATE, "utf8"))) : DRY ? null : await fetchSlate(nflWeek); // dry runs stay offline unless a test slate is supplied
// Sleeper's own GraphQL scores feed (start_time = epoch ms) is the kickoff fallback when ESPN is down
let earliestKick = slate?.firstKickoffMs || null;
if (!earliestKick) {
  try {
    const r = await fetch("https://sleeper.com/graphql", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: `query { scores(sport: "nfl", season_type: "regular", season: "${state.season}", week: ${nflWeek}) { start_time status } }` }),
    });
    const d = await r.json();
    const times = (d.data?.scores || []).map((g) => Number(g.start_time)).filter((x) => x > NOW - 6 * 3600e3);
    if (times.length) earliestKick = Math.min(...times);
  } catch { /* standard Thursday fallback applies */ }
}
if (process.env.PARLAY_TEST_KICKOFF) earliestKick = Date.parse(process.env.PARLAY_TEST_KICKOFF); // test only
let deadline = slate ? lockTime([], slate, NOW) : (earliestKick || thursdayKick) - LOCK_LEAD_MS; // refined below once legs are known
let nagAt = deadline - 24 * 3600e3;
let deadlineLabel = etLabel(deadline);
const setDeadline = (ms) => { if (ms && ms !== deadline) { deadline = ms; nagAt = ms - 24 * 3600e3; deadlineLabel = etLabel(ms); } };

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
    if (method === "bookmarks.list") return { bookmarks: [] };
    if (method === "chat.getPermalink") return { permalink: "https://slack.example/dry" };
    const fx = process.env.PARLAY_TEST_FIXTURE ? JSON.parse(readFileSync(process.env.PARLAY_TEST_FIXTURE, "utf8")) : null; // test-only
    if (method === "conversations.history") return { messages: fx?.messages || DRY_HISTORY, has_more: false, response_metadata: {} };
    if (method === "conversations.replies") return { messages: Array.isArray(fx?.replies) ? fx.replies : (fx?.replies?.[params.ts] || (fx ? [] : DRY_REPLIES)), has_more: false, response_metadata: {} };
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

// this week's channel (+ opener thread replies), read once per run and
// shared by every step below
let weekCache = null;
const loadWeek = async () => {
  if (weekCache) return weekCache;
  const oldest = String(Math.floor(mondayEpochMs / 1000));
  const messages = []; const openers = [];
  for (let cursor = ""; ;) {
    const d = await slackGet("conversations.history", { channel: channelID, oldest, limit: 200, cursor });
    for (const msg of d.messages || []) { messages.push(msg); if ((isOpener(msg.text) || (msg.bot_id && isBoard(msg.text))) && msg.reply_count) openers.push(msg.ts); } // legs replied under the opener OR the pinned board
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
  return (weekCache = { messages, replies });
};

// legs this week (shared parser in src/lib/server/parlayCore.js - the
// instant events endpoint uses the same). ✅ marks the leg that counts:
// added where missing, removed from legs a newer post replaced.
const selfUserId = DRY ? null : (await slack("auth.test", {}).catch(() => null))?.user_id || null;
const playerCache = new Map();
if (process.env.PARLAY_TEST_PLAYERS) for (const [k, v] of Object.entries(JSON.parse(readFileSync(process.env.PARLAY_TEST_PLAYERS, "utf8")))) playerCache.set(k, v); // test only: name → team, no ESPN lookups
let evalCache = null;
const teamOfUserFn = (uid) => (userTeam[uid] != null ? teamName(Number(userTeam[uid])) : null);
// legs + rejected + the lock time, worked out once per run
const evalLegs = async () => {
  if (evalCache) return evalCache;
  const { messages, replies } = await loadWeek();
  evalCache = await evaluateWeek({ messages, replies, allTeams, teamOfUser: teamOfUserFn, slate, nowMs: NOW, cache: playerCache });
  return evalCache;
};
const readLegs = async () => {
  const { messages, replies } = await loadWeek();
  const ev = await evalLegs();
  const legs = priceLegs(ev.legs, slate, ev.playerTeams); // { team: { leg, ts, msg, odds } } - odds only when we have a slate
  const plan = reactionPlan({ messages, replies, legs, selfUserId, rejected: ev.rejected });
  let reactHint = false;
  const react = async (method, ts, name = "white_check_mark") => {
    try { await slack(method, { channel: channelID, timestamp: ts, name }); }
    catch (err) { if (/missing_scope|not_allowed/.test(String(err.message))) reactHint = true; }
  };
  for (const ts of plan.add) await react("reactions.add", ts);
  for (const ts of plan.remove) await react("reactions.remove", ts);
  for (const ts of plan.unwarn) await react("reactions.remove", ts, "warning");
  for (const r of plan.warn) { // can't be played (bye / game closed): ⚠️ and say why, once per message
    await react("reactions.add", r.ts, "warning");
    await slack("chat.postMessage", { channel: channelID, thread_ts: r.msg?.thread_ts || r.ts, text: renderInvalidLeg({ user: r.msg?.user, leg: r.leg, reason: r.reason }) }).catch(() => {});
  }
  if (reactHint) console.log("Can't ✅ legs: add the reactions:write scope to the Slack app and reinstall it.");
  return legs;
};

// ── season parlay record: "Week N legs are locked" notices + the hit/miss
// verdict managers reply with (thread or a short post before the next opener)
const readSeasonRecord = async () => {
  const oldest = String(Math.floor(Date.UTC(Number(state.season), 8, 1) / 1000)); // Sep 1
  const messages = [];
  for (let cursor = ""; ;) {
    const d = await slackGet("conversations.history", { channel: channelID, oldest, limit: 200, cursor });
    messages.push(...(d.messages || []));
    cursor = d.response_metadata?.next_cursor;
    if (!cursor || !d.has_more) break;
  }
  const repliesByTs = {};
  for (const m of messages) {
    if (m.bot_id && /Week \d+ legs are locked/i.test(m.text || "") && m.reply_count) {
      const d = await slackGet("conversations.replies", { channel: channelID, ts: m.ts, limit: 200 }).catch(() => ({ messages: [] }));
      repliesByTs[m.ts] = (d.messages || []).filter((r) => r.ts !== m.ts);
    }
  }
  const teamOfUser = (uid) => (userTeam[uid] != null ? teamName(Number(userTeam[uid])) : null);
  return seasonRecordCore({ messages, teamOfUser, repliesByTs, seed: seedResults[String(state.season)] || {} });
};
const recordLine = (rec) => {
  if (!rec.byWeek.length) return "";
  const last = rec.byWeek[rec.byWeek.length - 1];
  const lastNote = last.result ? ` · last week ${last.result === "hit" ? "HIT 🎉" : "missed"}` : ` · last week's result not reported yet - reply hit/miss under the lock notice`;
  return `Season parlay record: *${rec.wins}-${rec.losses}*${lastNote}.`;
};

// ── what has the bot already posted this week? (dedupe for tick) ──────
const postedThisWeek = async () => weekFlags((await loadWeek()).messages, deadline);

// ── the live board: a pinned message the bot edits as legs land ──────────
const renderBoard = (legs, locked) => renderBoardCore({
  legs, allTeams, week: nflWeek, placerName: placer?.name || null, deadlineLabel, deadlineEpochMs: deadline,
  kickoffLabel: etLabel(deadline + LOCK_LEAD_MS), locked,
});
let boardTs = null;
let boardText = null;
const adoptBoard = async (flags) => {
  boardTs = flags.board?.ts || null;
  boardText = flags.board?.text || null;
  // one pinned board per week: unpin leftovers (early manual runs, reposts)
  for (const ts of flags.staleBoards) await slack("pins.remove", { channel: channelID, timestamp: ts }).catch(() => {});
};
// a bookmark at the top of the channel (desktop + mobile) that always points
// at the current board / slip. Needs bookmarks:read + bookmarks:write; if
// the app lacks them we just log once and carry on.
let bookmarkHint = false;
const syncBookmark = async (title) => {
  if (!boardTs) return;
  try {
    const link = (await slackGet("chat.getPermalink", { channel: channelID, message_ts: boardTs })).permalink;
    const mine = ((await slackGet("bookmarks.list", { channel_id: channelID })).bookmarks || []).find((b) => /^(?:📋|🔒|:clipboard:|:lock:)/.test(b.title || ""));
    if (mine) await slack("bookmarks.edit", { channel_id: channelID, bookmark_id: mine.id, title, link });
    else await slack("bookmarks.add", { channel_id: channelID, type: "link", title, link, emoji: ":slot_machine:" });
  } catch (err) {
    if (/missing_scope|not_allowed/.test(String(err.message)) && !bookmarkHint) { bookmarkHint = true; console.log("Can't manage the channel bookmark: add bookmarks:read + bookmarks:write to the Slack app and reinstall it."); }
  }
};
const updateBoard = async (legs, locked = false) => {
  const text = renderBoard(legs, locked);
  if (boardTs && boardText && boardUnchanged(boardText, text)) return false; // nothing new
  if (boardTs) {
    await slack("chat.update", { channel: channelID, ts: boardTs, text });
    boardText = text;
  } else {
    const res = await slack("chat.postMessage", { channel: channelID, text });
    boardTs = res.ts;
    await slack("pins.add", { channel: channelID, timestamp: boardTs }).catch(() => {});
  }
  await syncBookmark(locked ? `🔒 Week ${nflWeek} slip` : `📋 Week ${nflWeek} board`);
  return true;
};

const postOpener = async () => {
  const hook = placer
    ? `On the hook this week: *${placer.name}* (league-low ${placer.pts} last week). They place the bet.`
    : `First week - agree on who places it, or nominate last season's Toilet Bowl champ for old times' sake.`;
  const rec = recordLine(await readSeasonRecord().catch(() => ({ wins: 0, losses: 0, byWeek: [] })));
  await slack("chat.postMessage", {
    channel: channelID,
    text: `🎰 *Week ${nflWeek} Parlay Builder is OPEN*\n${hook}${rec ? `\n${rec}` : ""}\n*Post your leg here* - just the bet, e.g. "Vikings ML" - we know whose team you are, and you'll get a ✅ when it's logged. (Entering one for someone else? Post \`🎯 LEG | Their Team | the leg\`.)\n*Legs lock ${deadlineLabel}* - 15 minutes before the first game that has a leg in it (Thursday night's game if anyone takes it, otherwise the next game up), so the lock can move. Miss it and the placer picks your leg for you - no appeals. Legs for teams on a bye get a ⚠️.`,
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
    // @mention every manager of a missing team (co-owners too): notifies
    // them even if they've muted the channel, and the tap lands them right
    // where they post the leg
    const usersByTeam = {};
    for (const [uid, rid] of Object.entries(userTeam)) (usersByTeam[teamName(Number(rid))] ||= []).push(uid);
    const lines = missing.map((t) => `• *${t}* ${(usersByTeam[t] || []).map((u) => `<@${u}>`).join(" ")}${placer && placer.name === t ? " _(you're placing it - get yours in too)_" : ""}`.trimEnd());
    await slack("chat.postMessage", {
      channel: channelID,
      text: `⏰ *${Object.keys(legs).length}/${allTeams.length} legs in* - locks *${deadlineLabel}*. Still missing:\n${lines.join("\n")}\nJust post your bet here. After the deadline the placer chooses for you, and history says they will not be kind.`,
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
  const usersByTeam = {};
  for (const [uid, rid] of Object.entries(userTeam)) (usersByTeam[teamName(Number(rid))] ||= []).push(uid);
  await slack("chat.postMessage", {
    channel: channelID,
    text: renderLockNotice({ legs, allTeams, week: nflWeek, placerName: placer?.name || null, placerMentions: placer ? usersByTeam[placer.name] || [] : [], kickoffLabel: etLabel(deadline + LOCK_LEAD_MS) }),
  });
  console.log(`locked ${inCount}/${allTeams.length} legs for week ${nflWeek}`);
};
const postSignoff = async () => {
  await slack("chat.postMessage", { channel: channelID, text: `🏁 That's a wrap on the ${state.season} Parlay Builder - ${playoffStart - 1} weeks of legs, one slip a week, and at least one bet that hit. Back next September. Good luck in the playoffs (and the Toilet Bowl).` });
  console.log("season sign-off posted");
};

// a week the old fixed-6PM rule locked before the legs' real cutoff: withdraw
// the notice, clear the 🔒 marks, announce it. The board itself is restored by
// the normal tick below (the lock is no longer in the channel by then).
const reopenIfStale = async () => {
  const { messages } = await loadWeek();
  const f = weekFlags(messages, deadline), ev = await evalLegs();
  const notice = lockNoticeOf(messages);
  if (!isStaleLock({ notice, header: f.board ? parseBoardHeader(f.board.text) : null, lockMs: ev.lockMs, nowMs: NOW })) return false;
  const legs = await readLegs();
  console.log(await reopenWeek({ slack, slackGet, channel: channelID, week: nflWeek, notice, messages, legs, lockLabel: etLabel(ev.lockMs), boardTs: f.board?.ts || null }));
  weekCache = null; evalCache = null; // re-read the channel: the notice no longer says "locked"
  return true;
};

// ── modes ─────────────────────────────────────────────────────────────────
setDeadline((await evalLegs()).lockMs); // the lock follows the legs (earliest game with a leg), so settle it before deciding what's due
if (MODE === "tick") {
  if (!seasonOver) await reopenIfStale();
  const flags = await postedThisWeek();
  await adoptBoard(flags);
  const now = NOW;
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
    const changed = await updateBoard(legs, false);
    console.log(`board ${changed ? "refreshed" : "already current"}: ${Object.keys(legs).length}/${allTeams.length} legs (deadline ${deadlineLabel})`);
  } else {
    console.log(`nothing due (deadline ${deadlineLabel}; opener ${flags.opener}, nag ${flags.nag}, slip ${flags.slip})`);
  }
} else if (MODE === "open") {
  await adoptBoard(await postedThisWeek());
  if (seasonOver) { if (nflWeek === playoffStart) await postSignoff(); else console.log("season over"); } else await postOpener();
} else if (MODE === "nag") {
  await adoptBoard(await postedThisWeek());
  await postNag();
} else if (MODE === "compile") {
  await adoptBoard(await postedThisWeek());
  await postSlip();
}
