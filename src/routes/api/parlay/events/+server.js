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
import { boardUnchanged, collectLegs, isBoard, isLockedBoard, isOpener, parseBoardHeader, reactionPlan, renderBoard, shouldRefreshForEvent } from "$lib/server/parlayCore.js";

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

const refreshBoard = async (selfUserId) => {
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

  // this week's channel history (+ opener thread replies) and the board
  const oldest = mondayTs();
  const messages = []; let board = null; const openers = [];
  for (let cursor = ""; ;) {
    const d = await slackGet("conversations.history", { channel, oldest, limit: 200, cursor });
    for (const m of d.messages || []) {
      messages.push(m);
      if (m.bot_id && isBoard(m.text) && !board) board = m; // newest first
      if ((isOpener(m.text) || (m.bot_id && isBoard(m.text))) && m.reply_count) openers.push(m.ts); // opener OR board threads
    }
    cursor = d.response_metadata?.next_cursor;
    if (!cursor || !d.has_more) break;
  }
  if (!board || isLockedBoard(board.text)) return "no live board"; // before the opener, or already locked
  const replies = [];
  for (const ts of openers) {
    const d = await slackGet("conversations.replies", { channel, ts, limit: 200 });
    for (const m of d.messages || []) if (m.ts !== ts) replies.push(m);
  }
  const legs = collectLegs({ messages, replies, allTeams, teamOfUser });
  // ✅ = "this is the leg that counts": add where missing, drop from replaced legs
  const plan = reactionPlan({ messages, replies, legs, selfUserId });
  for (const ts of plan.add) await slack("reactions.add", { channel, timestamp: ts, name: "white_check_mark" }).catch(() => {});
  for (const ts of plan.remove) await slack("reactions.remove", { channel, timestamp: ts, name: "white_check_mark" }).catch(() => {});
  const header = parseBoardHeader(board.text) || { week: 0, placerName: null, deadlineLabel: "" };
  const next = renderBoard({ legs, allTeams, ...header, locked: false });
  if (boardUnchanged(board.text, next)) return `board already current (${Object.keys(legs).length}/${allTeams.length})`;
  await slack("chat.update", { channel, ts: board.ts, text: next });
  return `board refreshed: ${Object.keys(legs).length}/${allTeams.length}`;
};

export async function POST(event) {
  const raw = await event.request.text();
  if (!verify(raw, event.request.headers)) return textResponse("bad signature", { status: 401 });
  let body;
  try { body = JSON.parse(raw); } catch { return textResponse("bad json", { status: 400 }); }

  // Slack's one-time URL verification handshake
  if (body.type === "url_verification") return json({ challenge: body.challenge });

  // only human posts/edits/deletes - never the bot's own board edits, which
  // Slack echoes back as message_changed events (that would loop forever)
  const selfUserId = body.authorizations?.[0]?.user_id;
  const relevant = body.type === "event_callback" && shouldRefreshForEvent(body.event, CHANNEL(), selfUserId);
  if (relevant && env.SLACK_BOT_TOKEN) {
    const work = refreshBoard(selfUserId).then((r) => console.log(`parlay events: ${r}`)).catch((e) => console.error(`parlay events: ${e.message}`));
    try { event.platform?.context?.waitUntil?.(work); } catch { /* best effort */ }
    if (!event.platform?.context?.waitUntil) await work; // local dev: no background runtime
  }
  return textResponse("ok"); // Slack wants a fast 200 regardless
}
