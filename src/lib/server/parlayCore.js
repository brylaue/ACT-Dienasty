/*
  Parlay Builder core - pure functions shared by the cron script
  (scripts/parlay-bot.mjs) and the instant Slack events endpoint
  (src/routes/api/parlay/events). No I/O in here.
*/

export const cleanLeg = (t) => String(t || "")
  .replace(/\s*\*?sent using\*?.*$/i, "")   // client signatures ("*Sent using* Claude")
  .replace(/^[\s🎯🎰:\-–—]+/u, "")
  .replace(/^(?:i'?ll take|i'?ll go with|i'?ll go|i'?ll do|i'?ll ride|i got|i'?m taking|i'?m going with|i want|i like|going with|riding with|put me down for|put me in for|give me|gimme|let'?s do|let'?s go|my leg is|my leg:|leg:)\s+/i, "")
  .replace(/\s+(?:for me|for us|please|pls|plz|this week|tonight|today)[.!]*$/i, "")
  .replace(/[.!]+$/, "")
  .replace(/\s+/g, " ").trim();

// a plain message from a known manager counts as a leg when it reads like a
// bet: short, no question, betting vocabulary, and none of the pronouns /
// helper verbs that mark conversation ("that TD will lead us to glory",
// "we're not betting to win $70" are chat, "Bills -3.5" is a bet).
// Callers pass cleaned text, so "I'll take X anytime TD" → "X anytime TD".
const CHATTER = /\b(you|your|you're|guys|lol|lmao|haha|thanks|thank|sorry|please|pls|send|bets|everyone|reminder|deadline|placed|submitted|bet is|slip|i|i'm|im|we|we're|us|our|me|my|he|she|they|them|it's|that's|will|would|should|could|can|can't|won't|is|was|are|were|been|feel|feels|think|hope|love|hate|glory)\b|\$\d/i;
export const looksLikeLeg = (t) => t.length <= 90 && !/\?/.test(t) && !CHATTER.test(t) && !/[.!]\s+[A-Z]/.test(t) && (
  /\b(ML|moneyline|anytime|any time|TD|TDs|touchdowns?|over|under|spread|ATS|covers?|to cover|to win|wins? by|win|first half|1st half|1H|2H|quarter|1Q|team total|total|alt|prop|to score|first TD|last TD|parlay|o\/u|[ou]\d+(\.\d+)?|yds|yards|rushing|receiving|passing|receptions|rec|completions|attempts|sacks?|INT|interceptions?|field goals?|FG|longest|assists?|rebounds?)\b/i.test(t)
  || /[+-]\d+(\.\d+)?\b/.test(t)          // a spread or a price: -3.5, +150
  || /\b\d+\+\s*\w/.test(t)               // 75+ yards, 5+ receptions
  || /\bby \d+/i.test(t)                   // Lions by 10
);

/*
  Turn channel messages (+ thread replies) into { team: { leg, ts } }.
  - explicit "LEG | Team | leg" lines count from anyone (on-behalf entries)
  - 🎯-prefixed posts, thread replies, and natural bet-like posts count when
    the author is a known manager (teamOfUser(userID) → team name or null)
  - latest per team wins
  messages: top-level channel messages; replies: array of thread-reply messages
*/
export const collectLegs = ({ messages, replies = [], allTeams, teamOfUser }) => {
  const legs = {};
  const consider = (team, leg, ts, msg) => {
    if (!team || !leg || leg.length < 3 || /\?$/.test(leg)) return;
    if (!legs[team] || Number(ts) > Number(legs[team].ts)) legs[team] = { leg, ts, msg };
  };
  const teamFromText = (name) => allTeams.find((t) => t.toLowerCase() === String(name).trim().toLowerCase());
  const parse = (msg, inThread) => {
    const text = msg.text || "";
    const explicit = text.match(/LEG\s*\|\s*([^|]+?)\s*\|\s*(.+)/);
    if (explicit) return consider(teamFromText(explicit[1]), cleanLeg(explicit[2]), msg.ts, msg);
    if (msg.bot_id || msg.subtype) return;
    const team = teamOfUser(msg.user);
    if (!team) return;
    const leg = cleanLeg(text);
    if (inThread || /^\s*🎯/u.test(text) || looksLikeLeg(leg)) consider(team, leg, msg.ts, msg);
  };
  for (const m of messages) parse(m, false);
  for (const m of replies) parse(m, true);
  return legs;
};

export const isOpener = (text) => /Parlay Builder is OPEN/.test(text || "");
export const isBoard = (text) => /WEEK \d+ (BOARD|SLIP)/.test(text || "");
export const isLockedBoard = (text) => /WEEK \d+ SLIP/.test(text || "");

/*
  Board text. header = { week, placerName|null, deadlineLabel, kickoffLabel }.
  locked=false → the live 📋 board; locked=true → the final 🔒 slip.
*/
export const renderBoard = ({ legs, allTeams, week, placerName, deadlineLabel, kickoffLabel, locked }) => {
  const inCount = Object.keys(legs).length;
  const missing = allTeams.filter((t) => !legs[t]);
  const line = allTeams.filter((t) => legs[t]).map((t) => legs[t].leg ?? legs[t]).join("  •  ");
  const rows = allTeams.filter((t) => legs[t]).map((t) => `• *${t}* — ${legs[t].leg ?? legs[t]}`).join("\n");
  const placerLine = placerName ? `Placer: *${placerName}*` : "Placer: TBD";
  if (locked) {
    return `🔒 *WEEK ${week} SLIP — ${inCount}/${allTeams.length} legs* · ${placerLine}\n${line || "(no legs submitted - somehow, this league found a new low)"}\n\n${rows}${missing.length ? `\n\nMissing (placer picks these): ${missing.join(", ")}` : ""}\n_Placer: copy the top line into the book and reply here with the slip screenshot before kickoff${kickoffLabel ? ` (${kickoffLabel})` : ""}._`;
  }
  return `📋 *WEEK ${week} BOARD — ${inCount}/${allTeams.length} legs* · ${placerLine} · locks *${deadlineLabel}*\n${line || "_(legs appear here as they land - just post your bet in the channel)_"}${rows ? `\n\n${rows}` : ""}${missing.length ? `\n\nStill needed: ${missing.join(", ")}` : "\n\n✅ All legs in."}`;
};

// the live board's header line carries week/placer/deadline; the events
// endpoint reuses it verbatim so it doesn't need to recompute any of that
export const parseBoardHeader = (text) => {
  const m = String(text || "").match(/WEEK (\d+) (?:BOARD|SLIP)[^\n]*?Placer: (?:\*([^*]+)\*|TBD)(?:[^\n]*?locks \*([^*]+)\*)?/);
  if (!m) return null;
  return { week: Number(m[1]), placerName: m[2] || null, deadlineLabel: m[3] || "" };
};

// ── Slack event filtering ─────────────────────────────────────────────────
// Refresh on new human posts, human edits and human deletes. NEVER on
// anything the bot itself causes: its board edits arrive as message_changed
// events, and reacting to those would re-edit the board forever.
const NOISE = new Set(["channel_join", "channel_leave", "channel_topic", "channel_purpose", "channel_name", "channel_archive", "pinned_item", "unpinned_item", "bot_add", "bot_remove"]);
const EXPLICIT_LEG = /LEG\s*\|\s*[^|]+?\s*\|\s*\S/;
export const shouldRefreshForEvent = (ev, channelID, selfUserId) => {
  if (!ev || ev.type !== "message" || ev.channel !== channelID) return false;
  const sub = ev.subtype || "";
  if (NOISE.has(sub)) return false;
  const actor = sub === "message_changed" ? ev.message : sub === "message_deleted" ? ev.previous_message : ev;
  if (!actor) return false;
  if (selfUserId && actor.user === selfUserId) return false;                 // our own posts/edits
  if (sub === "message_changed" && (ev.previous_message?.text ?? "") === (actor.text ?? "")) return false; // unfurls, not edits
  if (actor.bot_id || actor.subtype === "bot_message") return EXPLICIT_LEG.test(actor.text || "") && !/Parlay Builder is OPEN/.test(actor.text || ""); // other bots/workflows: explicit legs only
  return !!actor.user;
};

// Slack stores emoji as :shortcodes: and escapes &<> - compare boards on the
// normalized text so an unchanged board isn't re-sent
const normalizeForCompare = (s) => String(s || "")
  .replace(/:[a-z0-9_+\-]+:/gi, "")
  .replace(/\p{Extended_Pictographic}|\uFE0F/gu, "")
  .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/\s+/g, " ").trim();
export const boardUnchanged = (current, next) => normalizeForCompare(current) === normalizeForCompare(next);

// has the bot already ✅'d this message?
export const hasOurCheck = (msg, selfUserId) => (msg?.reactions || []).some((r) => r.name === "white_check_mark" && (!selfUserId || (r.users || []).includes(selfUserId)));

// which messages need a ✅ added (counted legs we haven't marked) and which
// should lose ours (a leg later replaced by a newer one from the same team) -
// so a ✅ always means "this is the leg that counts"
export const reactionPlan = ({ messages, replies = [], legs, selfUserId }) => {
  const counted = new Set(Object.values(legs).map((v) => v.ts));
  const add = Object.values(legs).filter((v) => !hasOurCheck(v.msg, selfUserId)).map((v) => v.ts);
  const remove = [...messages, ...replies].filter((m) => !counted.has(m.ts) && selfUserId && hasOurCheck(m, selfUserId)).map((m) => m.ts);
  return { add, remove };
};

// What has the bot already done this week? messages = channel history
// (newest first). The lock is detected from the lock notification or from a
// SLIP board whose LAST EDIT is at/after the deadline - the board is edited
// into the slip, so its original post time is still Tuesday. An early manual
// compile (a SLIP posted before the deadline) doesn't count as a lock.
export const weekFlags = (messages, deadlineMs) => {
  const flags = { opener: false, nag: false, slip: false, signoff: false, board: null, staleBoards: [] };
  for (const m of messages) {
    if (!m.bot_id) continue;
    const t = m.text || "";
    if (isOpener(t)) flags.opener = true;
    if (/legs in\.\*|All \d+ legs are in/.test(t)) flags.nag = true;
    if (/Week \d+ legs are locked/i.test(t)) flags.slip = true;
    const lastTouch = Number(m.edited?.ts || m.ts) * 1000;
    if (isLockedBoard(t) && lastTouch >= deadlineMs - 30 * 60e3) flags.slip = true;
    if (isBoard(t)) {
      if (!flags.board) flags.board = { ts: m.ts, text: t };          // newest wins
      else if (m.pinned_to?.length) flags.staleBoards.push(m.ts);     // older pinned boards: unpin
    }
    if (/wrap on the Parlay Builder/.test(t)) flags.signoff = true;
  }
  return flags;
};

// ── season record: did the slip hit? ──────────────────────────────────────
// Managers report the result by replying to the lock notice ("Hit!", "we
// won", "parlay busted", "miss"). Lenient on phrasing, strict on position:
// the verdict word has to lead the message (after an optional "parlay / it /
// we / that"), so "hit me up on my main line" isn't a win.
export const parlayResultFromText = (text) => {
  const t = String(text || "").replace(/^[\s🎰🎉😭👎✅❌:]+/u, "").replace(/:(?:white_check_mark|x|tada|money_with_wings|sob)+:/gi, "").trim();
  const lead = /^(?:the\s+)?(?:parlay|slip|it|we|that|ticket)?\s*/i;
  const rest = t.replace(lead, "");
  if (/^(?:hit|hits|cashed|cash(?:ed)?(?:\s+in)?|won|winner|paid(?:\s+out)?)\b(?!\s+me\b)/i.test(rest)) return "hit";
  if (/^(?:miss(?:ed)?|lost|loss|bust(?:ed)?|dead|didn'?t\s+hit|no\s+good|whiff(?:ed)?|L)\b/i.test(rest)) return "miss";
  return null;
};

// Build the season record from channel history (oldest first): every
// "Week N legs are locked" notice opens a window that closes at the next
// opener; the latest verdict from a known manager inside that window -
// a reply in the notice's thread, or a short top-level post - is the result.
// repliesFor(ts) → thread replies for that notice.
export const seasonRecord = ({ messages, teamOfUser, repliesByTs = {} }) => {
  const asc = [...messages].sort((a, b) => Number(a.ts) - Number(b.ts));
  const locks = asc.filter((m) => m.bot_id && /Week (\d+) legs are locked/i.test(m.text || "")).map((m) => ({ week: Number((m.text || "").match(/Week (\d+) legs are locked/i)[1]), ts: Number(m.ts), raw: m.ts }));
  const openerTs = asc.filter((m) => m.bot_id && isOpener(m.text)).map((m) => Number(m.ts));
  const byWeek = [];
  for (const lock of locks) {
    const end = openerTs.find((o) => o > lock.ts) ?? Infinity;
    const candidates = [
      ...(repliesByTs[lock.raw] || []),
      ...asc.filter((m) => Number(m.ts) > lock.ts && Number(m.ts) < end && !m.bot_id && String(m.text || "").length <= 40),
    ].filter((m) => teamOfUser(m.user)).sort((a, b) => Number(a.ts) - Number(b.ts));
    let result = null;
    for (const m of candidates) { const r = parlayResultFromText(m.text); if (r) result = r; }
    byWeek.push({ week: lock.week, result });
  }
  const wins = byWeek.filter((w) => w.result === "hit").length, losses = byWeek.filter((w) => w.result === "miss").length;
  return { wins, losses, byWeek };
};
