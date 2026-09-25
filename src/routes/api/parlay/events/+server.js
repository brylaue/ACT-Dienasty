/*
  Slack Events API receiver for the Parlay Builder.

  Slack POSTs here the instant anything is posted in #weeklyparlaybuilder.
  We verify Slack's signature, answer 200 right away, then in the background:
  re-read this week's legs, ✅ each registered one, and edit the pinned
  board in place. The cron script still handles the scheduled parts
  (opener, nag, lock); this makes the board live between them.

  Env (Vercel): SLACK_BOT_TOKEN (same token as the GitHub secret),
  SLACK_SIGNING_SECRET (Slack app → Basic Information → Signing Secret).
  Optional PARLAY_CHANNEL_ID (defaults to the league's channel).
*/
import { json, text as textResponse } from "@sveltejs/kit";
import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "$env/dynamic/private";
import { leagueID } from "$lib/utils/leagueInfo";
import managers from "../../../../../static/data/parlay-managers.json";
import { PARLAY_RULES, addressedToBot, answerParlayQuestion, boardUnchanged, isLeagueQuestion, oracleForSlack, renderLockNotice, collectLegs, isBoard, isLockedBoard, isOpener, parseBoardHeader, reactionPlan, renderBoard, seasonRecord, shouldRefreshForEvent } from "$lib/server/parlayCore.js";

export const config = { maxDuration: 60 }; // an Oracle hand-off can take 10-20s

const CHANNEL = () => env.PARLAY_CHANNEL_ID || "C09EEV8M32S";

const verify = (raw, headers) => {
  const secret = env.SLACK_SIGNING_SECRET;
  if (!secret) return false;
  const ts = headers.get("x-slack-request-timestamp");
  const sig = headers.get("x-slack-signature") || "";
  if (!ts || Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false; // replay window
  const mac = "v0=" + createHmac("sha256", secret).update(`v0:${ts}:${raw}`).digest("hex");
  return mac.length === sig.length && timingSafeEqual(Buffer.from(mac), Buffer.from(sig));
};

const slack = async (method, payload) => {
  const r = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8", authorization: `Bearer ${env.SLACK_BOT_TOKEN}` },
    body: JSON.stringify(payload),
  });
  const d = await r.json();
  if (!d.ok) throw new Error(`${method}: ${d.error}`);
  return d;
};
const slackGet = async (method, params) => {
  const r = await fetch(`https://slack.com/api/${method}?${new URLSearchParams(params)}`, { headers: { authorization: `Bearer ${env.SLACK_BOT_TOKEN}` } });
  const d = await r.json();
  if (!d.ok) throw new Error(`${method}: ${d.error}`);
  return d;
};

// Monday 00:00 ET of the current week, as a Slack "oldest" ts
const mondayTs = () => {
  const et = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  const offset = Date.now() - Date.UTC(et.getFullYear(), et.getMonth(), et.getDate(), et.getHours(), et.getMinutes(), et.getSeconds());
  et.setDate(et.getDate() - ((et.getDay() + 6) % 7)); et.setHours(0, 0, 0, 0);
  return String(Math.floor((Date.UTC(et.getFullYear(), et.getMonth(), et.getDate()) + offset) / 1000));
};

// everything the webhook knows about the week, loaded once per event
const loadWeek = async () => {
  const channel = CHANNEL();
  const [rosters, users] = await Promise.all([
    fetch(`https://api.sleeper.app/v1/league/${leagueID}/rosters`).then((r) => r.json()),
    fetch(`https://api.sleeper.app/v1/league/${leagueID}/users`).then((r) => r.json()),
  ]);
  const teamName = (rid) => {
    const r = rosters.find((x) => x.roster_id === rid);
    const u = users.find((x) => x.user_id === r?.owner_id);
    return (u?.metadata?.team_name || u?.display_name || `Roster ${rid}`).trim();
  };
  const allTeams = rosters.map((r) => teamName(r.roster_id));
  const teamOfUser = (uid) => (managers.users?.[uid] != null ? teamName(Number(managers.users[uid])) : null);
  const usersByTeam = {};
  for (const [uid, rid] of Object.entries(managers.users || {})) (usersByTeam[teamName(Number(rid))] ||= []).push(uid);

  // this week's channel history (+ opener/board thread replies) and the board
  const oldest = mondayTs();
  const messages = []; let board = null; const threads = []; let lockNotice = false;
  for (let cursor = ""; ;) {
    const d = await slackGet("conversations.history", { channel, oldest, limit: 200, cursor });
    for (const m of d.messages || []) {
      messages.push(m);
      if (m.bot_id && isBoard(m.text) && !board) board = m; // newest first
      if (m.bot_id && /legs are locked/i.test(m.text || "")) lockNotice = true;
      if ((isOpener(m.text) || (m.bot_id && isBoard(m.text))) && m.reply_count) threads.push(m.ts);
    }
    cursor = d.response_metadata?.next_cursor;
    if (!cursor || !d.has_more) break;
  }
  const replies = [];
  for (const ts of threads) {
    const d = await slackGet("conversations.replies", { channel, ts, limit: 200 });
    for (const m of d.messages || []) if (m.ts !== ts) replies.push(m);
  }
  const legs = collectLegs({ messages, replies, allTeams, teamOfUser });
  const header = board ? parseBoardHeader(board.text) : null;
  return { channel, allTeams, teamOfUser, usersByTeam, messages, replies, board, header, legs, lockNotice };
};

