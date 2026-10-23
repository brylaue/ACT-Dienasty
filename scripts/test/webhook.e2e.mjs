// End-to-end test of the Slack Events webhook (src/routes/api/parlay/events)
// against the BUILT site: starts `vite preview` with the outside world mocked
// (mock-slack.mjs: Slack, ESPN scoreboard, ESPN player search), posts signed
// Slack events, and checks what the bot would have done - board edits, ✅/⚠️/🔒
// reactions, thread replies, the moving lock, odds. Needs `npm run build`
// first (CI does); skipped locally without one.
// Run: node scripts/test/webhook.e2e.mjs
import { spawn } from "node:child_process";
import { createHmac } from "node:crypto";
import { createServer } from "node:net";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url)), root = join(here, "..", "..");
if (!existsSync(join(root, ".svelte-kit", "output", "server"))) {
  console.log(process.env.CI ? "webhook e2e: no build output - run `npm run build` first" : "webhook e2e: SKIPPED (no build - run `npm run build` first)");
  process.exit(process.env.CI ? 1 : 0);
}

const PORT = await new Promise((res) => { const s = createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); }); }); // a free port, so back-to-back runs never collide
const SECRET = "e2e-signing-secret", CH = "C09EEV8M32S", SELF = "U0C3B7QEC9M";
const LEE = "US0P6RDSR", BRYAN = "UTB8NMCLQ", TIM = "USJRGKTDJ", CYRES = "U02SQMEQ4R1"; // The Maniacs, Immigrants, Crab Boilers, Risky Business
const PLACER_MENTION = "<@U0650HX32KV>"; // Dirty Birds, the fixture's placer
const dir = mkdtempSync(join(tmpdir(), "parlay-e2e-"));
const STATE = join(dir, "state.json"), LOG = join(dir, "slack.jsonl");
writeFileSync(STATE, "{}"); writeFileSync(LOG, "");

const fixture = (name) => JSON.parse(readFileSync(join(here, "fixtures", `${name}.json`), "utf8"));
const PLAYERS = { "garrett wilson": "NYJ", "davante adams": "LAR", "derrick henry": "BAL", "jalen coker": "CAR" };
// kickoffIn: when the slate's FIRST game (Thursday night) starts, relative to now
const setState = (messages, { kickoffIn = 26 * 3600e3, replies = [] } = {}) => { writeFileSync(STATE, JSON.stringify({ messages, replies, firstKickoffInMs: kickoffIn, players: PLAYERS })); writeFileSync(LOG, ""); };
const calls = () => readFileSync(LOG, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((c) => c.method !== "espn.scoreboard");

// The Tuesday channel (5 legs, a live pinned board). The Maniacs' leg is Buffalo/Chargers - both on a bye in the slate - so it
// is split out: BASE is the clean 4-leg week, BYE_MSG is the bad one.
const tuesday = fixture("week3-tuesday").messages;
const BYE_MSG = tuesday.find((m) => !m.bot_id && /Buffalo to cover/.test(m.text || "")); // the manager's post - not the board that echoes it
const BASE = tuesday.filter((m) => m !== BYE_MSG);
const LOCKED = fixture("week3-locked").messages.filter((m) => m.bot_id || !/Buffalo to cover/.test(m.text || ""));
const nowTs = () => `${Date.now() / 1000}`;
const BOARD = (msgs) => msgs.find((m) => m.bot_id && /WEEK 3 BOARD/.test(m.text || ""));

const post = async (body, { sign = true, retry = false } = {}) => {
  writeFileSync(LOG, ""); // each post is judged on its own calls
  const raw = JSON.stringify(body), ts = String(Math.floor(Date.now() / 1000));
  const sig = "v0=" + createHmac("sha256", sign ? SECRET : "wrong").update(`v0:${ts}:${raw}`).digest("hex");
  const r = await fetch(`http://127.0.0.1:${PORT}/api/parlay/events`, { method: "POST", headers: { "content-type": "application/json", "x-slack-request-timestamp": ts, "x-slack-signature": sig, ...(retry ? { "x-slack-retry-num": "1" } : {}) }, body: raw });
  return { status: r.status, text: await r.text() };
};
const msg = (user, text, extra = {}) => ({ type: "event_callback", authorizations: [{ user_id: SELF }], event: { type: "message", channel: CH, user, text, ts: nowTs(), ...extra } });
const replies = () => calls().filter((x) => x.method === "chat.postMessage");
const reacts = (name) => calls().filter((x) => x.method === "reactions.add" && x.body.name === name);

let pass = 0, fail = 0;
const t = async (name, fn) => { try { if (await fn()) pass++; else { fail++; console.log(`  FAIL ${name}`); } } catch (e) { fail++; console.log(`  FAIL ${name} → ${e.message}`); } };

const server = spawn(process.execPath, [join(root, "node_modules", "vite", "bin", "vite.js"), "preview", "--host", "127.0.0.1", "--port", String(PORT), "--strictPort"], { // vite directly (not npx) so kill() reaches it; explicit host - bare "localhost" is ::1 on GitHub runners
  cwd: root, stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, NODE_OPTIONS: `--import=${join(here, "mock-slack.mjs")}`, PARLAY_MOCK_STATE: STATE, PARLAY_MOCK_LOG: LOG, PARLAY_MOCK_SLATE: join(here, "fixtures", "espn-week7-scoreboard.json"), PARLAY_TEST_SLATE_TTL: "1", SLACK_SIGNING_SECRET: SECRET, SLACK_BOT_TOKEN: "xoxb-e2e", ANTHROPIC_API_KEY: "" },
});
let serverLog = "";
server.stdout.on("data", (d) => { serverLog += d; }); server.stderr.on("data", (d) => { serverLog += d; });
const exited = new Promise((r) => server.on("exit", r));
const stop = async () => { try { server.kill("SIGTERM"); } catch { /* already gone */ } await Promise.race([exited, new Promise((r) => setTimeout(r, 3000))]); };

