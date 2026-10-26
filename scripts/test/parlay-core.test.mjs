// Unit tests for src/lib/server/parlayCore.js - the parser shared by the cron
// bot and the Slack events webhook. Run: node scripts/test/parlay-core.test.mjs
import * as core from "../../src/lib/server/parlayCore.js";

let pass = 0, fail = 0;
const t = (name, fn) => { try { if (fn()) pass++; else { fail++; console.log(`  FAIL ${name}`); } } catch (e) { fail++; console.log(`  FAIL ${name} → ${e.message}`); } };
const CH = "C09EEV8M32S", SELF = "U0C3B7QEC9M";

// ── cleanLeg: wrappers, signatures, lead-ins ──
t("strips 'Sent using' signature (inline)", () => core.cleanLeg("Davante Adams anytime TD *Sent using* Claude") === "Davante Adams anytime TD");
t("strips 'Sent using' signature (newline)", () => core.cleanLeg("Davante Adams anytime TD\n*Sent using* Claude") === "Davante Adams anytime TD");
t("strips lead-ins", () => core.cleanLeg("I'll take Davante Adams anytime TD") === "Davante Adams anytime TD");
t("strips 🎯 prefix", () => core.cleanLeg("🎯 Vikings ML") === "Vikings ML");
t("display: wrappers cleaned", () => core.cleanLeg("Put me down for Kelce anytime TD") === "Kelce anytime TD" && core.cleanLeg("Bills ML for me") === "Bills ML");

// ── looksLikeLeg: real legs and real chatter from the league's channel ──
const LEGS = ["I want Bills ML", "Bills ML for me", "Chase over 80 yards this week", "Take the over in BUF/LAC", "Put me down for Kelce anytime TD", "Ravens ML please", "Going with Lions -3", "Bijan to score a TD", "Chiefs win", "Buffalo to cover against the Chargers", "Vikings ML", "Derrick Henry anytime td", "Garrett Wilson Anytime TD - free money", "Bills -3.5", "Jets +150", "Chase 75+ yards", "Lions by 10", "Puka under 60.5 receiving"];
const CHAT = ["Alright send over your bets. Looks like it me again.", "Bryan I don't even have time to do my real work lol, you're good", "Bet is submitted. $5 to win $629", "Only the browns can fail you by busting open the parlay by winning", "I will never let Tim execute me", "Finally we're not betting to win $70", "That Fannin TD will lead us to glory", "Should I force group text instead?", "this parlay is cooked", "Recommended improvement to the bot, current odds according to whichever book on the parlay"];
for (const l of LEGS) t(`leg: ${l}`, () => core.looksLikeLeg(core.cleanLeg(l)));
for (const c of CHAT) t(`chatter: ${c.slice(0, 40)}`, () => !core.looksLikeLeg(core.cleanLeg(c)));

// ── collectLegs ──
const allTeams = ["Immigrants", "The Maniacs", "The 5th Rounders", "Risky Business", "Title Chase"];
const map = { UTB8NMCLQ: "Immigrants", US0P6RDSR: "The Maniacs", US7R5B3C3: "The 5th Rounders" };
const teamOfUser = (u) => map[u] || null;
const messages = [
  { ts: "300", user: "US0P6RDSR", text: "Buffalo to cover against the Chargers" },
  { ts: "250", user: "US7R5B3C3", text: "Derrick Henry anytime td" },
  { ts: "200", user: "UTB8NMCLQ", text: ":dart: LEG | Risky Business | Vikings ML\n*Sent using* Claude" },
  { ts: "190", user: SELF, bot_id: "B1", text: ":slot_machine: *Week 3 Parlay Builder is OPEN* ... `🎯 LEG | Their Team | the leg`" },
  { ts: "180", user: "UNKNOWN", text: "Vikings ML" },
  { ts: "170", user: "US0P6RDSR", text: "Bryan I don't even have time to do my real work lol, you're good" },
  { ts: "150", user: "US0P6RDSR", text: "Bills -3.5" },
];
const legs = core.collectLegs({ messages, replies: [{ ts: "260", user: "UTB8NMCLQ", text: "Davante Adams anytime TD" }], allTeams, teamOfUser });
t("collect: 4 teams", () => Object.keys(legs).length === 4);
t("collect: latest wins (Maniacs → Buffalo)", () => legs["The Maniacs"].leg === "Buffalo to cover against the Chargers");
t("collect: explicit on-behalf entry, signature stripped", () => legs["Risky Business"].leg === "Vikings ML");
t("collect: thread reply counts", () => legs["Immigrants"].leg === "Davante Adams anytime TD");
t("collect: opener template never a leg", () => !legs["Their Team"]);
t("collect: carries the message for reaction checks", () => !!legs["The Maniacs"].msg);

