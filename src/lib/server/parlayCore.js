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
export const deadlineToken = (deadlineEpochMs, label) => deadlineEpochMs ? `<!date^${Math.floor(deadlineEpochMs / 1000)}^{date_short_pretty} at {time}|${label}>` : label;
export const renderBoard = ({ legs, allTeams, week, placerName, deadlineLabel, deadlineEpochMs = null, kickoffLabel, locked }) => {
  const inCount = Object.keys(legs).length;
  const missing = allTeams.filter((t) => !legs[t]);
  const line = allTeams.filter((t) => legs[t]).map((t) => legs[t].leg ?? legs[t]).join("  •  ");
  const rows = allTeams.filter((t) => legs[t]).map((t) => `• *${t}* — ${legs[t].leg ?? legs[t]}`).join("\n");
  const placerLine = placerName ? `Placer: *${placerName}*` : "Placer: TBD";
  if (locked) {
    return `🔒 *WEEK ${week} SLIP — ${inCount}/${allTeams.length} legs* · ${placerLine}\n${line || "(no legs submitted - somehow, this league found a new low)"}\n\n${rows}${missing.length ? `\n\nMissing (placer picks these): ${missing.join(", ")}` : ""}\n_Placer: copy the top line into the book and reply here with the slip screenshot before kickoff${kickoffLabel ? ` (${kickoffLabel})` : ""}._`;
  }
  return `📋 *WEEK ${week} BOARD — ${inCount}/${allTeams.length} legs* · ${placerLine} · locks *${deadlineToken(deadlineEpochMs, deadlineLabel)}*\n${line || "_(legs appear here as they land - just post your bet in the channel)_"}${rows ? `\n\n${rows}` : ""}${missing.length ? `\n\nStill needed: ${missing.join(", ")}` : "\n\n✅ All legs in."}`;
};

// the live board's header line carries week/placer/deadline; the events
// endpoint reuses it verbatim so it doesn't need to recompute any of that
export const parseBoardHeader = (text) => {
  const m = String(text || "").match(/WEEK (\d+) (?:BOARD|SLIP)[^\n]*?Placer: (?:\*([^*]+)\*|TBD)(?:[^\n]*?locks \*([^*\n]+)\*)?/);
  if (!m) return null;
  const raw = m[3] || "";
  const tok = raw.match(/^<!date\^(\d+)\^[^|]*\|([^>]+)>$/); // Slack date token → epoch + fallback label
  return { week: Number(m[1]), placerName: m[2] || null, deadlineLabel: tok ? tok[2] : raw, deadlineEpochMs: tok ? Number(tok[1]) * 1000 : null };
};

