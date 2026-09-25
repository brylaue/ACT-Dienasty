// Scenario tests for scripts/parlay-bot.mjs: run the real bot in --dry mode
// against fixture channel states at fixed points in the week and check what
// it would post. Uses live Sleeper for the league/placer/kickoff (network).
// Run: node scripts/test/parlay-bot.scenarios.mjs
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const fx = (name) => join(root, "scripts/test/fixtures", name);
const at = (iso) => String(Date.parse(iso));
let pass = 0, fail = 0;

const run = (mode, when, fixture) => {
  const r = spawnSync("node", [join(root, "scripts/parlay-bot.mjs"), mode, "--dry"], {
    env: { ...process.env, PARLAY_TEST_NOW: at(when), PARLAY_TEST_FIXTURE: fx(fixture) }, encoding: "utf8", timeout: 90000,
  });
  return (r.stdout || "") + (r.stderr || "");
};
const check = (name, out, must = [], mustNot = []) => {
  const missing = must.filter((m) => !out.includes(m)), present = mustNot.filter((m) => out.includes(m));
  if (!missing.length && !present.length) pass++;
  else { fail++; console.log(`  FAIL ${name}`); for (const m of missing) console.log(`     expected: ${m}`); for (const m of present) console.log(`     must not: ${m}`); }
};

// Week 3 of 2026: deadline Thu 6pm ET (kickoff 8:15pm). Times are UTC.
let out = run("tick", "2026-09-23T02:40:00Z", "week3-tuesday.json"); // Tue 10:40pm ET, everything already posted
check("Tue: nothing to post, stale pins removed, board current", out, ["pins.remove", "board already current: 5/12"], ["chat.postMessage", "chat.update", "Heads up"]);

out = run("tick", "2026-09-23T22:05:00Z", "week3-tuesday.json"); // Wed 6:05pm ET = 24h before deadline
check("Wed: nag with @mentions for the 7 missing teams", out, ["5/12 legs in", "<@USJRGKTDJ>", "<@US6FUMPRQ>", "<@USK9TCDC5>", "you're placing it"], ["WEEK 3 SLIP"]);

out = run("tick", "2026-09-24T06:42:00Z", "week3-nagged.json"); // Thu 2:42am ET, nag already posted last night
check("after the nag: no repeat nag (the bug that posted 4 nags)", out, ["board already current"], ["legs in*", "Still missing", "chat.postMessage"]);

out = run("tick", "2026-09-24T22:05:00Z", "week3-tuesday.json"); // Thu 6:05pm ET, live board still up
check("Thu 6pm: board edited into the slip + lock notice", out, ["chat.update", "WEEK 3 SLIP — 5/12 legs", "legs are locked", "Dirty Birds"], ["WEEK 3 BOARD"]);

out = run("tick", "2026-09-24T22:22:00Z", "week3-locked.json"); // Thu 6:22pm ET, already locked
check("Thu after lock: nothing due (no re-lock)", out, ["nothing due", "slip true"], ["legs are locked", "chat.update"]);

out = run("compile", "2026-09-24T22:05:00Z", "week3-board-reply.json");
check("a leg replied under the pinned BOARD counts", out, ["Crab Boilers* — Browns ML", "1/12"]);

out = run("open", "2026-09-23T14:00:00Z", "week3-tuesday.json");
check("manual open posts an opener naming the placer", out, ["Parlay Builder is OPEN", "On the hook this week"]);

out = run("open", "2026-09-23T14:00:00Z", "season-record.json");
check("opener carries the season parlay record from prior lock threads", out, ["Season parlay record: *1-1*", "last week HIT"]);

out = run("tick", "2026-09-24T22:05:00Z", "week3-tuesday.json");
check("lock notice asks for the hit/miss verdict", out, ["reply here with *hit* or *miss*"]);

console.log(`parlay-bot scenarios: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
