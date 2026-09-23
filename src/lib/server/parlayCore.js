/*
  Parlay Builder core - pure functions shared by the cron script
  (scripts/parlay-bot.mjs) and the instant Slack events endpoint
  (src/routes/api/parlay/events). No I/O in here.
*/

export const cleanLeg = (t) => String(t || "")
  .replace(/^[\s🎯🎰:\-–—]+/u, "")
  .replace(/^(?:i'?ll take|i'?ll go|i got|i'?m taking|give me|gimme|let'?s do|let'?s go|my leg is|my leg:|leg:)\s+/i, "")
  .replace(/\s+/g, " ").trim();

// a plain message from a known manager counts as a leg when it reads like a
// bet: short, no question, betting vocabulary in it
const CHATTER = /\b(you|your|you're|guys|lol|lmao|haha|thanks|thank|sorry|please|pls|send|bets|everyone|reminder|deadline|placed|submitted|bet is|slip)\b/i;
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
  const consider = (team, leg, ts) => {
    if (!team || !leg || leg.length < 3 || /\?$/.test(leg)) return;
    if (!legs[team] || Number(ts) > Number(legs[team].ts)) legs[team] = { leg, ts };
  };
  const teamFromText = (name) => allTeams.find((t) => t.toLowerCase() === String(name).trim().toLowerCase());
  const parse = (msg, inThread) => {
    const text = msg.text || "";
    const explicit = text.match(/LEG\s*\|\s*([^|]+?)\s*\|\s*(.+)/);
    if (explicit) return consider(teamFromText(explicit[1]), cleanLeg(explicit[2]), msg.ts);
    if (msg.bot_id || msg.subtype) return;
    const team = teamOfUser(msg.user);
    if (!team) return;
    if (inThread || /^\s*🎯/u.test(text) || looksLikeLeg(text)) consider(team, cleanLeg(text), msg.ts);
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
