// Tests for src/lib/server/parlayReopen.js with a recording fake Slack.
// Run: node scripts/test/parlay-reopen.test.mjs
import { reopenWeek } from "../../src/lib/server/parlayReopen.js";

let pass = 0, fail = 0;
const t = async (name, fn) => { try { if (await fn()) pass++; else { fail++; console.log(`  FAIL ${name}`); } } catch (e) { fail++; console.log(`  FAIL ${name} → ${e.message}`); } };

const notice = { ts: "100", bot_id: "B1", text: ":lock: *Week 7 legs are locked* - 4/12 in." };
const lateKyren = { ts: "110", user: "USJRGKTDJ", text: "Kyren Williams anytime td", reactions: [{ name: "lock", users: ["UBOT"] }], reply_count: 1 };
const lateVikes = { ts: "120", user: "U02SQMEQ4R1", text: "Vikings ML #SKOL", reactions: [{ name: "lock", users: ["UBOT"] }], reply_count: 2 };
const early = { ts: "50", user: "USJRGMXK6", text: "Henry 2+ TD" };
const threads = { "110": [{ ts: "110.1", bot_id: "B1", text: ":lock: Too late - Week 7 is locked and the slip is final." }], "120": [{ ts: "120.1", bot_id: "B1", text: "🔒 Week 7 is locked, but Risky Business just posted it." }, { ts: "120.2", user: "UTB8NMCLQ", text: "Will fix this" }] };

const run = async (extra = {}) => {
  const calls = [];
  const slack = async (method, body) => { calls.push({ method, body }); return { ok: true }; };
  const slackGet = async (method, params) => {
    if (method === "conversations.replies") return { messages: [{ ts: params.ts }, ...(threads[params.ts] || [])] };
    if (method === "chat.getPermalink") return { permalink: "https://slack.test/board" };
    if (method === "bookmarks.list") return { bookmarks: [{ id: "Bk1", title: ":lock: Week 7 slip" }] };
    return {};
  };
  const legs = { "Crab Boilers": { leg: "Kyren Williams anytime td", ts: "110", msg: lateKyren }, "Risky Business": { leg: "Vikings ML #SKOL", ts: "120", msg: lateVikes }, "C-Men": { leg: "Henry 2+ TD", ts: "50", msg: early } };
  const note = await reopenWeek({ slack, slackGet, channel: "C1", week: 7, notice, messages: [lateVikes, lateKyren, notice, early], legs, lockLabel: "Sunday 12:45 PM ET", boardText: "📋 *WEEK 7 BOARD — 3/12 legs*", boardTs: "70", ...extra });
  return { calls, note };
};

const { calls, note } = await run();
const of = (m) => calls.filter((c) => c.method === m);
await t("the board is restored to the live version", () => of("chat.update").some((c) => c.body.ts === "70" && /WEEK 7 BOARD/.test(c.body.text)));
await t("the old notice is edited so it no longer says 'locked'", () => { const u = of("chat.update").find((c) => c.body.ts === "100"); return u && !/legs are locked/i.test(u.body.text) && /Sunday 12:45 PM ET/.test(u.body.text); });
await t("🔒 removed from each late post", () => of("reactions.remove").map((c) => c.body.timestamp).sort().join() === "110,120" && of("reactions.remove").every((c) => c.body.name === "lock"));
await t("the bot's 'too late' replies are deleted - a human's reply in the same thread is not", () => of("chat.delete").map((c) => c.body.ts).sort().join() === "110.1,120.1");
await t("the bookmark goes back to a board", () => of("bookmarks.edit").some((c) => /📋 Week 7 board/.test(c.body.title)));
await t("one announcement: new lock time, @s the two rescued posters, not the early one", () => { const p = of("chat.postMessage"); return p.length === 1 && /open again/.test(p[0].body.text) && p[0].body.text.includes("<@USJRGKTDJ>") && p[0].body.text.includes("<@U02SQMEQ4R1>") && !p[0].body.text.includes("USJRGMXK6"); });
await t("returns a one-line summary for the log", () => /reopened week 7/.test(note) && /2 late leg/.test(note));
const lean = await run({ boardText: null, boardTs: null });
await t("cron path (no board text): the board is left to the normal tick, notice still withdrawn", () => !lean.calls.some((c) => c.method === "chat.update" && c.body.ts === "70") && lean.calls.some((c) => c.method === "chat.update" && c.body.ts === "100"));
await t("a failing cleanup call never stops the announcement", async () => {
  const c2 = [];
  const slack = async (m, b) => { c2.push(m); if (/reactions|delete/.test(m)) throw new Error("not_allowed"); return {}; };
  await reopenWeek({ slack, slackGet: async () => ({ messages: [] }), channel: "C1", week: 7, notice, messages: [lateKyren], legs: {}, lockLabel: "x" });
  return c2.includes("chat.postMessage");
});

console.log(`parlay-reopen: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