// the cron locks at the deadline, but GitHub sometimes runs it late. The
// board carries the deadline; if it has passed and the week isn't locked,
// lock it from here - whatever message just arrived was the trigger.
const lockIfDue = async (ctx) => {
  const { board, header, legs, allTeams, channel } = ctx;
  if (!board || !header?.deadlineEpochMs || isLockedBoard(board.text) || ctx.lockNotice) return null;
  if (Date.now() < header.deadlineEpochMs) return null;
  const week = header.week, placerName = header.placerName;
  await slack("chat.update", { channel, ts: board.ts, text: renderBoard({ legs, allTeams, week, placerName, deadlineLabel: header.deadlineLabel, deadlineEpochMs: header.deadlineEpochMs, locked: true }) });
  await slack("chat.postMessage", { channel, text: renderLockNotice({ legs, allTeams, week, placerName, placerMentions: placerName ? ctx.usersByTeam[placerName] || [] : [] }) });
  try {
    const link = (await slackGet("chat.getPermalink", { channel, message_ts: board.ts })).permalink;
    const mine = ((await slackGet("bookmarks.list", { channel_id: channel })).bookmarks || []).find((b) => /^(?:📋|🔒|:clipboard:|:lock:)/.test(b.title || ""));
    if (mine) await slack("bookmarks.edit", { channel_id: channel, bookmark_id: mine.id, title: `🔒 Week ${week} slip`, link });
  } catch { /* bookmark scopes optional */ }
  return `locked via event (${Object.keys(legs).length}/${allTeams.length})`;
};

// season parlay record (only fetched when someone asks for it)
const loadRecord = async (ctx) => {
  const oldest = String(Math.floor(Date.UTC(new Date().getFullYear(), 8, 1) / 1000)); // Sep 1
  const messages = [];
  for (let cursor = ""; ;) {
    const d = await slackGet("conversations.history", { channel: ctx.channel, oldest, limit: 200, cursor });
    messages.push(...(d.messages || []));
    cursor = d.response_metadata?.next_cursor;
    if (!cursor || !d.has_more) break;
  }
  const repliesByTs = {};
  for (const m of messages) {
    if (m.bot_id && /Week \d+ legs are locked/i.test(m.text || "") && m.reply_count) {
      const d = await slackGet("conversations.replies", { channel: ctx.channel, ts: m.ts, limit: 200 }).catch(() => ({ messages: [] }));
      repliesByTs[m.ts] = (d.messages || []).filter((r) => r.ts !== m.ts);
    }
  }
  return seasonRecord({ messages, teamOfUser: ctx.teamOfUser, repliesByTs });
};

const refreshBoard = async (selfUserId, ctx) => {
  const { channel, allTeams, messages, replies, board, header, legs } = ctx;
  if (!board || isLockedBoard(board.text)) return "no live board"; // before the opener, or already locked
  // ✅ = "this is the leg that counts": add where missing, drop from replaced legs
  const plan = reactionPlan({ messages, replies, legs, selfUserId });
  for (const ts of plan.add) await slack("reactions.add", { channel, timestamp: ts, name: "white_check_mark" }).catch(() => {});
  for (const ts of plan.remove) await slack("reactions.remove", { channel, timestamp: ts, name: "white_check_mark" }).catch(() => {});
  const next = renderBoard({ legs, allTeams, ...(header || { week: 0, placerName: null, deadlineLabel: "" }), locked: false });
  if (boardUnchanged(board.text, next)) return `board already current (${Object.keys(legs).length}/${allTeams.length})`;
  await slack("chat.update", { channel, ts: board.ts, text: next });
  return `board refreshed: ${Object.keys(legs).length}/${allTeams.length}`;
};