try {
  for (let i = 0; i < 120; i++) { // wait for the preview server (CI runners can be slow to boot it)
    try { if ((await fetch(`http://127.0.0.1:${PORT}/`)).ok) break; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
    if (i === 119) throw new Error(`preview server never answered\n${serverLog}`);
  }

  await t("handshake: url_verification echoes the challenge", async () => (await post({ type: "url_verification", challenge: "abc123" })).text.includes("abc123"));
  await t("security: bad signature → 401", async () => (await post(msg(LEE, "Bills ML"), { sign: false })).status === 401);
  setState(BASE);
  await t("security: Slack re-delivery is ignored (no second board edit)", async () => (await post(msg(LEE, "Vikings ML"), { retry: true })).status === 200 && calls().length === 0);

  // ── open week ──
  const TIMS = { ts: "1790200000.000100", user: TIM, text: "Jalen Coker over yards" };
  setState([TIMS, ...BASE]);
  await t("open week: a new leg → board edited (5/12), ✅ on it, prop shows n/a, nothing else posted", async () => {
    await post(msg(TIM, TIMS.text, { ts: TIMS.ts }));
    const c = calls(), upd = c.find((x) => x.method === "chat.update");
    return upd && /WEEK 3 BOARD — 5\/12 legs/.test(upd.body.text) && /\*Crab Boilers\* — Jalen Coker over yards \(n\/a\)/.test(upd.body.text) && /\*Risky Business\* — Vikings ML \(-285\)/.test(upd.body.text) && /Est\. parlay at DraftKings: \*-285\* \(1 of 5 legs priced/.test(upd.body.text) && reacts("white_check_mark").some((x) => x.body.timestamp === TIMS.ts) && replies().length === 0;
  });
  await t("open week: no Thursday leg → the board's lock is the earliest game with a leg (Sunday 12:45pm ET-ish), not Thursday night", async () => {
    const upd = calls().find((x) => x.method === "chat.update");
    const m = upd.body.text.match(/locks \*<!date\^(\d+)\^/);
    const lock = Number(m[1]) * 1000, thursdayKickoff = Date.now() + 26 * 3600e3;
    return lock > thursdayKickoff + 24 * 3600e3; // days later, not Thursday's 15-minutes-before
  });
  setState(BASE);
  await t("open week: chatter → nothing posted, nothing reacted", async () => { await post(msg(LEE, "Bryan I don't even have time to do my real work lol")); return !calls().some((x) => x.method === "chat.postMessage" || x.method === "reactions.add"); });
  await t("loop guard: the bot's own board edit (message_changed) → zero Slack calls", async () => {
    await post({ type: "event_callback", authorizations: [{ user_id: SELF }], event: { type: "message", subtype: "message_changed", channel: CH, message: { user: SELF, bot_id: "B1", text: "📋 *WEEK 3 BOARD*" }, previous_message: { text: "old" } } });
    return calls().length === 0;
  });
  await t("open week: '@bot who's missing?' → thread reply, board untouched", async () => {
    await post(msg(LEE, `<@${SELF}> who's missing?`, { ts: "1790200000.000200" }));
    const c = calls(), rep = c.find((x) => x.method === "chat.postMessage");
    return rep && rep.body.thread_ts === "1790200000.000200" && /Still missing/.test(rep.body.text);
  });

  // ── a leg that can't be played: Bills on a bye ──
  const BYE_NOW = { ...BYE_MSG, ts: "1790199000.000100" }; // the Maniacs, "Buffalo to cover against the Chargers"
  setState([BYE_NOW, ...BASE]);
  await t("bye week: the leg is ⚠️'d, explained in its thread (@ the poster), and kept off the board", async () => {
    await post(msg(BYE_NOW.user, BYE_NOW.text, { ts: BYE_NOW.ts }));
    const c = calls(), rep = replies().find((x) => /can't be played/.test(x.body.text)), upd = c.find((x) => x.method === "chat.update");
    return reacts("warning").some((x) => x.body.timestamp === BYE_NOW.ts) && rep && rep.body.thread_ts === BYE_NOW.ts && /The Bills and Chargers are on a bye in Week 7/.test(rep.body.text) && rep.body.text.includes(`<@${BYE_NOW.user}>`) && (!upd || !/Buffalo/.test(upd.body.text)) && !reacts("white_check_mark").some((x) => x.body.timestamp === BYE_NOW.ts);
  });
  setState([{ ...BYE_NOW, reactions: [{ name: "warning", users: [SELF] }] }, ...BASE]);
  await t("bye week: already ⚠️'d → no second warning", async () => { await post(msg(LEE, "lol", {})); return !replies().some((x) => /can't be played/.test(x.body.text)) && !reacts("warning").length; });
  setState([{ ...BYE_NOW, text: "Vikings ML", edited: { ts: nowTs() }, reactions: [{ name: "warning", users: [SELF] }] }, ...BASE]);
  await t("bye week: the poster edits it into a real leg → ⚠️ removed, ✅ added, no new warning", async () => {
    await post({ type: "event_callback", authorizations: [{ user_id: SELF }], event: { type: "message", subtype: "message_changed", channel: CH, message: { ...BYE_NOW, text: "Vikings ML", user: BYE_NOW.user }, previous_message: { text: BYE_NOW.text } } });
    const c = calls();
    return c.some((x) => x.method === "reactions.remove" && x.body.name === "warning" && x.body.timestamp === BYE_NOW.ts) && reacts("white_check_mark").some((x) => x.body.timestamp === BYE_NOW.ts) && !replies().some((x) => /can't be played/.test(x.body.text));
  });
  setState(BASE);
  await t("bye week: '@bot Bills ML' → not logged, explained", async () => {
    await post(msg(LEE, `<@${SELF}> Bills ML`, { ts: "1790200000.000250" }));
    const rep = replies().find((x) => x.body.thread_ts === "1790200000.000250");
    return rep && /can't be played/.test(rep.body.text) && !/Got it/.test(rep.body.text);
  });

  // ── the lock: 15 min before the first game that has a leg ──
  const CYRES_BEARS = { ts: "1790290000.000300", user: CYRES, text: "Bears -3" }; // Thursday night's game; replaces Vikings ML
  const OVERDUE_START = 10 * 60e3; // Thursday's game starts in 10 min → the lock (kickoff - 15m) was 5 min ago
  const TRIGGER = { ts: nowTs(), user: TIM, text: "Jalen Coker over yards" };
  setState([TRIGGER, CYRES_BEARS, ...BASE], { kickoffIn: OVERDUE_START });
  await t("late cron: lock time passed → this event locks the board (SLIP) + lock notice with DraftKings odds and the combined price", async () => {
    await post(msg(TIM, TRIGGER.text, { ts: TRIGGER.ts }));
    const c = calls(), upd = c.find((x) => x.method === "chat.update"), notice = replies().find((x) => /Week 3 legs are locked/.test(x.body.text));
    return upd && /WEEK 3 SLIP — 4\/12 legs/.test(upd.body.text) && /locked \*<!date\^/.test(upd.body.text) && notice && /\*Risky Business\* — Bears -3 \(-108\)/.test(notice.body.text) && /Est\. parlay at DraftKings: \*-108\* \(1 of 4 legs priced/.test(notice.body.text) && notice.body.text.includes(PLACER_MENTION);
  });
  await t("late cron: the trigger post itself arrived after the lock → 🔒 + the placer is asked whether the parlay is set (and it is not on the slip)", async () => {
    const rep = replies().find((x) => x.body.thread_ts === TRIGGER.ts);
    return reacts("lock").some((x) => x.body.timestamp === TRIGGER.ts) && rep && rep.body.text.includes(PLACER_MENTION) && /have you already set the parlay/.test(rep.body.text) && /\*not\* on the slip/.test(rep.body.text) && !/Crab Boilers\* — Jalen/.test(calls().find((x) => x.method === "chat.update")?.body.text || "");
  });

  // ── after the lock ──
  const LATE = { ts: "1792105856.061539", user: LEE, text: "Gimme Bijan TD" };
  setState([LATE, ...LOCKED]);
  await t("locked, before the first game: a late leg → 🔒 + 'placer, have you already set the parlay?' (placer @'d), board untouched", async () => {
    await post(msg(LEE, LATE.text, { ts: LATE.ts }));
    const c = calls(), rep = replies().find((x) => x.body.thread_ts === LATE.ts);
    return reacts("lock").some((x) => x.body.timestamp === LATE.ts) && rep && rep.body.text.includes(PLACER_MENTION) && rep.body.text.includes(`<@${LEE}>`) && /have you already set the parlay\?/.test(rep.body.text) && /Bijan TD/.test(rep.body.text) && !c.some((x) => x.method === "chat.update" || (x.method === "reactions.add" && x.body.name === "white_check_mark"));
  });
  setState([LATE, ...LOCKED], { kickoffIn: -5 * 864e5 });
  await t("locked, games already underway: no ping - just 'can't make the slip'", async () => {
    await post(msg(LEE, LATE.text, { ts: LATE.ts }));
    const rep = replies().find((x) => x.body.thread_ts === LATE.ts);
    return rep && /can't make the slip/.test(rep.body.text) && !/have you already set/.test(rep.body.text) && !rep.body.text.includes(PLACER_MENTION);
  });
  setState(LOCKED);
  await t("locked: a top-level result ('Josh Allen TD hit') → silence", async () => { await post(msg(BRYAN, "Josh Allen TD hit")); return calls().every((x) => !/^chat\.|^reactions\./.test(x.method)); });
  await t("locked: a thread reply under the lock notice → silence", async () => { await post(msg(BRYAN, "Bijan TD", { thread_ts: LOCKED[0].ts })); return calls().every((x) => !/^chat\.|^reactions\./.test(x.method)); });
  await t("locked: '@bot status' → 🔒 locked, placer picks", async () => {
    await post(msg(LEE, `<@${SELF}> status`, { ts: "1792106000.000400" }));
    const rep = replies()[0];
    return rep && /🔒 locked/.test(rep.body.text) && /Placer picks for:/.test(rep.body.text);
  });
  await t("locked: '@bot Bijan TD' → not logged", async () => {
    await post(msg(LEE, `<@${SELF}> Bijan TD`, { ts: "1792106000.000500" }));
    const rep = replies()[0];
    return rep && /locked/.test(rep.body.text) && !/Got it/.test(rep.body.text);
  });
  await t("locked: already locked → no second lock notice", async () => { await post(msg(BRYAN, "lol")); return !replies().some((x) => /legs are locked/.test(x.body.text)) && !calls().some((x) => x.method === "chat.update"); });
} finally {
  await stop();
}
if (fail) console.log(serverLog.split("\n").filter((l) => /parlay events/.test(l)).slice(-14).join("\n"));
console.log(`webhook e2e: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
