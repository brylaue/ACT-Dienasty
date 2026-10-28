// Unit tests for src/lib/server/parlayGrade.js (grading the slip) and
// src/lib/server/parlayProps.js (reading + pricing player props).
// Real data: ESPN's Week 7 2026 scoreboard and box scores (fixtures/grade-w7).
// Run: node scripts/test/parlay-grade.test.mjs
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as G from "../../src/lib/server/parlayGrade.js";
import * as P from "../../src/lib/server/parlayProps.js";
import { parseSlate } from "../../src/lib/server/parlaySlate.js";
import { seasonRecord, fmtAmerican } from "../../src/lib/server/parlayCore.js";

const here = dirname(fileURLToPath(import.meta.url));
const fx = (n) => JSON.parse(readFileSync(join(here, "fixtures/grade-w7", n), "utf8"));
let pass = 0, fail = 0;
const t = async (name, fn) => { try { if (await fn()) pass++; else { fail++; console.log(`  FAIL ${name}`); } } catch (e) { fail++; console.log(`  FAIL ${name} → ${e.message}`); } };

const slate = parseSlate(fx("scoreboard-w7.json"));
const boxes = Object.fromEntries(["401873012", "401873020", "401873021", "401873014"].map((id) => [id, G.parseBox(fx(`summary-${id}.json`))]));
const playerTeams = fx("players.json");
const notice = fx("channel.json").messages[0];
const g = (leg, extra = {}) => G.gradeLeg(leg, slate, { boxes, playerTeams, ...extra });

// ── reading the slip ──
const slip = G.parseSlipNotice(notice.text);
await t("slip: week, six legs, odds tags stripped", () => slip.week === 7 && slip.legs.length === 6 && slip.legs[4].leg === "Vikings ML #SKOL" && slip.legs[0].leg === "Derrick Henry 2+ touchdowns");
await t("slip: placer's picks listed", () => slip.placerPicks.length === 6 && slip.placerPicks.includes("C-Men"));
await t("slip: not a lock notice → null", () => G.parseSlipNotice("hello") === null);

// ── box scores ──
await t("box: Goff 2 passing TDs, final", () => boxes["401873020"].final && boxes["401873020"].players["jared goff"].passTd === 2);
await t("box: Gibbs 0 TDs on 29 carries", () => boxes["401873020"].players["jahmyr gibbs"].rushTd === 0 && boxes["401873020"].players["jahmyr gibbs"].rushYds === 116);

// ── real Week 7 legs ──
await t("Henry 2+ TDs → miss (0)", () => g("Derrick Henry 2+ touchdowns").status === "miss");
await t("Gibbs (surname only) anytime TD → miss", () => g("Gibbs anytime TD").status === "miss");
await t("Kyren Williams anytime td → hit", () => g("Kyren Williams anytime td").status === "hit");
await t("Goff, two passing touchdowns → hit", () => { const r = g("Jared Goff, two passing touchdowns"); return r.status === "hit" && r.note === "2 passing TDs"; });
await t("Vikings ML → hit, with the score", () => { const r = g("Vikings ML #SKOL"); return r.status === "hit" && /IND 10-16 MIN, final/.test(r.note); });
await t("Jefferson anytime TD → miss", () => g("Justin Jefferson anytime TD").status === "miss");
await t("Jameson Williams 2+ TDs → hit (receiving TDs count)", () => g("Jameson Williams 2+ TDs", { playerTeams: { ...playerTeams, "jameson williams": "DET" } }).status === "hit");
await t("Goff anytime TD → miss (passing TDs don't count)", () => g("Jared Goff anytime TD").status === "miss");
await t("St. Brown 100+ receiving yards → hit (153)", () => g("Amon-Ra St. Brown 100+ receiving yards", { playerTeams: { "amon-ra st. brown": "DET" } }).status === "hit");
await t("St. Brown over 9.5 receptions → miss (9)", () => g("Amon-Ra St. Brown over 9.5 receptions", { playerTeams: { "amon-ra st. brown": "DET" } }).status === "miss");