// ── renderBoard / parseBoardHeader (Slack stores emoji as :shortcodes:) ──
const live = core.renderBoard({ legs, allTeams, week: 3, placerName: "Dirty Birds", deadlineLabel: "Thursday 6 PM ET", locked: false });
const hdr = core.parseBoardHeader(live.replace("📋", ":clipboard:"));
t("header round-trip (Slack-normalized)", () => hdr && hdr.week === 3 && hdr.placerName === "Dirty Birds" && hdr.deadlineLabel === "Thursday 6 PM ET");
t("locked board is a SLIP", () => core.isLockedBoard(core.renderBoard({ legs, allTeams, week: 3, placerName: "Dirty Birds", deadlineLabel: "x", locked: true })));
t("unchanged: Slack-normalized emoji compares equal", () => core.boardUnchanged(live.replace("📋", ":clipboard:"), live));
t("unchanged: different legs compare unequal", () => !core.boardUnchanged(live, live.replace("Vikings ML", "Vikings -3")));

// ── event filter: the loop guard ──
const ev = (o) => ({ type: "message", channel: CH, ...o });
t("event: human post → refresh", () => core.shouldRefreshForEvent(ev({ user: "US0P6RDSR", text: "Vikings ML", ts: "1" }), CH, SELF));
t("event: our own board edit → IGNORE (loop guard)", () => !core.shouldRefreshForEvent(ev({ subtype: "message_changed", message: { user: SELF, bot_id: "B1", text: "📋 WEEK 3 BOARD 6/12" }, previous_message: { user: SELF, bot_id: "B1", text: "📋 WEEK 3 BOARD 5/12" } }), CH, SELF));
t("event: our own board edit, self id unknown → still IGNORE", () => !core.shouldRefreshForEvent(ev({ subtype: "message_changed", message: { user: SELF, bot_id: "B1", text: "📋 WEEK 3 BOARD 6/12" }, previous_message: { text: "x" } }), CH, undefined));
t("event: our own opener post → IGNORE", () => !core.shouldRefreshForEvent(ev({ user: SELF, bot_id: "B1", text: "Week 3 Parlay Builder is OPEN … `🎯 LEG | Their Team | the leg`" }), CH, SELF));
t("event: human edits their leg → refresh", () => core.shouldRefreshForEvent(ev({ subtype: "message_changed", message: { user: "US0P6RDSR", text: "Bills -7" }, previous_message: { user: "US0P6RDSR", text: "Bills -3.5" } }), CH, SELF));
t("event: link unfurl (same text) → ignore", () => !core.shouldRefreshForEvent(ev({ subtype: "message_changed", message: { user: "US0P6RDSR", text: "Bills -3.5" }, previous_message: { user: "US0P6RDSR", text: "Bills -3.5" } }), CH, SELF));
t("event: human deletes their leg → refresh", () => core.shouldRefreshForEvent(ev({ subtype: "message_deleted", previous_message: { user: "US0P6RDSR", text: "Bills -3.5" } }), CH, SELF));
t("event: pin notice → ignore", () => !core.shouldRefreshForEvent(ev({ subtype: "pinned_item", user: SELF }), CH, SELF));
t("event: join → ignore", () => !core.shouldRefreshForEvent(ev({ subtype: "channel_join", user: "U9" }), CH, SELF));
t("event: other channel → ignore", () => !core.shouldRefreshForEvent({ type: "message", channel: "CXXX", user: "U9", text: "Vikings ML" }, CH, SELF));
t("event: other bot posting an explicit LEG line → refresh", () => core.shouldRefreshForEvent(ev({ subtype: "bot_message", bot_id: "BWF", text: "🎯 LEG | Title Chase | Bills ML" }), CH, SELF));

// ── reactions ──
t("reaction: skip when we already ✅'d", () => core.hasOurCheck({ reactions: [{ name: "white_check_mark", users: [SELF] }] }, SELF));
t("reaction: someone else's ✅ doesn't count", () => !core.hasOurCheck({ reactions: [{ name: "white_check_mark", users: ["U1"] }] }, SELF));
t("plan: add ✅ only where missing; remove from superseded leg", () => {
  const m1 = { ts: "150", user: "US0P6RDSR", text: "Bills -3.5", reactions: [{ name: "white_check_mark", users: [SELF] }] };
  const m2 = { ts: "300", user: "US0P6RDSR", text: "Buffalo to cover against the Chargers" };
  const m3 = { ts: "250", user: "US7R5B3C3", text: "Derrick Henry anytime td", reactions: [{ name: "white_check_mark", users: [SELF] }] };
  const L = core.collectLegs({ messages: [m2, m3, m1], allTeams, teamOfUser });
  const p = core.reactionPlan({ messages: [m2, m3, m1], legs: L, selfUserId: SELF });
  return p.add.join() === "300" && p.remove.join() === "150";
});

