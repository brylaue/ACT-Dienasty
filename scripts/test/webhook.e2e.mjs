// End-to-end test of the Slack Events webhook (src/routes/api/parlay/events)
// against the BUILT site: starts `vite preview` with slack.com mocked
// (mock-slack.mjs), posts signed Slack events, and checks what the bot
// would have done - board edits, ✅/🔒 reactions, thread replies, the
// late-cron lock. Needs `npm run build` first (CI does); skipped otherwise.
// Run: node scripts/test/webhook.e2e.mjs
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { createHmac } from "node:crypto";
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
const LEE = "US0P6RDSR", BRYAN = "UTB8NMCLQ", TIM = "USJRGKTDJ"; // The Maniacs, Immigrants, Crab Boilers
const dir = mkdtempSync(join(tmpdir(), "parlay-e2e-"));
const STATE = join(dir, "state.json"), LOG = join(dir, "slack.jsonl");
writeFileSync(STATE, "{}"); writeFileSync(LOG, "");

const fixture = (name) => JSON.parse(readFileSync(join(here, "fixtures", `${name}.json`), "utf8"));
const setState = (messages, replies = []) => { writeFileSync(STATE, JSON.stringify({ messages, replies })); writeFileSync(LOG, ""); };
const calls = () => readFileSync(LOG, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));

// the live week-3 board, re-dated so its deadline is tomorrow (open) or last month (cron missed the lock)
const tuesday = fixture("week3-tuesday");
const withDeadline = (epochSec) => tuesday.messages.map((m) => (/WEEK 3 BOARD/.test(m.text || "") ? { ...m, text: m.text.replace(/<!date\^\d+\^/, `<!date^${epochSec}^`) } : m));
const OPEN = withDeadline(Math.floor(Date.now() / 1000) + 86400);
const OVERDUE = withDeadline(Math.floor(Date.now() / 1000) - 3600);
const LOCKED = fixture("week3-locked").messages;

const post = async (body, { sign = true, retry = false } = {}) => {
  writeFileSync(LOG, ""); // each post is judged on its own Slack calls
  const raw = JSON.stringify(body), ts = String(Math.floor(Date.now() / 1000));
  const sig = "v0=" + createHmac("sha256", sign ? SECRET : "wrong").update(`v0:${ts}:${raw}`).digest("hex");
  const r = await fetch(`http://127.0.0.1:${PORT}/api/parlay/events`, { method: "POST", headers: { "content-type": "application/json", "x-slack-request-timestamp": ts, "x-slack-signature": sig, ...(retry ? { "x-slack-retry-num": "1" } : {}) }, body: raw });
  return { status: r.status, text: await r.text() };
};
const msg = (user, text, extra = {}) => ({ type: "event_callback", authorizations: [{ user_id: SELF }], event: { type: "message", channel: CH, user, text, ts: `${Date.now() / 1000}`, ...extra } });

let pass = 0, fail = 0;
const t = async (name, fn) => { try { if (await fn()) pass++; else { fail++; console.log(`  FAIL ${name}`); } } catch (e) { fail++; console.log(`  FAIL ${name} → ${e.message}`); } };