// ── team legs ──
await t("spread: Lions -2.5 vs GB (won by 3) → hit", () => g("Lions -2.5").status === "hit");
await t("spread: Lions -3 → push", () => g("Lions -3").status === "push");
await t("spread: Packers +2.5 → miss", () => g("Packers +2.5").status === "miss");
await t("total: GB/DET over 36.5 (37) → hit", () => g("Packers Lions over 36.5").status === "hit");
await t("total: GB/DET under 36.5 → miss", () => g("Packers Lions under 36.5").status === "miss");
await t("ML loser: Ravens ML → miss", () => g("Ravens ML").status === "miss");
await t("Monday night (not started): Eagles ML → pending", () => g("Eagles ML").status === "pending");
await t("first TD: Jameson Williams scored the game's first TD → hit", () => { const r = g("Jameson Williams first TD", { playerTeams: { ...playerTeams, "jameson williams": "DET" } }); return r.status === "hit" && /first TD: Jameson Williams/.test(r.note); });
await t("first TD: Gibbs 1st touchdown → miss, says who did", () => { const r = g("Gibbs 1st touchdown"); return r.status === "miss" && /Jameson Williams/.test(r.note); });
await t("first TD: misspelt 'frist td' still reads as first TD", () => g("Gibbs frist td").status === "miss");
await t("typos: 'a time td' is an anytime TD (Week 8: Justin Jefferson a time td)", () => g("Justin Jefferson a time td").status === "miss" && P.parseProp("Justin Jefferson a time td", "Justin Jefferson").stat === "tds");
await t("typos: 'Anytine Touchdwon' / 'anytim tds' / 'any time td'", () => ["Kyren Williams Anytine Touchdwon", "Kyren Williams anytim td", "Kyren Williams any time td"].every((l) => g(l).status === "hit"));
await t("typos: 'recieving yrds'", () => P.parseProp("Puka recieving yrds over 70.5", "Puka").stat === "rec_yds");
await t("lowercase names: 'gibbs anytime td'", () => g("gibbs anytime td").status === "miss");
await t("leg we can't place → manual", () => g("something weird").status === "manual");

// ── in-progress games: a prop can cash early, a game line can't ──
{
  const live = { ...slate, games: slate.games.map((x) => ({ ...x })) }; const gm = live.games.find((x) => x.id === "401873020"); gm.final = false; gm.state = "in";
  const liveBox = { ...boxes["401873020"], final: false };
  const lg = (leg) => G.gradeLeg(leg, live, { boxes: { ...boxes, "401873020": liveBox }, playerTeams });
  await t("live: Goff already has 2 passing TDs → hit early", () => lg("Jared Goff, two passing touchdowns").status === "hit");
  await t("live: Gibbs no TD yet → pending, not miss", () => { const r = lg("Gibbs anytime TD"); return r.status === "pending" && /so far/.test(r.note); });
  await t("live: Lions ML → pending until final", () => lg("Lions ML").status === "pending");
  await t("live: over already cleared → hit early", () => lg("Packers Lions over 30.5").status === "hit");
}

