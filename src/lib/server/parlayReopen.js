/*
  Reopen a week that was locked too early (see isStaleLock in parlayCore).
  I/O is injected so the cron script and the Slack events endpoint share it:
    slack(method, body)           → POST a Slack API method
    slackGet(method, params)      → GET one
  Everything is best-effort except the notice edit + announcement.
*/
import { renderReopened, renderRetractedNotice } from "./parlayCore.js";

const LATE_REPLY = /^(?::lock:|🔒)\s/; // the bot's own "Too late…" / late-leg replies

export const reopenWeek = async ({ slack, slackGet, channel, week, notice, messages, legs, lockLabel, boardText = null, boardTs = null, usersByTeam = {} }) => {
  // 1. the board goes back to the live version (the cron path re-renders it itself, so this is optional)
  if (boardText && boardTs) await slack("chat.update", { channel, ts: boardTs, text: boardText });
  // 2. withdraw the early notice - edited so it can no longer count as "locked"
  await slack("chat.update", { channel, ts: notice.ts, text: renderRetractedNotice({ week, lockLabel }) });
  // 3. posts made after it: drop the 🔒 and the bot's "too late" reply
  const after = (messages || []).filter((m) => !m.bot_id && Number(m.ts) > Number(notice.ts));
  let cleaned = 0;
  for (const m of after) {
    if ((m.reactions || []).some((r) => r.name === "lock")) { await slack("reactions.remove", { channel, timestamp: m.ts, name: "lock" }).catch(() => {}); cleaned++; }
    if (!m.reply_count) continue;
    const d = await slackGet("conversations.replies", { channel, ts: m.ts, limit: 50 }).catch(() => ({ messages: [] }));
    for (const r of d.messages || []) if (r.ts !== m.ts && r.bot_id && LATE_REPLY.test(r.text || "")) { await slack("chat.delete", { channel, ts: r.ts }).catch(() => {}); cleaned++; }
  }
  // 4. the bookmark points at a board again, not a slip
  if (boardTs) {
    try {
      const link = (await slackGet("chat.getPermalink", { channel, message_ts: boardTs })).permalink;
      const mine = ((await slackGet("bookmarks.list", { channel_id: channel })).bookmarks || []).find((b) => /^(?:📋|🔒|:clipboard:|:lock:)/.test(b.title || ""));
      if (mine) await slack("bookmarks.edit", { channel_id: channel, bookmark_id: mine.id, title: `📋 Week ${week} board`, link });
    } catch { /* bookmark scopes optional */ }
  }
  // 5. say what happened, naming the posts that now count
  const rescued = Object.entries(legs || {})
    .filter(([, v]) => v?.ts && Number(v.ts) > Number(notice.ts))
    .map(([team, v]) => ({ team, leg: v.leg, mention: v.msg?.user ? `<@${v.msg.user}>` : "" }));
  await slack("chat.postMessage", { channel, text: renderReopened({ week, lockLabel, rescued }) });
  return `reopened week ${week}: lock now ${lockLabel}, ${rescued.length} late leg(s) rescued, ${cleaned} lock marks cleaned`;
};