const server = spawn(process.execPath, [join(root, "node_modules", "vite", "bin", "vite.js"), "preview", "--host", "127.0.0.1", "--port", String(PORT), "--strictPort"], { // vite directly (not npx) so kill() reaches it; explicit host - bare "localhost" is ::1 on GitHub runners
  cwd: root, stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, NODE_OPTIONS: `--import=${join(here, "mock-slack.mjs")}`, PARLAY_MOCK_STATE: STATE, PARLAY_MOCK_LOG: LOG, SLACK_SIGNING_SECRET: SECRET, SLACK_BOT_TOKEN: "xoxb-e2e", ANTHROPIC_API_KEY: "" },
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
  setState(OPEN);
  await t("security: Slack re-delivery is ignored (no second board edit)", async () => (await post(msg(LEE, "Bills ML"), { retry: true })).status === 200 && calls().length === 0);

  // open week: a new leg lands on the board and gets its ✅
  setState([{ ts: "1790200000.000100", user: TIM, text: "Jalen Coker over yards" }, ...OPEN]);
  await t("open week: new leg → board edited (6/12) + ✅ on the message, no late reply", async () => {
    await post(msg(TIM, "Jalen Coker over yards", { ts: "1790200000.000100" }));
    const c = calls(), upd = c.find((x) => x.method === "chat.update"), check = c.find((x) => x.method === "reactions.add" && x.body.name === "white_check_mark" && x.body.timestamp === "1790200000.000100");
    return upd && /WEEK 3 BOARD — 6\/12 legs/.test(upd.body.text) && /\*Crab Boilers\* — Jalen Coker over yards/.test(upd.body.text) && check && !c.some((x) => x.method === "chat.postMessage");
  });
  setState(OPEN);
  await t("open week: chatter → board untouched", async () => { await post(msg(LEE, "Bryan I don't even have time to do my real work lol")); return !calls().some((x) => x.method === "chat.update" || x.method === "chat.postMessage"); });
  await t("loop guard: the bot's own board edit (message_changed) → zero Slack calls", async () => {
    await post({ type: "event_callback", authorizations: [{ user_id: SELF }], event: { type: "message", subtype: "message_changed", channel: CH, message: { user: SELF, bot_id: "B1", text: "📋 *WEEK 3 BOARD*" }, previous_message: { text: "old" } } });
    return calls().length === 0;
  });
  await t("open week: '@bot who's missing?' → thread reply with mentions, board untouched", async () => {
    await post(msg(LEE, `<@${SELF}> who's missing?`, { ts: "1790200000.000200" }));
    const c = calls(), rep = c.find((x) => x.method === "chat.postMessage");
    return rep && rep.body.thread_ts === "1790200000.000200" && /Still missing/.test(rep.body.text) && !c.some((x) => x.method === "chat.update");
  });

  // the cron missed the 6pm lock: the next post locks the week, and that post counts
  setState([{ ts: "1790290000.000300", user: TIM, text: "Jalen Coker over yards" }, ...OVERDUE]);
  await t("late cron: deadline passed → this event locks the board (SLIP) + lock notice, trigger leg included, no 'too late'", async () => {
    await post(msg(TIM, "Jalen Coker over yards", { ts: "1790290000.000300" }));
    const c = calls(), upd = c.find((x) => x.method === "chat.update"), posts = c.filter((x) => x.method === "chat.postMessage");
    return upd && /WEEK 3 SLIP — 6\/12 legs/.test(upd.body.text) && posts.length === 1 && /Week 3 legs are locked/.test(posts[0].body.text) && /Jalen Coker over yards/.test(posts[0].body.text) && !c.some((x) => x.body?.name === "lock");
  });

  // after the lock: Lee's Thursday-night leg (the real gap, Oct 15)
  setState([{ ts: "1792105856.061539", user: LEE, text: "Gimme Bijan TD" }, ...LOCKED]);
  await t("locked: late leg → 🔒 reaction + 'Too late' thread reply, board untouched", async () => {
    await post(msg(LEE, "Gimme Bijan TD", { ts: "1792105856.061539" }));
    const c = calls(), lock = c.find((x) => x.method === "reactions.add" && x.body.name === "lock" && x.body.timestamp === "1792105856.061539"), rep = c.find((x) => x.method === "chat.postMessage");
    return lock && rep && rep.body.thread_ts === "1792105856.061539" && /Too late/.test(rep.body.text) && /\*Dirty Birds\* picks for \*The Maniacs\*/.test(rep.body.text) && /"Bijan TD"/.test(rep.body.text) && !c.some((x) => x.method === "chat.update" || (x.method === "reactions.add" && x.body.name === "white_check_mark"));
  });
  setState(LOCKED);
  await t("locked: a top-level result ('Josh Allen TD hit') → silence", async () => { await post(msg(BRYAN, "Josh Allen TD hit")); return calls().every((x) => !/^chat\.|^reactions\./.test(x.method)); });
  await t("locked: a thread reply under the lock notice → silence", async () => { await post(msg(BRYAN, "Bijan TD", { thread_ts: LOCKED[0].ts })); return calls().every((x) => !/^chat\.|^reactions\./.test(x.method)); });
  await t("locked: '@bot status' → 🔒 locked, placer picks", async () => {
    await post(msg(LEE, `<@${SELF}> status`, { ts: "1792106000.000400" }));
    const rep = calls().find((x) => x.method === "chat.postMessage");
    return rep && /🔒 locked/.test(rep.body.text) && /Placer picks for:/.test(rep.body.text);
  });
  await t("locked: '@bot Bijan TD' → too late, not 'Got it'", async () => {
    await post(msg(LEE, `<@${SELF}> Bijan TD`, { ts: "1792106000.000500" }));
    const rep = calls().find((x) => x.method === "chat.postMessage");
    return rep && /Too late/.test(rep.body.text) && !/Got it/.test(rep.body.text);
  });
  await t("locked: already locked → no second lock notice", async () => { await post(msg(BRYAN, "lol")); return !calls().some((x) => x.method === "chat.postMessage" || x.method === "chat.update"); });
} finally {
  await stop();
}
if (fail) console.log(serverLog.split("\n").filter((l) => /parlay events/.test(l)).slice(-12).join("\n"));
console.log(`webhook e2e: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