// ── weekFlags: what's already been posted (incl. the Thursday re-lock bug) ──
{
  const DL = Date.UTC(2026, 8, 24, 22, 0);
  const tue = (h) => String(Date.UTC(2026, 8, 23, h) / 1000);
  const B = (o) => ({ bot_id: "B1", user: SELF, ...o });
  t("flags: Tuesday opener + live board", () => { const f = core.weekFlags([B({ ts: tue(2), text: ":clipboard: *WEEK 3 BOARD — 5/12 legs*", pinned_to: [CH] }), B({ ts: tue(1), text: "*Week 3 Parlay Builder is OPEN*" })], DL); return f.opener && !f.slip && f.board.ts === tue(2); });
  t("flags: board EDITED into slip after deadline = locked", () => core.weekFlags([B({ ts: tue(2), text: ":lock: *WEEK 3 SLIP — 7/12 legs*", edited: { ts: String(DL / 1000 + 60) } })], DL).slip);
  t("flags: lock notification = locked", () => core.weekFlags([B({ ts: String(DL / 1000 + 30), text: ":lock: *Week 3 legs are locked* - 7/12 in." })], DL).slip);
  t("flags: early manual SLIP (Tuesday, unedited) is NOT a lock", () => { const f = core.weekFlags([B({ ts: tue(2), text: ":lock: *WEEK 3 SLIP — 0/12 legs*", pinned_to: [CH] })], DL); return !f.slip && f.board.ts === tue(2); });
  t("flags: older pinned boards listed for unpinning", () => { const f = core.weekFlags([B({ ts: tue(4), text: ":clipboard: *WEEK 3 BOARD — 5/12 legs*", pinned_to: [CH] }), B({ ts: tue(3), text: ":lock: *WEEK 3 SLIP — 3/12 legs*", pinned_to: [CH] }), B({ ts: tue(2), text: ":lock: *WEEK 3 SLIP — 0/12 legs*", pinned_to: [CH] }), B({ ts: tue(1), text: ":lock: *WEEK 3 SLIP — 0/12 legs*" })], DL); return f.board.ts === tue(4) && f.staleBoards.join() === [tue(3), tue(2)].join(); });
  t("flags: human messages ignored", () => !core.weekFlags([{ ts: tue(5), user: "U1", text: "Week 3 Parlay Builder is OPEN lol" }], DL).opener);
  t("flags: the @mention-style nag counts as posted (the repeat-nag bug)", () => core.weekFlags([B({ ts: tue(20), text: ":alarm_clock: *7/12 legs in* - locks *Thursday 6 PM ET*. Still missing:\n• *Silver Bullets* <@USYEVTKC2>" })], DL).nag);
  t("flags: the old-style nag still counts", () => core.weekFlags([B({ ts: tue(20), text: ":alarm_clock: *5/12 legs in.* Still missing: *Crab Boilers*" })], DL).nag);
  t("flags: the all-in nag counts", () => core.weekFlags([B({ ts: tue(20), text: ":white_check_mark: All 12 legs are in for week 3." })], DL).nag);
  t("flags: a board is not a nag", () => !core.weekFlags([B({ ts: tue(20), text: ":clipboard: *WEEK 3 BOARD — 7/12 legs* · locks *Thursday 6 PM ET*\n\nStill needed: C-Men" })], DL).nag);
}

// ── season record ──
for (const [txt, want] of [["Hit!", "hit"], ["🎰 miss", "miss"], ["we won", "hit"], ["Parlay cashed baby", "hit"], ["it busted", "miss"], ["L", "miss"], ["hit me up on my main line", null], ["no chance", null], ["Cashed in!", "hit"], ["Bet busted", "miss"], ["Bet is in to win $978", null], ["our bet hit", "hit"], ["Good process bad result", null], ["If my fannin td happens this week…", null]]) t(`result: ${txt}`, () => core.parlayResultFromText(txt) === want);
t("seasonRecord: thread verdict + short post, decoy ignored, window closes at next opener", () => {
  const B = { bot_id: "B1", user: SELF };
  const msgs = [
    { ...B, ts: "100", text: ":lock: *Week 1 legs are locked* - 9/12 in." }, { ts: "110", user: "UTB8NMCLQ", text: "Busted 😭" },
    { ...B, ts: "200", text: ":slot_machine: *Week 2 Parlay Builder is OPEN*" }, { ts: "210", user: "UTB8NMCLQ", text: "we won" }, // after the opener: belongs to no window
    { ...B, ts: "300", text: ":lock: *Week 2 legs are locked* - 8/12 in.", reply_count: 1 }, { ts: "310", user: "US0P6RDSR", text: "hit me up on my main line if you want" },
    { ...B, ts: "400", text: ":lock: *Week 3 legs are locked* - 5/12 in." },
  ];
  const r = core.seasonRecord({ messages: msgs, teamOfUser, repliesByTs: { "300": [{ ts: "320", user: "US7R5B3C3", text: "Hit! $629 baby" }] } });
  return r.wins === 1 && r.losses === 1 && r.byWeek.map((w) => `${w.week}:${w.result}`).join() === "1:miss,2:hit,3:null";
});

