/*
  Parlay Builder core - pure functions shared by the cron script
  (scripts/parlay-bot.mjs) and the instant Slack events endpoint
  (src/routes/api/parlay/events). No I/O in here.
*/

export const cleanLeg = (t) => String(t || "")
  .replace(/<@[A-Z0-9]+>/g, " ")
  .replace(/^\s*(?:hey|hi|hello|yo|ok|okay|alright|oi)?[,!\s]*@?\s*parlay\s*(?:builder|bot)\b[,:!\s]*/i, "") // addressed to the bot
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
const CHATTER = /\b(you|your|you're|guys|lol|lmao|haha|thanks|thank|sorry|please|pls|send|bets|everyone|reminder|deadline|placed|submitted|bet is|slip|i|i'm|im|we|we're|us|our|me|my|he|she|they|them|it's|that's|will|would|should|could|can|can't|won't|is|was|are|were|been|feel|feels|think|hope|love|hate|glory|bot|parlay|improvement|suggestion|feature|bug|according|whichever)\b|\$\d/i;
// a thread reply under the opener/board is a pick even without betting words
// ("Chiefs", "Bills -3" is caught above) - but only when it is short and plain, so a
// sentence of feedback or banter in the thread never lands on the slip
// "Will" is chatter ("will you place it") but also a first name (Will Reichard, Will Levis): before a capitalised surname it's a name
const chatty = (t) => CHATTER.test(String(t).replace(/\bWill(?= [A-Z][a-z])/g, ""));
export const isPlainPick = (t) => t.split(/\s+/).length <= 5 && t.length <= 40 && !/[?,;:!]/.test(t) && !chatty(t);
export const looksLikeLeg = (t) => t.length <= 90 && !/\?/.test(t) && !chatty(t) && !/[.!]\s+[A-Z]/.test(t) && (
  /\b(ML|moneyline|anytime|any time|TD|TDs|touchdowns?|over|under|spread|ATS|covers?|to cover|to win|wins? by|win|first half|1st half|1H|2H|quarter|1Q|team total|total|alt|prop|to score|first TD|last TD|o\/u|[ou]\d+(\.\d+)?|yds|yards|rushing|receiving|passing|receptions|rec|completions|attempts|sacks?|INT|interceptions?|field goals?|FGs?|kicking points|PATs?|extra points?|tackles?|longest|assists?|rebounds?)\b/i.test(t)
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
export const collectLegsDetailed = ({ messages, replies = [], allTeams, teamOfUser, check = null, beforeMs = null }) => {
  const legs = {}, rejected = [];
  const consider = (team, leg, ts, msg) => {
    if (!team || !leg || leg.length < 3 || /\?$/.test(leg)) return;
    if (beforeMs != null && Number(ts) * 1000 > beforeMs) return;              // posted after the lock: never on the slip
    const problem = check ? check(leg, Number(ts) * 1000) : null;               // bye week, game already closed...
    if (problem) { rejected.push({ team, leg, ts, msg, reason: problem }); return; }
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
    if (/^\s*🎯/u.test(text) || looksLikeLeg(leg) || (inThread && isPlainPick(leg))) consider(team, leg, msg.ts, msg);
  };
  for (const m of messages) parse(m, false);
  for (const m of replies) parse(m, true);
  // a rejected post only matters while it is the team's latest word: a newer valid leg supersedes it
  return { legs, rejected: rejected.filter((r) => !legs[r.team] || Number(r.ts) > Number(legs[r.team].ts)) };
};
export const collectLegs = (args) => collectLegsDetailed(args).legs;

// ── odds (American) ────────────────────────────────────────────────────────
export const americanToDecimal = (a) => (a > 0 ? 1 + a / 100 : 1 + 100 / Math.abs(a));
export const decimalToAmerican = (d) => (d >= 2 ? Math.round((d - 1) * 100) : Math.round(-100 / (d - 1)));
export const fmtAmerican = (a) => (a === "noline" ? "no line" : a == null ? "n/a" : a > 0 ? `+${a}` : `${a}`); // "noline": a prop the books have not posted yet
// combined price of every leg we could price; unpriced legs are left out, and the caller says so
export const parlayOdds = (prices) => {
  const priced = prices.filter((p) => p != null && Number.isFinite(p) && p !== 0);
  if (!priced.length) return null;
  const dec = priced.reduce((acc, p) => acc * americanToDecimal(p), 1);
  return { american: decimalToAmerican(dec), decimal: Math.round(dec * 100) / 100, priced: priced.length, total: prices.length };
};
// "(−155)" after each leg, one footer with the combined price. Only when the caller priced the legs (odds !== undefined).
const oddsTag = (v) => (v?.odds === undefined ? "" : ` (${fmtAmerican(v.odds)})`);
const readTag = (v) => (v?.readAs ? ` _→ ${v.readAs}_` : ""); // how a prop was read: "→ anytime TD · MIN"
const oddsFooter = (legs, teams) => {
  const mine = teams.filter((t) => legs[t]).map((t) => legs[t]);
  if (!mine.length || mine.every((v) => v.odds === undefined)) return "";
  const p = parlayOdds(mine.map((v) => v.odds));
  if (!p) return "\n_Odds: no prices yet for these legs._";
  return `\n_Est. parlay at DraftKings: *${fmtAmerican(p.american)}*${p.priced === p.total ? ` (all ${p.total} legs priced)` : ` (${p.priced} of ${p.total} legs priced - the rest are left out)`}._`;
};

export const isOpener = (text) => /Parlay Builder is OPEN/.test(text || "");
export const isBoard = (text) => /WEEK \d+ (BOARD|SLIP)/.test(text || "");
export const isLockedBoard = (text) => /WEEK \d+ SLIP/.test(text || "");

/*
  Board text. header = { week, placerName|null, deadlineLabel, kickoffLabel }.
  locked=false → the live 📋 board; locked=true → the final 🔒 slip.
*/
export const deadlineToken = (deadlineEpochMs, label) => deadlineEpochMs ? `<!date^${Math.floor(deadlineEpochMs / 1000)}^{date_short_pretty} at {time}|${label}>` : label;
// an unplaceable leg pins the lock to the week's first kickoff - say so, and how to fix it
const unplacedNote = (unplaced) => unplaced?.length
  ? `\n_❓ Can't tell which game ${unplaced.map((u) => `"${u.leg}" (${u.team})`).join(", ")} ${unplaced.length > 1 ? "are" : "is"} in, so the lock is held at the week's first kickoff. Name the team - e.g. "Jared Goff (DET) two passing TDs" - and it moves to that game._`
  : "";
export const renderBoard = ({ legs, allTeams, week, placerName, deadlineLabel, deadlineEpochMs = null, kickoffLabel, locked, unplaced = [] }) => {
  const inCount = Object.keys(legs).length;
  const missing = allTeams.filter((t) => !legs[t]);
  const line = allTeams.filter((t) => legs[t]).map((t) => legs[t].leg ?? legs[t]).join("  •  ");
  const rows = allTeams.filter((t) => legs[t]).map((t) => `• *${t}* — ${legs[t].leg ?? legs[t]}${oddsTag(legs[t])}${readTag(legs[t])}`).join("\n");
  const placerLine = placerName ? `Placer: *${placerName}*` : "Placer: TBD";
  if (locked) {
    return `🔒 *WEEK ${week} SLIP — ${inCount}/${allTeams.length} legs* · ${placerLine}${deadlineEpochMs ? ` · locked *${deadlineToken(deadlineEpochMs, deadlineLabel)}*` : ""}\n${line || "(no legs submitted - somehow, this league found a new low)"}\n\n${rows}${missing.length ? `\n\nMissing (placer picks these): ${missing.join(", ")}` : ""}${oddsFooter(legs, allTeams)}\n_Placer: copy the top line into the book and reply here with the slip screenshot before kickoff${kickoffLabel ? ` (${kickoffLabel})` : ""}._`;
  }
  return `📋 *WEEK ${week} BOARD — ${inCount}/${allTeams.length} legs* · ${placerLine} · locks *${deadlineToken(deadlineEpochMs, deadlineLabel)}*\n${line || "_(legs appear here as they land - just post your bet in the channel)_"}${rows ? `\n\n${rows}` : ""}${missing.length ? `\n\nStill needed: ${missing.join(", ")}` : "\n\n✅ All legs in."}${oddsFooter(legs, allTeams)}${unplacedNote(unplaced)}`;
};

// the live board's header line carries week/placer/deadline; the events
// endpoint reuses it verbatim so it doesn't need to recompute any of that
export const parseBoardHeader = (text) => {
  const m = String(text || "").match(/WEEK (\d+) (?:BOARD|SLIP)[^\n]*?Placer: (?:\*([^*]+)\*|TBD)(?:[^\n]*?lock(?:s|ed) \*([^*\n]+)\*)?/);
  if (!m) return null;
  const raw = m[3] || "";
  const tok = raw.match(/^<!date\^(\d+)\^[^|]*\|([^>]+)>$/); // Slack date token → epoch + fallback label
  return { week: Number(m[1]), placerName: m[2] || null, deadlineLabel: tok ? tok[2] : raw, deadlineEpochMs: tok ? Number(tok[1]) * 1000 : null };
};

// the lock notice IS the slip: the placer shouldn't have to find the pin
export const renderLockNotice = ({ legs, allTeams, week, placerName, placerMentions = [], kickoffLabel }) => {
  const inCount = Object.keys(legs).length;
  const missing = allTeams.filter((t) => !legs[t]);
  const rows = allTeams.filter((t) => legs[t]).map((t) => `• *${t}* — ${legs[t].leg ?? legs[t]}${oddsTag(legs[t])}${readTag(legs[t])}`).join("\n");
  const who = placerMentions.length ? `${placerMentions.map((u) => `<@${u}>`).join(" ")} (*${placerName}*)` : placerName ? `*${placerName}*` : "placer TBD";
  return `🔒 *Week ${week} legs are locked* — ${inCount}/${allTeams.length} in. ${who}, you're up${kickoffLabel ? ` - kickoff ${kickoffLabel}` : ""}.\n${rows || "_(no legs)_"}${missing.length ? `\n_Placer picks for: ${missing.join(", ")}._` : ""}${oddsFooter(legs, allTeams)}\n_Reply here with *hit* or *miss* once it settles - the bot keeps the season record. The pinned board and the 🔒 bookmark up top have this too._`;
};

// ── a lock that fired too early ───────────────────────────────────────────
// Before the 15-minute rule shipped the bot locked at a fixed 6 PM. A week
// locked that way is reopened once the legs say the real cutoff is later.
// Only LEGACY slips qualify (their header carries no lock time); a slip the
// current code locked always records the time it locked at, so a deleted
// post can never reopen a week that was locked properly.
export const lockNoticeOf = (messages) => (messages || []).find((m) => m.bot_id && /Week \d+ legs are locked/i.test(m.text || "")) || null; // newest first
export const isStaleLock = ({ notice, header, lockMs, nowMs }) =>
  !!notice && lockMs != null && header?.deadlineEpochMs == null && nowMs < lockMs && Number(notice.ts) * 1000 < lockMs - 60e3;
export const renderReopened = ({ week, lockLabel, rescued = [] }) => {
  const rows = rescued.map((r) => `• ${r.mention ? `${r.mention} ` : ""}*${r.team}* — ${r.leg}`).join("\n");
  return `🔓 *Week ${week} is open again.* The lock fired early (the old fixed 6 PM rule); legs now lock *${lockLabel}* - 15 minutes before the first game that has a leg.${rows ? `\nThese posts count after all:\n${rows}` : ""}\nStill need to change or add one? Just post it before then.`;
};
// what the old lock notice becomes (must NOT contain the words that mark a real lock notice)
export const renderRetractedNotice = ({ week, lockLabel }) => `🔓 _Week ${week} lock notice withdrawn - it went out early. Legs now lock ${lockLabel}._`;

// ── a leg that arrives after the lock ─────────────────────────────────────
// Silence reads as "logged". A top-level bet-shaped post from a known manager
// after the week is locked gets a 🔒 and a thread reply that asks the PLACER
// whether the parlay is already set (it may not be, and then it's their call).
// Thread replies are left alone (that's where hit/miss reports live), and so
// is anything that reads like a result ("Josh Allen TD hit").
const RESULT_WORDS = /\b(hit|hits|cashed|cash|miss|missed|busted|bust|won|lost|loss|whiff(?:ed)?)\b/i;
export const isLateLeg = (ev, { locked, teamOfUser }) => {
  if (!locked || !ev || ev.subtype || ev.thread_ts || !ev.user || !teamOfUser?.(ev.user)) return false;
  const text = ev.text || "";
  if (RESULT_WORDS.test(text)) return false;
  return /^\s*🎯/u.test(text) || looksLikeLeg(cleanLeg(text));
};
// beforeKickoff: the placer can still act -> @ them and ask. After kickoff: just say it's too late.
export const renderLateLeg = ({ week, team, placerName, placerMentions = [], poster = null, leg, beforeKickoff = true }) => {
  const wk = week != null ? `Week ${week} is` : "This week is";
  const who = placerMentions.length ? `${placerMentions.map((u) => `<@${u}>`).join(" ")} (*${placerName}*)` : `*${placerName || "The placer"}*`;
  const from = `${poster ? `<@${poster}> ` : ""}*${team || "A team"}*`;
  return beforeKickoff
    ? `🔒 ${wk} locked, but ${from} just posted "${leg}". ${who}: have you already set the parlay? If not, it's your call whether to add it - it's *not* on the slip.`
    : `🔒 ${wk} locked and the games are underway - "${leg}" can't make the slip. *${placerName || "The placer"}* picks for *${team || "your team"}*.`;
};
// a leg that can't be played (bye week, game already closed)
export const renderInvalidLeg = ({ user, leg, reason }) =>
  `⚠️ ${user ? `<@${user}> ` : ""}"${leg}" can't be played: ${reason}. It's not on the board - post another (or edit that message) before the lock and I'll swap it in.`;

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
export const hasOur = (msg, name, selfUserId) => (msg?.reactions || []).some((r) => r.name === name && (!selfUserId || (r.users || []).includes(selfUserId)));
export const reactionPlan = ({ messages, replies = [], legs, selfUserId, rejected = [] }) => {
  const counted = new Set(Object.values(legs).map((v) => v.ts));
  const bad = new Set(rejected.map((r) => r.ts));
  const add = Object.values(legs).filter((v) => !hasOurCheck(v.msg, selfUserId)).map((v) => v.ts);
  const remove = [...messages, ...replies].filter((m) => !counted.has(m.ts) && selfUserId && hasOurCheck(m, selfUserId)).map((m) => m.ts);
  // ⚠️ marks a leg that can't be played (bye week, game closed) - once per message, cleared when it's edited into something valid
  const warn = rejected.filter((r) => !hasOur(r.msg, "warning", selfUserId));
  const unwarn = [...messages, ...replies].filter((m) => !bad.has(m.ts) && selfUserId && hasOur(m, "warning", selfUserId)).map((m) => m.ts);
  return { add, remove, warn, unwarn };
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
    // the nag, in any wording it has had (Slack stores ⏰ as :alarm_clock:)
    if (/(?:⏰|:alarm_clock:)[^\n]*legs in\b|Still missing:|All \d+ legs are in/.test(t)) flags.nag = true;
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
  const lead = /^(?:the\s+|our\s+|my\s+)?(?:parlay|slip|it|we|that|ticket|bet|this one|that one)?\s*/i;
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
const BOT_VERDICT = /(?:🏁|:checkered_flag:) \*Week \d+ parlay: (HIT|MISS)\*/; // the bot's own call (parlayGrade.renderVerdict)
export const seasonRecord = ({ messages, teamOfUser, repliesByTs = {}, seed = {} }) => {
  const asc = [...messages].sort((a, b) => Number(a.ts) - Number(b.ts));
  const locks = asc.filter((m) => m.bot_id && /Week (\d+) legs are locked/i.test(m.text || "")).map((m) => ({ week: Number((m.text || "").match(/Week (\d+) legs are locked/i)[1]), ts: Number(m.ts), raw: m.ts }));
  const openerTs = asc.filter((m) => m.bot_id && isOpener(m.text)).map((m) => Number(m.ts));
  const byWeek = [];
  for (const lock of locks) {
    const end = openerTs.find((o) => o > lock.ts) ?? Infinity;
    const candidates = [
      ...(repliesByTs[lock.raw] || []),
      ...asc.filter((m) => Number(m.ts) > lock.ts && Number(m.ts) < end && !m.bot_id && String(m.text || "").length <= 40),
    ].filter((m) => teamOfUser(m.user) || (m.bot_id && BOT_VERDICT.test(m.text || ""))).sort((a, b) => Number(a.ts) - Number(b.ts));
    let result = null; // latest wins: a manager's reply after the bot's call overrides it
    for (const m of candidates) { const b = (m.text || "").match(BOT_VERDICT); const r = b ? b[1].toLowerCase() : parlayResultFromText(m.text); if (r) result = r; }
    byWeek.push({ week: lock.week, result });
  }
  // weeks the bot didn't witness (before it existed) come from the curated seed
  for (const [wk, result] of Object.entries(seed || {})) {
    if (!byWeek.some((w) => w.week === Number(wk)) && ["hit", "miss"].includes(result)) byWeek.push({ week: Number(wk), result, seeded: true });
  }
  byWeek.sort((a, b) => a.week - b.week);
  const wins = byWeek.filter((w) => w.result === "hit").length, losses = byWeek.filter((w) => w.result === "miss").length;
  return { wins, losses, byWeek };
};

// ── talking to the bot ────────────────────────────────────────────────────
// Two ways to address it: an @mention, or natural phrasing like
// "hey parlay builder, who's missing?". Plain gripes ("parlay builder is
// annoying") don't count - a leading address only counts when there's a
// question mark, a known question, or a leg attached.
export const PARLAY_RULES = `How the Parlay Builder works:
- One leg per team per week. Just post the bet in the channel ("Vikings ML", "Bijan anytime TD", "Bills -3.5"); the bot knows whose team you are. Thread replies under the opener or the pinned board count too. Entering for someone else: "🎯 LEG | Their Team | the leg".
- Changing your mind: post the new bet - your team's LATEST post is the one that counts, and the ✅ moves to it. Editing your original message works too. Any number of changes until the lock.
- The ✅ on a message means "this is the leg that counts". No ✅ = not registered (wrong wording, unknown account, or it read like chat).
- Deadline: 15 minutes before the kickoff of the earliest game that has a leg in it (Thursday night's game if anyone has it; otherwise the next game up). Legs lock then; the pinned board becomes the final slip.
- Legs must be playable: a team on a bye, or a game that's about to start, gets a ⚠️ instead of a ✅ and doesn't count.
- Odds: each leg on the board shows its DraftKings price - game lines (spread / total / moneyline) and player props (anytime TD, 2+ TDs, passing TDs, yards, catches) - with an estimated combined parlay price. A prop the books haven't posted yet shows "no line" and is re-checked at the lock.
- Results: after the lock the bot grades each leg as its game finishes (in the lock notice's thread) and calls the parlay HIT or MISS itself. The placer's picks for missing teams still need a hit/miss reply.
- Missed the deadline: the placer picks your leg for you, no appeals. A bet posted after the lock gets a 🔒 instead of a ✅ and doesn't count; the bot asks the placer whether the parlay is already set.
- Placer: the team with the lowest score the previous week places the bet and posts the slip screenshot.
- Results: after it settles, reply "hit" or "miss" under the lock notice; the bot keeps the season record and shows it in each opener.
- Cadence: opener Tuesday 10am ET, reminder 24h before the deadline (tagging whoever's missing), lock at the deadline (it moves earlier if a leg is added for an earlier game). Runs regular season only.`;

const ADDRESS = /^\s*(?:hey|hi|hello|yo|ok|okay|alright|oi)?[,!\s]*@?\s*parlay\s*(?:builder|bot)\b[,:!\s]*/i;
const MENTIONED_ANYWHERE = /\b(?:parlay\s*(?:builder|bot)|the bot|slack bot)\b/i;
const INTENT = {
  missing: /\b(who(?:'s| is| has| hasn'?t)|missing|still need|left|outstanding|hasn'?t (?:added|posted|submitted))\b/i,
  status: /\b(status|where (?:are|r) we|how many|count|update|progress|board|slip|legs?\b(?! (?:lock|due)))\b/i,
  deadline: /\b(deadline|locks?|locked|due|cutoff|cut-off)\b|\bwhen\b.*\b(?:lock|due|deadline|cutoff|close)/i,
  placer: /\b(plac(?:er|ing|es)|on the hook|who(?:'s| is) (?:betting|placing|up)|who bets|who has to)\b/i,
  record: /\b(record|season|tally|hit rate|how (?:have|are) we (?:done|doing)|standings)\b/i,
  mine: /\b(my (?:leg|bet|pick)|what do you have for me|did (?:you|it) (?:get|log|count) (?:mine|my))\b/i,
  help: /\b(help|commands|what can you do|instructions)\b/i,
  // rule questions - checked before the data questions so "change my pick"
  // isn't answered as "here's your pick"
  change: /\b(chang(?:e|ed|ing)|edit|update|replace|swap|switch|redo|resubmit|new (?:pick|leg|bet)|different (?:pick|leg|bet)|take (?:it )?back|undo)\b/i,
  late: /\b(what if i (?:miss|forget|don'?t)|miss(?:ed)? the deadline|don'?t (?:post|submit|add)|forget|too late|late)\b/i,
  how: /\b(how (?:do|does|did|would|should|can) (?:this|it|i|you|we|that|the bot)|rules?|parameters|what counts|format|how to (?:enter|add|submit|post)|account(?:ed)? for|explain)\b/i,
  report: /\b(report|how (?:do|are) (?:results|hits?|wins)|who (?:reports|marks|tracks)|track(?:ed|ing)?|mark (?:it )?(?:hit|miss))\b/i,
};
export const stripAddress = (text) => String(text || "").replace(/<@[A-Z0-9]+>/g, " ").replace(ADDRESS, "").trim();
export const addressedToBot = (text, selfUserId) => {
  const t = String(text || "");
  if (selfUserId && t.includes(`<@${selfUserId}>`)) return true;
  if (MENTIONED_ANYWHERE.test(t) && /\?/.test(t) && !ADDRESS.test(t)) return true; // "does the bot count edits?"
  if (!ADDRESS.test(t)) return false;
  const rest = stripAddress(t);
  return /\?/.test(rest) || Object.values(INTENT).some((rx) => rx.test(rest)) || looksLikeLeg(cleanLeg(rest));
};

// One reply, from what the bot already knows about the week. ctx: { legs,
// allTeams, week, placerName, deadlineLabel, record, usersByTeam,
// askerTeam }. Returns { text, leg } - leg is set when the message was a leg
// submission addressed to the bot ("hey parlay builder, Vikings ML").
export const answerParlayQuestion = (rawText, ctx) => {
  const q = stripAddress(rawText);
  const legs = ctx.legs || {}, teams = ctx.allTeams || [];
  const inCount = Object.keys(legs).length, missing = teams.filter((t) => !legs[t]);
  const legOf = (t) => legs[t]?.leg ?? legs[t];
  const mention = (t) => (ctx.usersByTeam?.[t] || []).map((u) => `<@${u}>`).join(" ");
  const open = ctx.week != null, locked = open && !!ctx.locked; // locked: the week's slip is final
  const notOpen = "This week's parlay hasn't opened yet - the opener posts Tuesday at 10am ET (Wednesday on kickoff week).";
  const lockedLine = `Week ${ctx.week} is locked - the final slip is pinned up top (🔒 bookmark too).`;
  const legText = cleanLeg(q);
  if (!INTENT.help.test(q) && looksLikeLeg(legText) && !/\?/.test(q)) {
    if (locked) return { text: renderLateLeg({ week: ctx.week, team: ctx.askerTeam, placerName: ctx.placerName, leg: legText }), leg: null };
    const bad = ctx.checkLeg?.(legText);            // bye week / game closed
    if (bad) return { text: renderInvalidLeg({ leg: legText, reason: bad }), leg: null };
    if (!ctx.askerTeam) return { text: "I don't know which team you are - ask Bryan to add you to the manager map, or post it as `🎯 LEG | Your Team | the leg`.", leg: null };
    return { text: `Got it - *${ctx.askerTeam}*: ${legText} ✅`, leg: legText };
  }
  if (INTENT.change.test(q)) return { text: locked ? `Not this week - ${lockedLine} Until the lock you can change it as often as you like; after it, the slip is what it is.` : `${/creator|god|maker|bryan/i.test(q) ? "He thought of that. " : ""}Yes - just post the new bet. Your team's *latest* post is the one that counts and the ✅ moves to it; editing the original works too. Change it as often as you like until legs lock${open ? ` *${ctx.deadlineLabel}*` : ""}.`, leg: null };
  if (INTENT.late.test(q)) return { text: locked ? `${lockedLine} *${ctx.placerName || "The placer"}* picks for anyone who missed it - no appeals.` : `If your leg isn't in by the lock${open ? ` (*${ctx.deadlineLabel}*)` : ""}, the placer picks it for you - no appeals. Post it now and you can still change it later.`, leg: null };
  if (INTENT.report.test(q)) return { text: `After the parlay settles, reply *hit* or *miss* under the lock notice. I keep the season record and show it in every Tuesday opener.`, leg: null };
  if (INTENT.how.test(q) && !INTENT.mine.test(q)) return { text: PARLAY_RULES, leg: null };
  if (INTENT.help.test(q)) return { text: `Post your bet in the channel and I log it (e.g. "Vikings ML"). Ask me things like *who's missing?*, *status*, *deadline?*, *who's placing?*, *record?*, *my leg?*. Entering for someone else: \`🎯 LEG | Their Team | the leg\`.`, leg: null };
  if (INTENT.mine.test(q)) {
    if (!ctx.askerTeam) return { text: "I don't have you mapped to a team - ask Bryan to add you.", leg: null };
    const l = legOf(ctx.askerTeam);
    return { text: l ? `*${ctx.askerTeam}* is in with: ${l}` : `Nothing logged for *${ctx.askerTeam}* yet - just post the bet here.`, leg: null };
  }
  if (INTENT.record.test(q)) {
    const r = ctx.record;
    if (!r || !r.byWeek?.length) return { text: "No results on the books yet - after each lock, reply *hit* or *miss* under the lock notice and I'll keep score.", leg: null };
    const weeks = r.byWeek.map((w) => `Wk ${w.week}: ${w.result === "hit" ? "HIT 🎉" : w.result === "miss" ? "miss" : "not reported"}`).join(" · ");
    return { text: `Season parlay record *${r.wins}-${r.losses}* (${weeks}).`, leg: null };
  }
  if (INTENT.placer.test(q)) return { text: open ? (ctx.placerName ? `*${ctx.placerName}* is placing the Week ${ctx.week} bet - last week's lowest score.` : `Placer isn't set for Week ${ctx.week} yet.`) : notOpen, leg: null };
  if (INTENT.deadline.test(q) && !INTENT.missing.test(q)) return { text: open ? (locked ? lockedLine : `Week ${ctx.week} legs lock *${ctx.deadlineLabel}*.`) : notOpen, leg: null };
  if (INTENT.missing.test(q)) {
    if (!open) return { text: notOpen, leg: null };
    if (!missing.length) return { text: `All ${teams.length} legs are in for Week ${ctx.week}. ✅`, leg: null };
    if (locked) return { text: `Locked at ${inCount}/${teams.length}. *${ctx.placerName || "The placer"}* picks for: ${missing.map((t) => `*${t}*`).join(", ")}.`, leg: null };
    return { text: `Still missing (${missing.length}): ${missing.map((t) => `*${t}* ${mention(t)}`.trim()).join(", ")}. Locks *${ctx.deadlineLabel}*.`, leg: null };
  }
  if (INTENT.status.test(q)) {
    if (!open) return { text: notOpen, leg: null };
    const list = teams.filter((t) => legs[t]).map((t) => `• *${t}* — ${legOf(t)}`).join("\n");
    return { text: `Week ${ctx.week}: *${inCount}/${teams.length} legs in* · placer *${ctx.placerName || "TBD"}* · ${locked ? "🔒 locked" : `locks *${ctx.deadlineLabel}*`}${ctx.record?.byWeek?.length ? ` · season ${ctx.record.wins}-${ctx.record.losses}` : ""}\n${list || "_(no legs yet)_"}${missing.length ? `\n${locked ? "Placer picks for" : "Still needed"}: ${missing.join(", ")}` : ""}`, leg: null };
  }
  return { text: `Not sure what you're after. Try *who's missing?*, *status*, *deadline?*, *who's placing?*, *record?* or *my leg?* - or just post your bet.`, leg: null };
};

// questions about the league itself (history, bylaws, trades, drafts…) go
// to The Oracle on the site; the bot only knows parlays
export const isLeagueQuestion = (text) => {
  const q = stripAddress(text);
  return /\b(bylaws?|constitution|champion(?:ship)?s?|title|toilet bowl|draft(?:ed|s)?|rookie|pick (?:\d\.\d+|protection|swap)|trade[sd]?|traded|roster|standings|all[- ]time|history|rivalry|rival|head[- ]to[- ]head|h2h|who won|who has|owns?|dues|payout|prize|buy[- ]in|waiver|taxi|dynasty|league record|most points|luck|playoff odds|power rank)\b/i.test(q)
    && !/\b(parlay|leg|slip|bet)\b/i.test(q);
};

// Oracle answers arrive as Markdown; Slack wants mrkdwn, and a thread reply
// should stay short
export const oracleForSlack = (answer, max = 700) => {
  let t = String(answer || "").replace(/^#{1,6}\s*/gm, "").replace(/\*\*(.+?)\*\*/g, "*$1*").replace(/^\s*[-*]\s+/gm, "• ").trim();
  if (t.length > max) t = t.slice(0, max).replace(/\s+\S*$/, "") + " …";
  return `🔮 *The Oracle:* ${t}`;
};

// ── the NFL week's channel window ────────────────────────────────────────
// Midnight ET on the Monday that starts an NFL week's betting window, as epoch
// ms. A calendar week is wrong here: Monday still belongs to the previous NFL
// week (Monday Night Football), so a Monday-midnight window made the bot lose
// sight of the week's opener/lock and open the same week again (Week 7, Oct 26).
// Anchors on the week's first kickoff when the slate is known (exact, even
// before Sleeper flips its week); otherwise on now. Either way it's the Monday
// on or before the anchor minus one day, so a Monday maps to the week before.
export const nflWeekStartMs = (nowMs, firstKickoffMs = null) => {
  const ref = (firstKickoffMs && Math.abs(firstKickoffMs - nowMs) < 14 * 864e5 ? firstKickoffMs : nowMs) - 864e5;
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "numeric", day: "numeric", weekday: "short" }).formatToParts(new Date(ref)).map((x) => [x.type, x.value]));
  const back = (["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(p.weekday) + 7) % 7;
  const utcMidnight = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day) - back);
  const etHourAt4z = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", hourCycle: "h23" }).format(new Date(utcMidnight + 4 * 3600e3)));
  return utcMidnight + (etHourAt4z === 0 ? 4 : 5) * 3600e3; // EDT midnight = 04:00Z, EST = 05:00Z
};

// Bot posts that can't be right: an opener, a live (unlocked) board or a nag
// for a week that is already locked, posted after its lock notice. That's what
// the Monday-midnight window bug left behind (a second Week 7 opener + empty
// board + nag on Oct 26). Returns their ts so the bot can delete them. A
// legitimately reopened week has its notice edited to "withdrawn", so it never
// matches here.
export const straysAfterLock = (messages, week) => {
  const notice = lockNoticeOf(messages);
  if (!notice || !new RegExp(`Week ${week} legs are locked`, "i").test(notice.text || "")) return [];
  const after = Number(notice.ts);
  return (messages || []).filter((m) => m.bot_id && Number(m.ts) > after && (
    new RegExp(`Week ${week} Parlay Builder is OPEN`).test(m.text || "") ||
    new RegExp(`WEEK ${week} BOARD`).test(m.text || "") ||
    /(?:⏰|:alarm_clock:)[^\n]*legs in\b/.test(m.text || "")
  )).map((m) => m.ts);
};