// ── the whole slip ──
const res = G.gradeSlip(slip, slate, { boxes, playerTeams });
await t("slip verdict: MISS; the 1 PM misses (Henry, Jefferson) broke it, the 4:25 Gibbs miss didn't", () => res.verdict === "miss" && res.counts.hit === 3 && res.counts.miss === 3 && res.breakers.map((l) => l.team).join() === "Title Chase,Dirty Birds" && res.alsoMissed.map((l) => l.team).join() === "Immigrants");
const txt = G.renderResults(res);
await t("results post: header + one row per leg", () => G.isResultsPost(txt, 7) && txt.split("\n").length >= 7 && /❌ \*Immigrants\* — Gibbs anytime TD _\(0 TDs\)_/.test(txt));
await t("results post: Slack's :shortcode: spelling still matches", () => G.isResultsPost(txt.replace("📊", ":bar_chart:"), 7) && !G.isResultsPost(txt, 8));
await t("sameText: emoji spelling and &amp; don't count as a change", () => G.sameText(txt, txt.replace("📊", ":bar_chart:").replace(/✅/g, ":white_check_mark:").replace(/❌/g, ":x:")) && !G.sameText(txt, txt.replace("0 TDs", "1 TD")));
const v = G.renderVerdict(res);
await t("verdict post: names who broke it, together, and when", () => G.isVerdictPost(v, 7) && /💥 Broken by \*Title Chase\* \(Derrick Henry 2\+ touchdowns: 0 TDs\) and \*Dirty Birds\* \(Justin Jefferson anytime TD: 0 TDs\) - they went down together in the Sunday 1 PM ET games/.test(v) && /Also missed: Immigrants \(Gibbs anytime TD\)/.test(v));
await t("results post: 💥 rows say 'broke the parlay'; plain ❌ for later misses", () => /💥 \*Title Chase\* — .*broke the parlay\*/.test(txt) && /❌ \*Immigrants\*/.test(txt) && !/Immigrants.*broke/.test(txt) && /3 ❌ \(💥 Title Chase & Dirty Birds\)/.test(txt));
await t("breakers read back from a results post (either emoji spelling)", () => G.breakersFromResults(txt.replace(/💥/g, ":boom:")).join() === "Title Chase,Dirty Birds");
{
  // the first post named only Jefferson (the Henry game was still going); later the Henry miss lands - Jefferson keeps the blame alone
  const r2 = G.gradeSlip(slip, slate, { boxes, playerTeams, breakers: ["Dirty Birds"] });
  await t("a named breaker sticks; later misses go to 'also missed'", () => r2.breakers.map((l) => l.team).join() === "Dirty Birds" && /💥 Broken by \*Dirty Birds\* \(Justin Jefferson anytime TD: 0 TDs\) - the first leg to go down\./.test(G.renderVerdict(r2)) && r2.alsoMissed.length === 2);
  const s3 = { ...slip, legs: slip.legs.filter((l) => l.team !== "Title Chase" && l.team !== "Dirty Birds") };
  const r3 = G.gradeSlip(s3, slate, { boxes, playerTeams });
  await t("a lone miss → 'the first leg to go down'", () => r3.breakers.length === 1 && /Broken by \*Immigrants\*.* - the first leg to go down\./.test(G.renderVerdict(r3)) && !/Also missed/.test(G.renderVerdict(r3)));
}
await t("verdict: not HIT while the placer still has picks to make", () => { const s2 = { ...slip, legs: slip.legs.filter((l) => ["Crab Boilers", "The 5th Rounders", "Risky Business"].includes(l.team)) }; const r = G.gradeSlip(s2, slate, { boxes, playerTeams }); return r.verdict === null && /Placer's picks/.test(G.renderResults(r)); });
await t("verdict: HIT when every leg cashed and nobody was missing", () => { const s2 = { week: 7, placerPicks: [], legs: slip.legs.filter((l) => ["Crab Boilers", "The 5th Rounders", "Risky Business"].includes(l.team)) }; const r = G.gradeSlip(s2, slate, { boxes, playerTeams }); return r.verdict === "hit" && /HIT/.test(G.renderVerdict(r)); });

// ── the season record counts the bot's call; a manager's later reply overrides it ──
{
  const lock = { ts: "100.000001", bot_id: "B", text: "🔒 *Week 7 legs are locked* — 6/12 in." };
  const botCall = { ts: "200.000001", bot_id: "B", text: ":checkered_flag: *Week 7 parlay: MISS* — busted by *X*" };
  const human = { ts: "300.000001", user: "U1", text: "hit actually, they voided it" };
  const teamOfUser = (u) => (u === "U1" ? "Team" : null);
  await t("record: the bot's 🏁 MISS counts", () => seasonRecord({ messages: [lock], teamOfUser, repliesByTs: { [lock.ts]: [botCall] } }).losses === 1);
  await t("record: a manager's later hit/miss overrides the bot", () => seasonRecord({ messages: [lock], teamOfUser, repliesByTs: { [lock.ts]: [botCall, human] } }).wins === 1);
}

// ── props: what the leg asks for ──
const pp = (leg, name) => P.parseProp(leg, name);
await t("prop: anytime TD → tds ≥1", () => { const p = pp("Kyren Williams anytime td", "Kyren Williams"); return p.stat === "tds" && p.threshold === 1; });
await t("prop: 2+ touchdowns → tds ≥2, point 1.5", () => { const p = pp("Derrick Henry 2+ touchdowns", "Derrick Henry"); return p.stat === "tds" && p.threshold === 2 && p.point === 1.5; });
await t("prop: 'two passing touchdowns' → pass_tds ≥2", () => { const p = pp("Jared Goff, two passing touchdowns", "Jared Goff"); return p.stat === "pass_tds" && p.threshold === 2; });
await t("prop: over 74.5 rec yds → rec_yds ≥75", () => { const p = pp("Puka Nacua over 74.5 rec yds", "Puka Nacua"); return p.stat === "rec_yds" && p.threshold === 75 && p.point === 74.5; });
await t("prop: under 249.5 passing yards → under", () => { const p = pp("Josh Allen under 249.5 passing yards", "Josh Allen"); return p.stat === "pass_yds" && p.dir === "under" && p.point === 249.5; });
await t("prop: 6+ catches → receptions", () => pp("Puka 6+ catches", "Puka").stat === "receptions");
await t("prop: 'Josh Allen TD' → anytime TD", () => pp("Josh Allen TD", "Josh Allen").stat === "tds");
await t("prop: first TD → first_td", () => pp("Gibbs first TD scorer", "Gibbs").stat === "first_td");
await t("prop: nothing prop-like → null", () => pp("Gibbs is cooking", "Gibbs") === null);
await t("markets: anytime vs 2+ vs passing", () => P.marketsFor(pp("X anytime td", "X"))[0] === "player_anytime_td" && P.marketsFor(pp("X 2+ tds", "X"))[0] === "player_tds_over" && P.marketsFor(pp("X 2 passing tds", "X")).includes("player_pass_tds_alternate"));
await t("fmt: no line", () => fmtAmerican("noline") === "no line" && fmtAmerican(null) === "n/a");

// ── props: pricing from The Odds API ──
const eventOdds = { id: "ev1", bookmakers: [
  { key: "fanduel", markets: [{ key: "player_anytime_td", outcomes: [{ name: "Yes", description: "Jahmyr Gibbs", price: -150 }] }] },
  { key: "draftkings", markets: [
    { key: "player_anytime_td", outcomes: [{ name: "Yes", description: "Jahmyr Gibbs", price: -160 }, { name: "Yes", description: "Jameson Williams", price: 150 }] },
    { key: "player_tds_over", outcomes: [{ name: "Over", description: "Jahmyr Gibbs", point: 1.5, price: 290 }] },
    { key: "player_pass_tds", outcomes: [{ name: "Over", description: "Jared Goff", point: 1.5, price: -140 }, { name: "Under", description: "Jared Goff", point: 1.5, price: 110 }] },
  ] },
] };
await t("price: DraftKings preferred over FanDuel", () => P.findPropPrice(eventOdds, "Jahmyr Gibbs", pp("Gibbs anytime td", "Gibbs"))?.american === -160);
await t("price: surname-only leg matches a unique player", () => P.findPropPrice(eventOdds, "Gibbs", pp("Gibbs anytime td", "Gibbs"))?.american === -160);
await t("price: 2+ TDs uses the over 1.5 line", () => P.findPropPrice(eventOdds, "Jahmyr Gibbs", pp("Gibbs 2+ tds", "Gibbs"))?.american === 290);
await t("price: passing TDs over 1.5", () => P.findPropPrice(eventOdds, "Jared Goff", pp("Goff two passing tds", "Goff"))?.american === -140);
await t("price: a line that isn't offered → null", () => P.findPropPrice(eventOdds, "Jared Goff", pp("Goff 4 passing tds", "Goff")) === null);

{
  // slate with a game still to come, so props are priceable: shift DAL @ PHI (Monday night) and use it
  const s = JSON.parse(JSON.stringify(slate)); s.byes = new Set(); const mnf = s.games.find((x) => x.home.abbr === "PHI");
  const now = mnf.kickoffMs - 6 * 3600e3;
  const pt = { "jalen hurts": "PHI", "ceedee lamb": "DAL" };
  const calls = [];
  const fakeFetch = async (url) => {
    calls.push(url);
    const events = [{ id: "mnf1", home_team: mnf.home.display, away_team: mnf.away.display, commence_time: new Date(mnf.kickoffMs).toISOString() }];
    const odds = { id: "mnf1", bookmakers: [{ key: "draftkings", markets: [{ key: "player_anytime_td", outcomes: [{ name: "Yes", description: "Jalen Hurts", price: 120 }] }] }] };
    return { ok: true, headers: { get: (h) => (h === "x-requests-remaining" ? "470" : null) }, json: async () => (/\/events\/mnf1\/odds/.test(url) ? odds : events) };
  };
  const legs = { A: { leg: "Jalen Hurts anytime TD", odds: null }, B: { leg: "CeeDee Lamb anytime TD", odds: null }, C: { leg: "Eagles ML", odds: -180 } };
  const out = await P.pricePropLegs(legs, { slate: s, playerTeams: pt, apiKey: "k", nowMs: now, fetchFn: fakeFetch });
  await t("pricePropLegs: priced prop, 'no line' for one the book lacks, game line untouched", () => out.A.odds === 120 && out.B.odds === "noline" && out.C.odds === -180);
  await t("pricePropLegs: one events call + one odds call for the game (2 calls)", () => calls.length === 2 && calls.filter((u) => /\/odds\?/.test(u)).length === 1);
  calls.length = 0;
  const prior = P.pricesFromBoard("📋 *WEEK 7 BOARD*\n• *A* — Jalen Hurts anytime TD (+120)\n• *B* — CeeDee Lamb anytime TD (no line)\n• *C* — Eagles ML (-180)");
  const again = await P.pricePropLegs(legs, { slate: s, playerTeams: pt, prior, apiKey: "k", nowMs: now, fetchFn: fakeFetch });
  await t("pricePropLegs: prices carried from the board - zero API calls on a refresh", () => again.A.odds === 120 && again.B.odds === "noline" && calls.length === 0);
  const retried = await P.pricePropLegs(legs, { slate: s, playerTeams: pt, prior, apiKey: "k", retry: true, nowMs: now, fetchFn: fakeFetch });
  await t("pricePropLegs: retry re-asks only the 'no line' prop", () => retried.A.odds === 120 && calls.some((u) => /\/odds\?/.test(u)));
  calls.length = 0;
  const changed = await P.pricePropLegs({ ...legs, A: { leg: "Jalen Hurts 2+ TDs", odds: null } }, { slate: s, playerTeams: pt, prior, apiKey: "k", nowMs: now, fetchFn: fakeFetch });
  await t("pricePropLegs: a changed leg is priced fresh", () => changed.A.odds === "noline" && calls.length >= 1);
  const nokey = await P.pricePropLegs(legs, { slate: s, playerTeams: pt, nowMs: now, fetchFn: async () => { throw new Error("should not call"); } });
  await t("pricePropLegs: no API key → props stay n/a, no calls", () => nokey.A.odds === null);
  const after = await P.pricePropLegs(legs, { slate: s, playerTeams: pt, apiKey: "k", nowMs: mnf.kickoffMs + 60e3, fetchFn: async () => { throw new Error("should not call"); } });
  await t("pricePropLegs: after kickoff, no calls", () => after.A.odds === null);
}

// ── how the board shows a prop's reading, and the parsers that read the board back ──
{
  const { priceLegs, resolvePlayerTeam } = await import("../../src/lib/server/parlaySlate.js");
  const { renderBoard } = await import("../../src/lib/server/parlayCore.js");
  const legs = priceLegs({ "Dirty Birds": { leg: "Justin Jefferson a time td" }, "Title Chase": { leg: "Mathew golden 1st touchdown" }, Immigrants: { leg: "Vikings ML" } }, slate, { "justin jefferson": "MIN", "mathew golden": "GB" });
  await t("board: props say how they were read", () => legs["Dirty Birds"].readAs === "anytime TD · MIN" && legs["Title Chase"].readAs === "first TD of the game · GB" && !legs.Immigrants.readAs);
  const b = renderBoard({ legs, allTeams: ["Dirty Birds", "Title Chase", "Immigrants"], week: 8, placerName: "X", deadlineLabel: "Thursday 8 PM ET", locked: false });
  await t("board row: '(odds) _→ anytime TD · MIN_'", () => /• \*Dirty Birds\* — Justin Jefferson a time td \(n\/a\) _→ anytime TD · MIN_/.test(b));
  await t("pricesFromBoard reads rows with the note", () => P.pricesFromBoard(b)["Dirty Birds"]?.leg === "Justin Jefferson a time td" && P.pricesFromBoard(b).Immigrants?.tag === "-108" || P.pricesFromBoard(b).Immigrants?.leg === "Vikings ML");
  const lock = "🔒 *Week 8 legs are locked* — 2/12 in.\n• *Dirty Birds* — Justin Jefferson a time td (+150) _→ anytime TD · MIN_\n• *Immigrants* — Vikings ML (-325)";
  await t("parseSlipNotice strips the note and the odds", () => { const sl = G.parseSlipNotice(lock); return sl.legs[0].leg === "Justin Jefferson a time td" && sl.legs[1].leg === "Vikings ML"; });
  // misspelt full name: ESPN finds nothing for "Mathew golden", but the surname search has Matthew Golden
  const fake = async (url) => { const q = decodeURIComponent(url.match(/query=([^&]+)/)[1]).toLowerCase(); const items = q === "golden" ? [{ displayName: "Matthew Golden", league: "nfl", teamRelationships: [{ core: { abbreviation: "GB" } }] }, { displayName: "Golden Tate", league: "nfl", teamRelationships: [{ core: { abbreviation: "TEN" } }] }] : []; return { ok: true, json: async () => ({ items }) }; };
  await t("misspelt name: 'Mathew golden' → Matthew Golden (GB)", async () => (await resolvePlayerTeam("Mathew golden", fake)) === "GB");
  await t("misspelt name: nothing close → null (no guessing)", async () => (await resolvePlayerTeam("Zzyzx Golden", fake)) === null);
}

console.log(`parlay-grade: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
