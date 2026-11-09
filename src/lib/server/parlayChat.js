/*
  Conversation for the Parlay Builder: who it's talking to, what was just
  said, and everything it knows about the week, packed into one brief for
  the AI. The rules engine (parlayCore.answerParlayQuestion) still answers
  the plain questions ("status", "who's missing") instantly; this is for
  the ones that need context - follow-ups in a thread ("what about mine?"),
  pronouns ("is that one priced?"), two questions at once, corrections
  ("that's wrong"), and anything the rules engine doesn't recognise.
*/

const etFull = (ms) => new Date(ms).toLocaleString("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).replace(":00", "") + " ET";
const fmtOdds = (o) => (o === "noline" ? "no line yet" : o == null ? "not priced" : o > 0 ? `+${o}` : `${o}`);
const clip = (s, n) => { const t = String(s || "").replace(/\s+/g, " ").trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

/*
  A reply in a thread where the bot spoke last counts as talking to the bot
  when it reads like something said to it: a question, a follow-up opener
  ("what about…", "and mine?"), or a reaction to its answer ("thanks",
  "that's wrong"). Banter between people ("I asked the bot, not you") doesn't.
   thread: the thread's messages before this one, oldest first
*/
export const isFollowUp = (text, thread, selfUserId) => {
  const t = String(text || "").trim();
  if (!t || !thread?.length) return false;
  const prev = thread[thread.length - 1];
  if (!prev || !(prev.bot_id || (selfUserId && prev.user === selfUserId))) return false;
  if (/\b(not you|wasn'?t (?:talking|asking) (?:to )?you|nobody asked)\b/i.test(t)) return false;
  return /\?\s*$/.test(t)
    || /^(what|who|whose|when|where|why|how|which|is|are|was|were|does|did|do|can|could|will|would|should|shouldn'?t|and|so|but|then|ok so|okay so|what about|how about|wait)\b/i.test(t)
    || /^(thanks|thank you|thx|ty|nice|good bot|bad bot|wrong|nope|no that'?s|that'?s (?:wrong|not right|incorrect)|you'?re (?:wrong|lying)|liar|explain)\b/i.test(t);
};

// questions the rules engine shouldn't answer alone: they lean on what was just said, or ask several things
export const needsContext = (text, { followUp = false } = {}) => {
  const t = String(text || "");
  if (followUp) return true;
  if ((t.match(/\?/g) || []).length >= 2) return true;
  return /\b((?:that|this) (?:one|leg|bet|pick|prop|game|guy|player|line)|those|these|they|them|he|she|his|her|their|the one|same one|instead|again|why|explain|compare|vs\.?|versus|should (?:i|we)|what if|is it worth|which (?:one|leg|is))\b/i.test(t.replace(/\bparlay builder\b/i, ""));
};

/*
  Everything the AI may use, as plain text. Facts only - it is told to
  answer from this and nothing else.
   ctx:     the webhook's loadWeek() context (legs, header, lockMs, locked, gameOf, teamOfUser, allTeams, rejected)
   thread:  messages in the thread before this one (oldest first)
   recent:  recent top-level channel messages (newest first)
   record:  seasonRecord() result, or null
   results: the latest "📊 Week N results" post text, or null
   names:   { slackUserId: "Team" } is enough - teamOfUser covers it
*/
export const buildBrief = ({ ctx, asker, thread = [], recent = [], record = null, results = null, nowMs = Date.now(), selfUserId = null }) => {
  const out = [];
  const who = (m) => (m.bot_id || (selfUserId && m.user === selfUserId) ? "Parlay Builder (you)" : ctx.teamOfUser?.(m.user) ? `${ctx.teamOfUser(m.user)} manager` : "a league member");
  out.push(`Now: ${etFull(nowMs)}.`);
  const h = ctx.header;
  if (!h) out.push("This week's Parlay Builder hasn't opened yet (it opens Tuesday ~10am ET with the lowest scorer named as placer).");
  else {
    const n = Object.keys(ctx.legs || {}).length;
    out.push(`Week ${h.week}. Placer (places the bet): ${h.placerName || "TBD"}. ${n}/${ctx.allTeams.length} legs in.`);
    out.push(ctx.locked ? `Legs are LOCKED${ctx.lockMs ? ` (locked ${etFull(ctx.lockMs)})` : ""}. Late legs need the placer's OK.` : ctx.lockMs ? `Legs lock ${etFull(ctx.lockMs)}${ctx.lockMs > nowMs ? ` (in ${Math.round((ctx.lockMs - nowMs) / 60e3)} min)` : ""} - 15 min before the first game that has a leg.` : `Lock: ${h.deadlineLabel || "not set"}.`);
    const rows = ctx.allTeams.filter((t) => ctx.legs[t]).map((t) => {
      const v = ctx.legs[t], g = ctx.gameOf?.(v.leg);
      return `- ${t}: "${v.leg}"${v.readAs ? ` (read as: ${v.readAs})` : ""}${g ? ` · ${g.label}, kicks off ${etFull(g.kickoffMs)}` : " · game unknown"} · odds ${fmtOdds(v.odds)}`;
    });
    out.push(rows.length ? `Legs on the board:\n${rows.join("\n")}` : "No legs yet.");
    const missing = ctx.allTeams.filter((t) => !ctx.legs[t]);
    if (missing.length) out.push(`Still missing: ${missing.join(", ")}.`);
    if (ctx.rejected?.length) out.push(`Legs that can't count: ${ctx.rejected.map((r) => `${r.team}: "${r.leg}" (${r.reason})`).join("; ")}.`);
  }
  if (record?.byWeek?.length) out.push(`Season parlay record: ${record.wins}-${record.losses}${record.pending ? ` (${record.pending} unreported)` : ""}. By week: ${record.byWeek.map((w) => `Wk ${w.week} ${w.result || "?"}`).join(", ")}.`);
  if (results) out.push(`Latest grading post:\n${clip(results, 900)}`);
  out.push(`Asker: ${asker || "a league member"}.`);
  if (thread.length) out.push(`This thread so far (oldest first):\n${thread.slice(-12).map((m) => `${who(m)}: ${clip(m.text, 300)}`).join("\n")}`);
  const chatter = recent.filter((m) => !m.bot_id).slice(0, 8).reverse();
  if (chatter.length) out.push(`Recent channel messages (oldest first):\n${chatter.map((m) => `${who(m)}: ${clip(m.text, 200)}`).join("\n")}`);
  return out.join("\n\n");
};

export const CHAT_SYSTEM = (rules) => `You are the Parlay Builder, the Slack bot that runs a 12-team fantasy football league's weekly group parlay: each team posts one leg, the week's lowest scorer places the bet.

Answer the latest message using ONLY the facts in the brief (the live board, the thread, the season) and the rules below. Read the thread: "it", "that one", "mine", "what about X" refer to what was just said. If the asker is the manager of a team, "my leg" means that team's leg.
- Be direct and useful first, dry wit second. 1-3 short sentences; a short bullet list only when listing legs or teams. Under 90 words.
- Never invent odds, results, injuries, rules, or anything not in the brief. If you don't know, say so plainly; rule disputes go to Bryan (who built you).
- If they correct you and the brief shows they're right, own it in a few words and give the right answer.
- Off-topic (trivia, life advice, weather): one deadpan quip that you only do parlays. No picks or betting advice.
- Never be cruel about a person; light ribbing about a bad leg is fine. Don't @-mention anyone. Slack mrkdwn only (*bold*, _italic_), no headers.

${rules}`;