// the lock notice IS the slip: the placer shouldn't have to find the pin
export const renderLockNotice = ({ legs, allTeams, week, placerName, placerMentions = [], kickoffLabel }) => {
  const inCount = Object.keys(legs).length;
  const missing = allTeams.filter((t) => !legs[t]);
  const rows = allTeams.filter((t) => legs[t]).map((t) => `• *${t}* — ${legs[t].leg ?? legs[t]}`).join("\n");
  const who = placerMentions.length ? `${placerMentions.map((u) => `<@${u}>`).join(" ")} (*${placerName}*)` : placerName ? `*${placerName}*` : "placer TBD";
  return `🔒 *Week ${week} legs are locked* — ${inCount}/${allTeams.length} in. ${who}, you're up${kickoffLabel ? ` - kickoff ${kickoffLabel}` : ""}.\n${rows || "_(no legs)_"}${missing.length ? `\n_Placer picks for: ${missing.join(", ")}._` : ""}\n_Reply here with *hit* or *miss* once it settles - the bot keeps the season record. The pinned board and the 🔒 bookmark up top have this too._`;
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

// ── talking to the bot ────────────────────────────────────────────────────
// Two ways to address it: an @mention, or natural phrasing like
// "hey parlay builder, who's missing?". Plain gripes ("parlay builder is
// annoying") don't count - a leading address only counts when there's a
// question mark, a known question, or a leg attached.
export const PARLAY_RULES = `How the Parlay Builder works:
- One leg per team per week. Just post the bet in the channel ("Vikings ML", "Bijan anytime TD", "Bills -3.5"); the bot knows whose team you are. Thread replies under the opener or the pinned board count too. Entering for someone else: "🎯 LEG | Their Team | the leg".
- Changing your mind: post the new bet - your team's LATEST post is the one that counts, and the ✅ moves to it. Editing your original message works too. Any number of changes until the lock.
- The ✅ on a message means "this is the leg that counts". No ✅ = not registered (wrong wording, unknown account, or it read like chat).
- Deadline: 2 hours before the week's first kickoff, never later than Thursday 6pm ET (Thanksgiving week is earlier). Legs lock then; the pinned board becomes the final slip.
- Missed the deadline: the placer picks your leg for you, no appeals.
- Placer: the team with the lowest score the previous week places the bet and posts the slip screenshot.
- Results: after it settles, reply "hit" or "miss" under the lock notice; the bot keeps the season record and shows it in each opener.
- Cadence: opener Tuesday 10am ET, reminder 24h before the deadline (tagging whoever's missing), lock at the deadline. Runs regular season only.`;

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
  const open = ctx.week != null;
  const notOpen = "This week's parlay hasn't opened yet - the opener posts Tuesday at 10am ET (Wednesday on kickoff week).";
  const legText = cleanLeg(q);
  if (!INTENT.help.test(q) && looksLikeLeg(legText) && !/\?/.test(q)) {
    if (!ctx.askerTeam) return { text: "I don't know which team you are - ask Bryan to add you to the manager map, or post it as `🎯 LEG | Your Team | the leg`.", leg: null };
    return { text: `Got it - *${ctx.askerTeam}*: ${legText} ✅`, leg: legText };
  }
  if (INTENT.change.test(q)) return { text: `${/creator|god|maker|bryan/i.test(q) ? "He thought of that. " : ""}Yes - just post the new bet. Your team's *latest* post is the one that counts and the ✅ moves to it; editing the original works too. Change it as often as you like until legs lock${open ? ` *${ctx.deadlineLabel}*` : ""}.`, leg: null };
  if (INTENT.late.test(q)) return { text: `If your leg isn't in by the lock${open ? ` (*${ctx.deadlineLabel}*)` : ""}, the placer picks it for you - no appeals. Post it now and you can still change it later.`, leg: null };
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
  if (INTENT.deadline.test(q) && !INTENT.missing.test(q)) return { text: open ? `Week ${ctx.week} legs lock *${ctx.deadlineLabel}*.` : notOpen, leg: null };
  if (INTENT.missing.test(q)) {
    if (!open) return { text: notOpen, leg: null };
    if (!missing.length) return { text: `All ${teams.length} legs are in for Week ${ctx.week}. ✅`, leg: null };
    return { text: `Still missing (${missing.length}): ${missing.map((t) => `*${t}* ${mention(t)}`.trim()).join(", ")}. Locks *${ctx.deadlineLabel}*.`, leg: null };
  }
  if (INTENT.status.test(q)) {
    if (!open) return { text: notOpen, leg: null };
    const list = teams.filter((t) => legs[t]).map((t) => `• *${t}* — ${legOf(t)}`).join("\n");
    return { text: `Week ${ctx.week}: *${inCount}/${teams.length} legs in* · placer *${ctx.placerName || "TBD"}* · locks *${ctx.deadlineLabel}*${ctx.record?.byWeek?.length ? ` · season ${ctx.record.wins}-${ctx.record.losses}` : ""}\n${list || "_(no legs yet)_"}${missing.length ? `\nStill needed: ${missing.join(", ")}` : ""}`, leg: null };
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
