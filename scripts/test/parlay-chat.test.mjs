// Unit tests for src/lib/server/parlayChat.js - when the bot joins a thread conversation,
// when a question needs context, and what the AI is told.
// Run: node scripts/test/parlay-chat.test.mjs
import * as C from "../../src/lib/server/parlayChat.js";

let pass = 0, fail = 0;
const t = (name, fn) => { try { if (fn()) pass++; else { fail++; console.log(`  FAIL ${name}`); } } catch (e) { fail++; console.log(`  FAIL ${name} → ${e.message}`); } };

const BOT = "U0C3B7QEC9M";
const botSaid = [{ ts: "1.1", user: "USJRGKTDJ", text: "Hey Parlay Builder. What's the current bet?" }, { ts: "1.2", user: BOT, bot_id: "B1", text: "*7/12 legs in* ..." }];
const humanLast = [...botSaid, { ts: "1.3", user: "U02SQMEQ4R1", text: "Aaron's leg is tonight" }];

// ── follow-ups: right after the bot, phrased to it ──
t("follow-up: a question right after the bot", () => C.isFollowUp("what about mine?", botSaid, BOT));
t("follow-up: 'and the lock?' / 'how about Lee's'", () => C.isFollowUp("and when does it lock", botSaid, BOT) && C.isFollowUp("how about Lee's leg", botSaid, BOT));
t("follow-up: a correction ('that's wrong') or thanks", () => C.isFollowUp("that's wrong, Golden plays tonight", botSaid, BOT) && C.isFollowUp("thanks", botSaid, BOT));
t("not a follow-up: someone else spoke after the bot", () => !C.isFollowUp("what about mine?", humanLast, BOT));
t("not a follow-up: banter ('I asked the bot not you')", () => !C.isFollowUp("I wasn't talking to you", botSaid, BOT) && !C.isFollowUp("Jesus. Chill dawg", botSaid, BOT));
t("not a follow-up: 'lol' / plain statements", () => !C.isFollowUp("lol", botSaid, BOT) && !C.isFollowUp("Bills ML", botSaid, BOT));
t("not a follow-up: top-level (no thread)", () => !C.isFollowUp("what about mine?", [], BOT));

// ── when the rules engine needs help ──
t("needsContext: pronouns / two questions / 'should I'", () => C.needsContext("is that one priced?") && C.needsContext("What's the bet? Any tonight?") && C.needsContext("should I switch to Bills ML") && C.needsContext("which leg is the riskiest"));
t("needsContext: plain status questions don't", () => !C.needsContext("parlay builder status") && !C.needsContext("who's missing?") && !C.needsContext("when does it lock"));
t("needsContext: any follow-up does", () => C.needsContext("ok", { followUp: true }));

// ── the brief ──
const tnf = Date.parse("2026-10-30T00:15:00Z"), now = Date.parse("2026-10-29T22:54:00Z");
const ctx = {
  header: { week: 8, placerName: "Crab Boilers", deadlineLabel: "Thursday 8 PM ET" },
  allTeams: ["Title Chase", "Immigrants", "Dirty Birds", "C-Men"],
  legs: { "Title Chase": { leg: "Mathew golden 1st touchdown", odds: "noline", readAs: "first TD of the game · GB" }, Immigrants: { leg: "Bills ML", odds: -170 }, "Dirty Birds": { leg: "Justin Jefferson a time td", odds: 155, readAs: "anytime TD · MIN" } },
  lockMs: tnf - 15 * 60e3, locked: false, rejected: [],
  gameOf: (l) => ({ "Mathew golden 1st touchdown": { label: "CAR @ GB", kickoffMs: tnf }, "Bills ML": { label: "BAL @ BUF", kickoffMs: Date.parse("2026-11-01T18:00:00Z") } })[l] || null,
  teamOfUser: (u) => ({ USJRGKTDJ: "Crab Boilers", UTB8NMCLQ: "Immigrants" })[u] || null,
};
const brief = C.buildBrief({ ctx, asker: "the Immigrants manager", thread: botSaid, recent: [{ ts: "2", user: "US0P6RDSR", text: "Ceedee anytime TD" }], record: { wins: 0, losses: 3, byWeek: [{ week: 5, result: "miss" }, { week: 6, result: "miss" }, { week: 7, result: "miss" }] }, nowMs: now, selfUserId: BOT });
t("brief: the time, week, placer, lock countdown", () => /Now: Thu, Oct 29, 6:54 PM ET/.test(brief) && /Week 8\. Placer \(places the bet\): Crab Boilers\. 3\/4 legs in/.test(brief) && /Legs lock Thu, Oct 29, 8 PM ET \(in 66 min\)/.test(brief));
t("brief: every leg with how it was read, its game and odds", () => /- Title Chase: "Mathew golden 1st touchdown" \(read as: first TD of the game · GB\) · CAR @ GB, kicks off Thu, Oct 29, 8:15 PM ET · odds no line yet/.test(brief) && /Immigrants: "Bills ML" · BAL @ BUF.* · odds -170/.test(brief) && /Dirty Birds: .*game unknown · odds \+155/.test(brief));
t("brief: who's missing, the season, the asker", () => /Still missing: C-Men\./.test(brief) && /Season parlay record: 0-3/.test(brief) && /Asker: the Immigrants manager/.test(brief));
t("brief: the thread, with who said what", () => /This thread so far \(oldest first\):\nCrab Boilers manager: Hey Parlay Builder\. What's the current bet\?\nParlay Builder \(you\): \*7\/12 legs in\*/.test(brief));
t("brief: recent channel chatter", () => /Recent channel messages \(oldest first\):\na league member: Ceedee anytime TD/.test(brief));
t("brief: before the opener says so", () => /hasn't opened yet/.test(C.buildBrief({ ctx: { ...ctx, header: null }, nowMs: now })));
t("system prompt: grounded, reads the thread, owns corrections, no @-mentions", () => { const s = C.CHAT_SYSTEM("RULES"); return /ONLY the facts in the brief/.test(s) && /Read the thread/.test(s) && /own it/.test(s) && /Don't @-mention/.test(s) && s.endsWith("RULES"); });

console.log(`parlay-chat: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
