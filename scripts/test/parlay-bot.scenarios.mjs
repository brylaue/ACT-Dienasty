// Scenario tests for scripts/parlay-bot.mjs: run the real bot in --dry mode
// against fixture channel states at fixed points in the week and check what
// it would post. Uses live Sleeper for the league/placer/kickoff (network).
// Run: node scripts/test/parlay-bot.scenarios.mjs
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const fx = (name) => join(root, "scripts/test/fixtures", name);
const at = (iso) => String(Date.parse(iso));
let pass = 0, fail = 0;

const tmp = mkdtempSync(join(tmpdir(), "parlay-scn-"));
// Week 3's slate = the saved ESPN week-7 scoreboard moved back 28 days, so the Thursday game kicks off Thu Sep 24 8:15pm ET like the fixtures expect
const slate3 = JSON.parse(readFileSync(fx("espn-week7-scoreboard.json"), "utf8"));
for (const e of slate3.events) e.date = new Date(Date.parse(e.date) - 28 * 864e5).toISOString().replace(/:\d\d\.\d+Z$/, "Z");
slate3.week.number = 3;
const slateFile = join(tmp, "slate3.json"); writeFileSync(slateFile, JSON.stringify(slate3));
const playersFile = join(tmp, "players.json"); // the fixtures' prop players, so nothing hits ESPN search
writeFileSync(playersFile, JSON.stringify({ "garrett wilson": "NYJ", "davante adams": "LAR", "derrick henry": "BAL", "bijan robinson": "ATL" }));
const fixtureWith = (base, extra) => { // the Tuesday channel + extra top-level messages (newest first)
  const f = JSON.parse(readFileSync(fx(base), "utf8")); f.messages = [...extra, ...f.messages];
  const file = join(tmp, `${base}-${extra.length}-${Math.abs(extra[0]?.ts.length || 0)}-${Math.floor(Math.random() * 1e6)}.json`); writeFileSync(file, JSON.stringify(f)); return file;
};
const run = (mode, when, fixture, { slate = false } = {}) => {
  const r = spawnSync("node", [join(root, "scripts/parlay-bot.mjs"), mode, "--dry"], {
    // the fixtures are Week 3 of 2026: pin the week so the suite doesn't drift as the season advances.
    // No-slate runs also pin the kickoff (Thu 8:15pm ET) so the 8:00pm lock fallback never depends on the network.
    env: { ...process.env, PARLAY_TEST_NOW: at(when), PARLAY_TEST_FIXTURE: fixture.includes("/") ? fixture : fx(fixture), PARLAY_TEST_WEEK: "3", PARLAY_TEST_KICKOFF: "2026-09-25T00:15:00Z", PARLAY_TEST_PLAYERS: playersFile, ...(slate ? { PARLAY_TEST_SLATE: slateFile } : {}) }, encoding: "utf8", timeout: 90000,
  });
  return (r.stdout || "") + (r.stderr || "");
};
const check = (name, out, must = [], mustNot = []) => {
  const missing = must.filter((m) => !out.includes(m)), present = mustNot.filter((m) => out.includes(m));
  if (!missing.length && !present.length) pass++;
  else { fail++; console.log(`  FAIL ${name}`); for (const m of missing) console.log(`     expected: ${m}`); for (const m of present) console.log(`     must not: ${m}`); }
};

// Week 3 of 2026: legs lock 15 min before Thursday's 8:15pm ET kickoff = Thu 8:00pm ET. Times are UTC.
let out = run("tick", "2026-09-23T02:40:00Z", "week3-tuesday.json"); // Tue 10:40pm ET, everything already posted
check("Tue: nothing to post, stale pins removed, board current", out, ["pins.remove", "board already current: 5/12"], ["chat.postMessage", "chat.update", "Heads up"]);

out = run("tick", "2026-09-24T00:05:00Z", "week3-tuesday.json"); // Wed 8:05pm ET = 24h before the lock
check("Wed: nag with @mentions for the 7 missing teams", out, ["5/12 legs in", "<@USJRGKTDJ>", "<@US6FUMPRQ>", "<@USK9TCDC5>", "you're placing it"], ["WEEK 3 SLIP"]);

out = run("tick", "2026-09-24T06:42:00Z", "week3-nagged.json"); // Thu 2:42am ET, nag already posted last night
check("after the nag: no repeat nag (the bug that posted 4 nags)", out, ["board already current"], ["legs in*", "Still missing", "chat.postMessage"]);

out = run("tick", "2026-09-25T00:05:00Z", "week3-tuesday.json"); // Thu 8:05pm ET, live board still up
check("Thu 8pm: board → slip; lock notice carries the full slip, @mentions the placer, updates the bookmark", out, ["chat.update", "WEEK 3 SLIP — 5/12 legs", "legs are locked", "<@U0650HX32KV>", "• *Immigrants* — Davante Adams anytime TD", "bookmarks.add", "Week 3 slip"], ["WEEK 3 BOARD"]);
out = run("tick", "2026-09-23T14:00:00Z", "week3-board-reply.json"); // any tick with a live board
check("board header carries the deadline as a Slack date token", out, ["<!date^", "|Thursday 8 PM ET>"]);

out = run("tick", "2026-09-25T00:22:00Z", "week3-locked.json"); // Thu 8:22pm ET, already locked
check("Thu after lock: nothing due (no re-lock)", out, ["nothing due", "slip true"], ["legs are locked", "chat.update"]);

out = run("compile", "2026-09-25T00:05:00Z", "week3-board-reply.json");
check("a leg replied under the pinned BOARD counts", out, ["Crab Boilers* — Browns ML", "1/12"]);