// ── talking to the bot ──
{
  const ctx = { legs: { Immigrants: { leg: "Davante Adams anytime TD" }, "The Maniacs": { leg: "Buffalo to cover" } }, allTeams: ["Immigrants", "The Maniacs", "Crab Boilers"], week: 3, placerName: "Dirty Birds", deadlineLabel: "Thursday 6 PM ET", record: { wins: 1, losses: 1, byWeek: [{ week: 1, result: "miss" }, { week: 2, result: "hit" }] }, usersByTeam: { "Crab Boilers": ["USJRGKTDJ"] }, askerTeam: "Immigrants" };
  const A = (t) => core.answerParlayQuestion(t, ctx).text;
  t("addressed: @mention", () => core.addressedToBot("<@U0C3B7QEC9M> status", SELF));
  t("addressed: 'hey parlay builder, who's missing?'", () => core.addressedToBot("hey parlay builder, who's missing?", SELF));
  t("addressed: 'yo parlay bot when do legs lock?'", () => core.addressedToBot("yo parlay bot when do legs lock?", SELF));
  t("not addressed: a gripe", () => !core.addressedToBot("parlay builder is annoying", SELF));
  t("not addressed: mentioned mid-sentence", () => !core.addressedToBot("the parlay builder thing is cool", SELF));
  t("not addressed: a normal leg", () => !core.addressedToBot("Vikings ML", SELF));
  t("answer: missing lists teams with mentions", () => /Crab Boilers\* <@USJRGKTDJ>/.test(A("hey parlay builder who's missing?")));
  t("answer: status has count, placer, deadline, record", () => /2\/3 legs in/.test(A("<@U0C3B7QEC9M> status")) && /Dirty Birds/.test(A("<@U0C3B7QEC9M> status")) && /season 1-1/.test(A("<@U0C3B7QEC9M> status")));
  t("answer: deadline", () => /lock \*Thursday 6 PM ET\*/.test(A("parlay builder when is it due")));
  t("answer: placer", () => /Dirty Birds\* is placing/.test(A("parlay builder who is placing")));
  t("answer: record", () => /\*1-1\*/.test(A("hey parlay builder whats our record")));
  t("answer: my leg", () => /Davante Adams anytime TD/.test(A("<@U0C3B7QEC9M> my leg?")));
  t("answer: addressed leg is logged", () => { const a = core.answerParlayQuestion("hey parlay builder, Vikings ML", ctx); return a.leg === "Vikings ML" && /Got it/.test(a.text); });
  t("answer: unknown question → help, not a guess", () => /Not sure/.test(A("hey parlay builder what time is it on mars?")));
  t("answer: before the opener", () => /hasn't opened yet/.test(core.answerParlayQuestion("parlay builder who's missing?", { ...ctx, week: null }).text));
  t("cleanLeg strips the address", () => core.cleanLeg("hey parlay builder, Vikings ML") === "Vikings ML");
  const T = "Hey parlay builder, what if I end up changing my pick? Did your \"god\" / creator account for that?";
  t("Tim's question: change → latest-wins rule, not his current pick", () => core.addressedToBot(T, SELF) && /latest\* post is the one that counts/.test(A(T)) && /He thought of that/.test(A(T)));
  t("'does the bot register a change?' (not addressed, but asked) → answers", () => core.addressedToBot("does the bot register a change in someone's bet?", SELF) && /latest/.test(A("does the bot register a change in someone's bet?")));
  t("'what if I forget?' → placer-picks rule", () => /placer picks it for you/.test(A("parlay builder what if I forget to post?")));
  t("'how do I report a hit?' → hit/miss rule", () => /reply \*hit\* or \*miss\*/.test(A("hey parlay builder how do I report if it hit?")));
  t("'how does this work' → full rules", () => /How the Parlay Builder works/.test(A("<@U0C3B7QEC9M> how does this work")));
  t("banter that mentions the bot without a question → ignored", () => !core.addressedToBot("Slack bot came to my wedding", SELF));
  t("league question → Oracle hand-off", () => core.isLeagueQuestion("hey parlay builder who won the 2023 championship?") && core.isLeagueQuestion("<@U0C3B7QEC9M> what do the bylaws say about taxi claims?"));
  t("parlay question is NOT a league question", () => !core.isLeagueQuestion("hey parlay builder can I change my parlay leg?") && !core.isLeagueQuestion("parlay builder who's placing the bet"));
  t("random question is NOT a league question (→ banter)", () => !core.isLeagueQuestion("parlay builder what's the capital of Peru?"));
  t("Oracle answer → Slack mrkdwn, capped", () => { const o = core.oracleForSlack("## Champions\n**Title Chase** won in 2023.\n- two titles"); return /^🔮 \*The Oracle:\* /.test(o) && /\*Title Chase\*/.test(o) && !/\*\*/.test(o) && !/##/.test(o) && core.oracleForSlack("x".repeat(900)).length < 720; });

  // after the lock (Lee, Thu 7:10pm: "Gimme Bijan TD" → silence, which read as "logged")
  const L = { ...ctx, locked: true, deadlineLabel: "" }; // a SLIP header carries no deadline
  const AL = (t) => core.answerParlayQuestion(t, L).text;
  t("locked: addressed leg is NOT logged; the placer is asked", () => { const a = core.answerParlayQuestion("hey parlay builder, Bijan TD", { ...L, usersByTeam: { "Dirty Birds": ["U0650HX32KV"] } }); return a.leg === null && /locked, but \*Immigrants\* just posted "Bijan TD"/.test(a.text) && /have you already set the parlay/.test(a.text); });
  t("locked: deadline question → locked, no empty bold", () => /Week 3 is locked/.test(AL("parlay builder when is it due")) && !/\*\*/.test(AL("parlay builder when is it due")));
  t("locked: change → not this week", () => /Not this week/.test(AL("hey parlay builder can I change my pick?")));
  t("locked: missing → placer picks", () => /Locked at 2\/3/.test(AL("parlay builder who's missing?")) && /picks for: \*Crab Boilers\*/.test(AL("parlay builder who's missing?")));
  t("locked: status says locked", () => /🔒 locked/.test(AL("<@U0C3B7QEC9M> status")) && /Placer picks for: Crab Boilers/.test(AL("<@U0C3B7QEC9M> status")));
  t("open week: nothing changes", () => { const a = core.answerParlayQuestion("hey parlay builder, Bijan TD", { ...ctx, locked: false }); return a.leg === "Bijan TD"; });
  const lateCtx = { locked: true, teamOfUser: (u) => (u === "US0P6RDSR" ? "The Maniacs" : null) };
  t("late leg: Lee's post after the lock", () => core.isLateLeg({ user: "US0P6RDSR", text: "Gimme Bijan TD", ts: "1" }, lateCtx));
  t("late leg: 🎯 post after the lock", () => core.isLateLeg({ user: "US0P6RDSR", text: "🎯 Bills -3.5", ts: "1" }, lateCtx));
  t("not late: week still open", () => !core.isLateLeg({ user: "US0P6RDSR", text: "Gimme Bijan TD", ts: "1" }, { ...lateCtx, locked: false }));
  t("not late: thread reply (hit/miss reports live there)", () => !core.isLateLeg({ user: "US0P6RDSR", text: "Bijan TD", ts: "2", thread_ts: "1" }, lateCtx));
  t("not late: a result report", () => !core.isLateLeg({ user: "US0P6RDSR", text: "Josh Allen TD hit", ts: "1" }, lateCtx) && !core.isLateLeg({ user: "US0P6RDSR", text: "parlay busted", ts: "1" }, lateCtx));
  t("not late: chatter / unknown user / edits", () => !core.isLateLeg({ user: "US0P6RDSR", text: "lol we are cooked", ts: "1" }, lateCtx) && !core.isLateLeg({ user: "UNKNOWN", text: "Bijan TD", ts: "1" }, lateCtx) && !core.isLateLeg({ user: "US0P6RDSR", text: "Bijan TD", ts: "1", subtype: "message_changed" }, lateCtx));
  const late = core.renderLateLeg({ week: 6, team: "The Maniacs", placerName: "Dirty Birds", leg: "Bijan TD" });
  const pinged = core.renderLateLeg({ week: 6, team: "The Maniacs", placerName: "Dirty Birds", placerMentions: ["U0650HX32KV", "U08J2BJARLL"], poster: "US0P6RDSR", leg: "Bijan TD" });
  t("late leg before kickoff: @s the placer(s) and the poster, asks if the parlay is set, says it is not on the slip", () => /<@U0650HX32KV> <@U08J2BJARLL> \(\*Dirty Birds\*\)/.test(pinged) && /<@US0P6RDSR> \*The Maniacs\* just posted "Bijan TD"/.test(pinged) && /have you already set the parlay\?/.test(pinged) && /\*not\* on the slip/.test(pinged));
  t("late leg after kickoff: no ping, just 'can't make the slip'", () => { const x = core.renderLateLeg({ week: 6, team: "The Maniacs", placerName: "Dirty Birds", placerMentions: ["U0650HX32KV"], leg: "Bijan TD", beforeKickoff: false }); return /can't make the slip/.test(x) && !/have you already set/.test(x); });
  t("late reply: names placer + team, trips none of the bot's own detectors", () => /\*Dirty Birds\*/.test(late) && /\*The Maniacs\*/.test(late) && !/legs are locked/i.test(late) && !core.isBoard(late) && !core.isOpener(late) && !core.weekFlags([{ bot_id: "B1", ts: "1", text: late }], 0).nag && !core.weekFlags([{ bot_id: "B1", ts: "1", text: late }], 0).slip);
  t("late reply: no week → 'This week'", () => /This week is locked/.test(core.renderLateLeg({ week: null, team: null, placerName: null, leg: "x" })));
}

// ── deadline token + lock notice ──
{
  const b = core.renderBoard({ legs, allTeams, week: 3, placerName: "Dirty Birds", deadlineLabel: "Thursday 6 PM ET", deadlineEpochMs: 1790287200000, locked: false });
  const h = core.parseBoardHeader(b.replace("📋", ":clipboard:"));
  t("board header carries the deadline epoch (Slack date token) and round-trips", () => h.deadlineEpochMs === 1790287200000 && h.deadlineLabel === "Thursday 6 PM ET");
  t("old header (no token) still parses", () => core.parseBoardHeader(":clipboard: *WEEK 3 BOARD — 5/12 legs* · Placer: *Dirty Birds* · locks *Thursday 6 PM ET*").deadlineEpochMs === null);
  t("unchanged-check tolerates the token", () => core.boardUnchanged(b.replace("📋", ":clipboard:"), b));
  const n = core.renderLockNotice({ legs, allTeams, week: 3, placerName: "Dirty Birds", placerMentions: ["U0650HX32KV", "U08J2BJARLL"], kickoffLabel: "Thursday 8:15 PM ET" });
  t("lock notice IS the slip: legs listed, placer @mentioned, hit/miss ask", () => /legs are locked/.test(n) && /<@U0650HX32KV> <@U08J2BJARLL>/.test(n) && /• \*Immigrants\* — Davante Adams anytime TD/.test(n) && /\*hit\* or \*miss\*/.test(n));
  t("lock notice is detected as the lock by weekFlags", () => core.weekFlags([{ bot_id: "B1", user: SELF, ts: "1790287500", text: n }], 1790287200000).slip);
}

t("seasonRecord: seeded pre-bot weeks count, channel results win when both exist", () => {
  const B = { bot_id: "B1", user: SELF };
  const r = core.seasonRecord({ messages: [{ ...B, ts: "400", text: ":lock: *Week 3 legs are locked* - 7/12 in." }, { ts: "410", user: "UTB8NMCLQ", text: "Bet busted" }], teamOfUser, seed: { 1: "miss", 3: "hit" } });
  return r.wins === 0 && r.losses === 2 && r.byWeek.map((w) => `${w.week}:${w.result}${w.seeded ? "*" : ""}`).join() === "1:miss*,3:miss";
});

// ── odds, rendering, ⚠️ plan ──
t("americanToDecimal / decimalToAmerican round-trip", () => core.americanToDecimal(150) === 2.5 && Math.abs(core.americanToDecimal(-200) - 1.5) < 1e-9 && core.decimalToAmerican(2.5) === 150 && core.decimalToAmerican(1.5) === -200);
t("parlayOdds: -110 x2 → +264; unpriced legs are left out and counted", () => { const p = core.parlayOdds([-110, -110]); const q = core.parlayOdds([-110, null, -110]); return p.american === 264 && p.priced === 2 && q.american === 264 && q.priced === 2 && q.total === 3 && core.parlayOdds([null, null]) === null; });
t("fmtAmerican", () => core.fmtAmerican(150) === "+150" && core.fmtAmerican(-110) === "-110" && core.fmtAmerican(null) === "n/a");
{
  const legsO = { Immigrants: { leg: "Vikings ML", odds: -285 }, "The Maniacs": { leg: "Garrett Wilson anytime TD", odds: null } };
  const b = core.renderBoard({ legs: legsO, allTeams, week: 7, placerName: "We Have The Meats", deadlineLabel: "Thursday 8 PM ET", deadlineEpochMs: 1790294400000, locked: false });
  t("board: odds on each leg, n/a for props, combined price + how many were priced", () => /Vikings ML \(-285\)/.test(b) && /Wilson anytime TD \(n\/a\)/.test(b) && /Est\. parlay at DraftKings: \*-285\* \(1 of 2 legs priced/.test(b));
  t("board: the top 'copy me' line stays odds-free", () => b.split("\n")[1] === "Vikings ML  •  Garrett Wilson anytime TD".split("  •  ").reverse().join("  •  ") || !b.split("\n")[1].includes("(-285)"));
  const lk = core.renderBoard({ legs: legsO, allTeams, week: 7, placerName: "We Have The Meats", deadlineLabel: "Thursday 8 PM ET", deadlineEpochMs: 1790294400000, locked: true });
  t("locked slip carries the lock time, and parseBoardHeader reads it back", () => /locked \*<!date\^1790294400\^/.test(lk) && core.parseBoardHeader(lk.replace("🔒", ":lock:")).deadlineEpochMs === 1790294400000);
  t("no odds supplied (old callers / no slate) → no tags, no footer", () => !/\(n\/a\)|Est\. parlay/.test(core.renderBoard({ legs: { Immigrants: { leg: "Vikings ML" } }, allTeams, week: 7, placerName: null, deadlineLabel: "x", locked: false })));
  t("lock notice carries odds too", () => /Vikings ML \(-285\)/.test(core.renderLockNotice({ legs: legsO, allTeams, week: 7, placerName: "X" })));
}
{
  const bye = (leg, ts) => (/Bills/.test(leg) ? "The Bills are on a bye in Week 7" : null);
  const msgs = [{ ts: "100", user: "UTB8NMCLQ", text: "Bills ML" }, { ts: "90", user: "US0P6RDSR", text: "Vikings ML" }];
  const d = core.collectLegsDetailed({ messages: msgs, allTeams, teamOfUser, check: bye });
  t("collect: a leg that fails the check is rejected with its reason, not counted", () => !d.legs["Immigrants"] && d.rejected.length === 1 && d.rejected[0].team === "Immigrants" && /bye/.test(d.rejected[0].reason) && d.legs["The Maniacs"].leg === "Vikings ML");
  const d2 = core.collectLegsDetailed({ messages: [{ ts: "120", user: "UTB8NMCLQ", text: "Chiefs ML" }, ...msgs], allTeams, teamOfUser, check: bye });
  t("collect: a newer valid leg supersedes the rejected one (no stale warning)", () => d2.legs["Immigrants"].leg === "Chiefs ML" && d2.rejected.length === 0);
  const d3 = core.collectLegsDetailed({ messages: [{ ts: "200", user: "US0P6RDSR", text: "Bills -3.5" }, ...msgs], allTeams, teamOfUser, check: bye });
  t("collect: latest post invalid → the team's earlier valid leg still stands", () => d3.legs["The Maniacs"].leg === "Vikings ML" && d3.rejected.some((r) => r.team === "The Maniacs" && r.ts === "200"));
  const d4 = core.collectLegsDetailed({ messages: msgs, allTeams, teamOfUser, beforeMs: 95000 });
  t("collect: beforeMs drops anything posted after the lock", () => d4.legs["The Maniacs"] && !d4.legs["Immigrants"]);
  const plan = core.reactionPlan({ messages: msgs, replies: [], legs: d.legs, selfUserId: SELF, rejected: d.rejected });
  t("plan: ⚠️ for a rejected leg (once), ✅ only for the counted one", () => plan.warn.length === 1 && plan.warn[0].ts === "100" && plan.add.length === 1 && plan.add[0] === "90");
  const done = [{ ...msgs[0], reactions: [{ name: "warning", users: [SELF] }] }, msgs[1]];
  const dDone = core.collectLegsDetailed({ messages: done, allTeams, teamOfUser, check: bye });
  t("plan: already ⚠️'d → no second warning; edited into something valid → ⚠️ removed", () => core.reactionPlan({ messages: done, replies: [], legs: dDone.legs, selfUserId: SELF, rejected: dDone.rejected }).warn.length === 0 && core.reactionPlan({ messages: done, replies: [], legs: d.legs, selfUserId: SELF, rejected: [] }).unwarn[0] === "100");
  t("invalid-leg reply explains and @s the poster", () => { const x = core.renderInvalidLeg({ user: "UTB8NMCLQ", leg: "Bills ML", reason: "The Bills are on a bye in Week 7" }); return /<@UTB8NMCLQ> "Bills ML" can't be played: The Bills are on a bye in Week 7/.test(x) && !core.isBoard(x) && !core.isOpener(x); });
  t("addressed 'Bills ML' on a bye week → invalid reply, not 'Got it'", () => { const a = core.answerParlayQuestion("hey parlay builder, Bills ML", { legs: {}, allTeams, week: 7, placerName: "X", deadlineLabel: "", askerTeam: "Immigrants", checkLeg: bye }); return a.leg === null && /can't be played/.test(a.text); });
}

// ── a thread reply is a pick only when it looks like one ──
{
  const lee = { ts: "10", user: "US0P6RDSR", text: "Recommended improvement to the bot, current odds according to whichever book on the parlay" };
  const chiefs = { ts: "11", user: "US7R5B3C3", text: "Chiefs" };
  const d = core.collectLegsDetailed({ messages: [], replies: [lee, chiefs], allTeams, teamOfUser });
  t("thread: feedback about the bot is not a leg", () => !d.legs["The Maniacs"]);
  t("thread: a short plain pick ('Chiefs') still counts", () => d.legs["The 5th Rounders"]?.leg === "Chiefs");
  t("thread: banter with a question or comma is not a leg", () => !core.isPlainPick("what about the Bills, though") && !core.isPlainPick("Are we in?") && core.isPlainPick("Bills -3"));
}

// ── a lock the old fixed-6PM rule fired too early ──
{
  const notice = { ts: String(Date.parse("2026-10-22T22:48:08Z") / 1000), bot_id: "B1", text: ":lock: *Week 7 legs are locked* \u2014 4/12 in." };
  const legacy = { week: 7, placerName: "X", deadlineLabel: "", deadlineEpochMs: null };
  const sunday = Date.parse("2026-10-25T16:45:00Z"), thu9pm = Date.parse("2026-10-23T01:00:00Z");
  t("stale: legacy lock, real cutoff still ahead → reopen", () => core.isStaleLock({ notice, header: legacy, lockMs: sunday, nowMs: thu9pm }));
  t("stale: cutoff already passed → the lock stands", () => !core.isStaleLock({ notice, header: legacy, lockMs: Date.parse("2026-10-23T00:00:00Z"), nowMs: thu9pm }));
  t("stale: lock posted at/after the cutoff (a late cron) → stands", () => !core.isStaleLock({ notice, header: legacy, lockMs: Date.parse("2026-10-22T22:30:00Z"), nowMs: Date.parse("2026-10-22T22:50:00Z") }));
  t("stale: a slip the current code locked records its time → never reopened by a deleted post", () => !core.isStaleLock({ notice, header: { ...legacy, deadlineEpochMs: Date.parse("2026-10-23T00:00:00Z") }, lockMs: sunday, nowMs: thu9pm }));
  t("stale: no notice / no lock time → nothing to reopen", () => !core.isStaleLock({ notice: null, header: legacy, lockMs: sunday, nowMs: thu9pm }) && !core.isStaleLock({ notice, header: legacy, lockMs: null, nowMs: thu9pm }));
  t("lockNoticeOf picks the newest bot lock notice", () => core.lockNoticeOf([{ ts: "3", text: "hi" }, { ts: "2", bot_id: "B", text: "\ud83d\udd12 *Week 7 legs are locked*" }, { ts: "1", bot_id: "B", text: "Week 6 legs are locked" }]).ts === "2");
  const gone = core.renderRetractedNotice({ week: 7, lockLabel: "Sunday 12:45 PM ET" });
  t("retracted notice can no longer be mistaken for a lock, a board or an opener", () => !/legs are locked/i.test(gone) && !core.isBoard(gone) && !core.isOpener(gone) && /Sunday 12:45 PM ET/.test(gone));
  const re = core.renderReopened({ week: 7, lockLabel: "Sunday 12:45 PM ET", rescued: [{ team: "Crab Boilers", leg: "Kyren Williams anytime td", mention: "<@USJRGKTDJ>" }] });
  t("reopened announcement: new lock, who was rescued, nothing a lock-detector would match", () => /Week 7 is open again/.test(re) && /<@USJRGKTDJ> \*Crab Boilers\* \u2014 Kyren Williams/.test(re) && /Sunday 12:45 PM ET/.test(re) && !/legs are locked/i.test(re) && !core.isBoard(re));
}

{
  const b = core.renderBoard({ legs: { Immigrants: { leg: "Jared Goff, two passing TDs" } }, allTeams, week: 7, placerName: "X", deadlineLabel: "Thursday 8 PM ET", locked: false, unplaced: [{ team: "Immigrants", leg: "Jared Goff, two passing TDs" }] });
  t("board: an unplaceable leg is called out with how to fix it", () => /Can't tell which game "Jared Goff, two passing TDs" \(Immigrants\) is in/.test(b) && /Jared Goff \(DET\)/.test(b));
  t("board: no note when every leg is placed", () => !/Can't tell which game/.test(core.renderBoard({ legs: {}, allTeams, week: 7, placerName: "X", deadlineLabel: "x", locked: false })));
}

// ── nflWeekStartMs: Monday 00:00 ET, but a Monday still belongs to last week (MNF) ──
{
  const W = core.nflWeekStartMs, mon19 = Date.parse("2026-10-19T04:00:00Z"), mon26 = Date.parse("2026-10-26T04:00:00Z"); // EDT midnights
  const tnf22 = Date.parse("2026-10-23T00:15:00Z");
  t("week start: Monday 12:59am ET (the Week 7 re-open) → the PREVIOUS Monday", () => W(Date.parse("2026-10-26T04:59:00Z")) === mon19);
  t("week start: Monday 8pm ET → previous Monday", () => W(Date.parse("2026-10-27T00:00:00Z")) === mon19);
  t("week start: Tuesday → this Monday", () => W(Date.parse("2026-10-27T14:00:00Z")) === mon26);
  t("week start: Sunday → this week's Monday", () => W(Date.parse("2026-10-25T16:00:00Z")) === mon19);
  t("week start: slate anchor wins (Week 7 slate on Tuesday Oct 27, before Sleeper flips)", () => W(Date.parse("2026-10-27T14:30:00Z"), tnf22) === mon19);
  t("week start: a stale/odd kickoff far from now is ignored", () => W(Date.parse("2026-10-27T14:30:00Z"), Date.parse("2026-09-10T00:00:00Z")) === mon26);
  t("week start: EST after DST ends (Mon Nov 9 2026 → Nov 2 05:00Z)", () => W(Date.parse("2026-11-10T03:00:00Z")) === Date.parse("2026-11-02T05:00:00Z"));
}

// ── straysAfterLock: the Oct 26 duplicate opener/board/nag get cleaned up ──
{
  const B = "B1";
  const lock = { ts: "1792947149.517629", bot_id: B, text: ":lock: *Week 7 legs are locked* — 6/12 in." };
  const opener = { ts: "1792990792.436449", bot_id: B, text: ":slot_machine: *Week 7 Parlay Builder is OPEN*" };
  const board = { ts: "1792990792.509229", bot_id: B, text: ":clipboard: *WEEK 7 BOARD — 0/12 legs*" };
  const nag = { ts: "1792990792.703649", bot_id: B, text: ":alarm_clock: *0/12 legs in* - locks *Monday 8 PM ET*." };
  const slip = { ts: "1792700000.000100", bot_id: B, text: ":lock: *WEEK 7 SLIP — 6/12 legs*" };
  const oldOpener = { ts: "1792600000.000100", bot_id: B, text: ":slot_machine: *Week 7 Parlay Builder is OPEN*" };
  const human = { ts: "1792990800.000100", user: "U1", text: "Week 7 Parlay Builder is OPEN lol" };
  const msgs = [human, nag, board, opener, lock, slip, oldOpener]; // newest first
  const got = core.straysAfterLock(msgs, 7);
  t("strays: the post-lock opener, board and nag are flagged", () => got.length === 3 && got.includes(opener.ts) && got.includes(board.ts) && got.includes(nag.ts));
  t("strays: never the slip, the real opener, or a human's message", () => !got.includes(slip.ts) && !got.includes(oldOpener.ts) && !got.includes(human.ts));
  t("strays: none when the week isn't locked", () => core.straysAfterLock([nag, board, opener, slip, oldOpener], 7).length === 0);
  t("strays: none when the notice was withdrawn (a real reopen)", () => core.straysAfterLock([nag, board, { ...lock, text: ":unlock: _Week 7 lock notice withdrawn - it went out early._" }, slip], 7).length === 0);
  t("strays: a different week's lock doesn't count", () => core.straysAfterLock(msgs, 8).length === 0);
}

console.log(`parlay-core: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