// free-form questions the rule intents don't cover: ask Claude, grounded
// ONLY in the bot's rules and the live week. Short, deadpan, no invention.
const aiAnswer = async (question, snapshot) => {
  if (!env.ANTHROPIC_API_KEY) return null;
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001", max_tokens: 200,
      system: `You are the Parlay Builder, a Slack bot for a fantasy football league's weekly group parlay. If the question is about the parlay, answer in one or two short, dry sentences (under 60 words) using ONLY the rules and live status below; if the rules don't cover it, say so and point them to Bryan (the human who built you). If the question is about anything else - trivia, life advice, who to bet on, the weather - reply with ONE deadpan, league-appropriate quip (under 25 words) that makes clear you only do parlays. Never invent rules, odds, picks, or facts; never share or guess personal details; never be cruel about a specific person. Slack mrkdwn only (*bold*), no headers.\n\n${PARLAY_RULES}`,
      messages: [{ role: "user", content: `Live status: ${snapshot}\n\nQuestion: ${question}` }],
    }),
  });
  if (!r.ok) return null;
  const d = await r.json();
  return d.content?.find((b) => b.type === "text")?.text?.trim() || null;
};

// league history / bylaws questions → The Oracle on the site
const askOracle = async (origin, question) => {
  const r = await fetch(`${origin}/api/ask`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: question.slice(0, 300) }) });
  const d = await r.json().catch(() => ({}));
  return r.ok && d.answer ? d.answer : null;
};

// someone spoke to the bot - answer in a thread under their message
const respond = async (ev, selfUserId, ctx, origin) => {
  const record = /\b(record|season|tally|hit rate|standings|status|how (?:have|are) we)\b/i.test(ev.text || "") ? await loadRecord(ctx).catch(() => null) : null;
  const a = answerParlayQuestion(ev.text, {
    legs: ctx.legs, allTeams: ctx.allTeams, week: ctx.header?.week ?? null, placerName: ctx.header?.placerName ?? null,
    deadlineLabel: ctx.header?.deadlineLabel ?? "", record, usersByTeam: ctx.usersByTeam, askerTeam: ctx.teamOfUser(ev.user),
  });
  let text = a.text, how = a.leg ? "answered (leg logged)" : "answered";
  if (/^Not sure what you're after/.test(text) && isLeagueQuestion(ev.text)) {
    const oracle = await askOracle(origin, ev.text.replace(/<@[A-Z0-9]+>/g, "").trim()).catch(() => null);
    if (oracle) { text = oracleForSlack(oracle); how = "answered (oracle)"; }
  }
  if (/^Not sure what you're after/.test(text)) {
    const inCount = Object.keys(ctx.legs).length;
    const snapshot = ctx.header ? `Week ${ctx.header.week}, ${inCount}/${ctx.allTeams.length} legs in, placer ${ctx.header.placerName || "TBD"}, locks ${ctx.header.deadlineLabel}; asker's team: ${ctx.teamOfUser(ev.user) || "unknown"}` : "the week hasn't opened yet";
    const ai = await aiAnswer(ev.text, snapshot).catch(() => null);
    if (ai) { text = ai; how = "answered (ai)"; }
  }
  await slack("chat.postMessage", { channel: ctx.channel, thread_ts: ev.thread_ts || ev.ts, text });
  return how;
};

export async function POST(event) {
  const raw = await event.request.text();
  if (!verify(raw, event.request.headers)) return textResponse("bad signature", { status: 401 });
  if (event.request.headers.get("x-slack-retry-num")) return textResponse("ok"); // Slack re-delivery: we already handled it
  let body;
  try { body = JSON.parse(raw); } catch { return textResponse("bad json", { status: 400 }); }

  // Slack's one-time URL verification handshake
  if (body.type === "url_verification") return json({ challenge: body.challenge });

  // only human posts/edits/deletes - never the bot's own board edits, which
  // Slack echoes back as message_changed events (that would loop forever)
  const selfUserId = body.authorizations?.[0]?.user_id;
  const ev = body.event || {};
  const relevant = body.type === "event_callback" && shouldRefreshForEvent(ev, CHANNEL(), selfUserId);
  if (relevant && env.SLACK_BOT_TOKEN) {
    const talking = !ev.subtype && addressedToBot(ev.text, selfUserId); // "@Parlay Builder …" or "hey parlay builder …"
    const work = (async () => {
      const ctx = await loadWeek();
      const results = [];
      const locked = await lockIfDue(ctx);                         // deadline passed and cron hasn't locked? lock now
      results.push(locked || await refreshBoard(selfUserId, ctx)); // otherwise a leg (addressed or not) lands on the board
      if (talking) results.push(await respond(ev, selfUserId, ctx, new URL(event.request.url).origin));
      return results.join(" · ");
    })().then((r) => console.log(`parlay events: ${r}`)).catch((e) => console.error(`parlay events: ${e.message}`));
    try { event.platform?.context?.waitUntil?.(work); } catch { /* best effort */ }
    if (!event.platform?.context?.waitUntil) await work; // local dev: no background runtime
  }
  return textResponse("ok"); // Slack wants a fast 200 regardless
}