out = run("open", "2026-09-23T14:00:00Z", "week3-tuesday.json");
check("manual open posts an opener naming the placer", out, ["Parlay Builder is OPEN", "On the hook this week"]);

out = run("open", "2026-09-23T14:00:00Z", "season-record.json");
check("opener carries the season parlay record from prior lock threads", out, ["Season parlay record: *1-1*", "last week HIT"]);

out = run("tick", "2026-09-25T00:05:00Z", "week3-tuesday.json");
check("lock notice asks for the hit/miss verdict", out, ["Reply here with *hit* or *miss*"]);

// ── slate-aware: bye weeks, the moving lock, DraftKings odds ──
// Buffalo (the Maniacs' leg in the Tuesday fixture) and the Chargers are on a bye in the slate. Every other fixture leg is a Sunday game.
out = run("tick", "2026-09-23T14:00:00Z", "week3-tuesday.json", { slate: true }); // Wed 10am ET
check("bye: 'Buffalo to cover against the Chargers' is ⚠️'d, not counted, and says why", out, ["can't be played", "The Bills and Chargers are on a bye in Week 3", "WEEK 3 BOARD — 4/12 legs"], ["Buffalo to cover against the Chargers  •"]);
check("no Thursday leg → the lock moves to the next game (Sun 12:45pm ET, 15 min before the 1pm slate)", out, ["Sunday 12:45 PM ET"], ["Thursday 8 PM ET"]);
check("odds: priced game line, props show n/a, one combined price", out, ["Vikings ML (-285)", "Garrett Wilson anytime TD (n/a)", "Est. parlay at DraftKings: *-285* (1 of 4 legs priced"]);

const withThursdayLeg = fixtureWith("week3-tuesday.json", [{ ts: "1790290000.000100", user: "U02SQMEQ4R1", text: "Bears -3" }]); // Risky Business swaps Vikings ML for the Thursday game
out = run("tick", "2026-09-24T23:30:00Z", withThursdayLeg, { slate: true }); // Thu 7:30pm ET
check("a Thursday leg pulls the lock to Thu 8:00pm ET", out, ["Thursday 8 PM ET", "Bears -3 (-108)"], ["Sunday 12:45 PM ET"]);
out = run("tick", "2026-09-25T00:05:00Z", withThursdayLeg, { slate: true }); // Thu 8:05pm ET
check("…and locks there: slip + lock notice with the combined DraftKings price", out, ["WEEK 3 SLIP — 4/12 legs", "legs are locked", "Bears -3 (-108)", "Est. parlay at DraftKings: *-108* (1 of 4 legs priced", "kickoff Thursday 8:15 PM ET"]);
out = run("tick", "2026-09-25T00:05:00Z", "week3-tuesday.json", { slate: true }); // same time, but nobody has the Thursday game
check("no Thursday leg: nothing locks at 8pm (Thursday's game just closes)", out, [], ["legs are locked", "WEEK 3 SLIP"]);
const lateForTnf = fixtureWith("week3-tuesday.json", [{ ts: String(Date.parse("2026-09-25T00:10:00Z") / 1000), user: "U02SQMEQ4R1", text: "Bears ML" }]); // posted 5 min before kickoff
out = run("tick", "2026-09-25T00:12:00Z", lateForTnf, { slate: true });
check("a leg for a game inside its last 15 minutes is rejected", out, ["is within 15 minutes of kickoff", "can't be played"], ["Bears ML ("]);

// ── a week the OLD fixed-6PM rule locked early (the Week 7 incident) ──
// week3-locked.json is such a lock: its slip header has no lock time. With the slate, the legs' real cutoff is Sunday 12:45pm.
out = run("tick", "2026-09-25T00:05:00Z", "week3-locked.json", { slate: true }); // Thu 8:05pm ET
check("early legacy lock + real cutoff ahead → notice withdrawn, week announced as open again", out, ["lock notice withdrawn", "Week 3 is open again", "Sunday 12:45 PM ET", "reopened week 3"], ["WEEK 3 SLIP", "legs are locked"]);
const reopened = JSON.parse(readFileSync(fx("week3-locked.json"), "utf8")); // …and what the channel looks like on the NEXT run
for (const m of reopened.messages) if (/legs are locked/.test(m.text)) m.text = "🔓 _Week 3 lock notice withdrawn - it went out early. Legs now lock Sunday 12:45 PM ET._";
const reopenedFile = join(tmp, "week3-reopened.json"); writeFileSync(reopenedFile, JSON.stringify(reopened));
out = run("tick", "2026-09-25T00:20:00Z", reopenedFile, { slate: true });
check("next tick: the pinned board is back to the live BOARD with the new lock time, no second announcement", out, ["chat.update", "WEEK 3 BOARD", "Sunday 12:45 PM ET"], ["WEEK 3 SLIP", "is open again", "legs are locked"]);
out = run("tick", "2026-09-27T16:46:00Z", reopenedFile, { slate: true }); // Sun 12:46pm ET - the real lock
check("…and it locks at the real cutoff, with a proper lock notice", out, ["WEEK 3 SLIP", "legs are locked"], ["is open again"]);
out = run("tick", "2026-09-25T00:22:00Z", "week3-locked.json"); // no slate: lock time is the Thursday fallback - already passed
check("a lock that really was due (cutoff already passed) is NOT reopened", out, ["nothing due"], ["open again", "withdrawn"]);

console.log(`parlay-bot scenarios: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
