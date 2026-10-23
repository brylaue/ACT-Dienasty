// Unit tests for src/lib/server/parlaySlate.js against a saved ESPN scoreboard
// (NFL week 7, 2026; BUF/LAC/WSH/JAX on bye; Thursday NE @ CHI 8:15pm ET).
// Run: node scripts/test/parlay-slate.test.mjs
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as S from "../../src/lib/server/parlaySlate.js";

let pass = 0, fail = 0;
const t = async (name, fn) => { try { if (await fn()) pass++; else { fail++; console.log(`  FAIL ${name}`); } } catch (e) { fail++; console.log(`  FAIL ${name} → ${e.message}`); } };
const slate = S.parseSlate(JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures/espn-week7-scoreboard.json"), "utf8")));
const iso = (ms) => new Date(ms).toISOString();
const TNF = Date.parse("2026-10-23T00:15:00Z");
const PT = { "kyren williams": "LAR", "dallas goedert": "PHI", gibbs: "DET", "josh allen": "BUF" };
const A = (leg, o = {}) => S.analyzeLeg(leg, slate, { playerTeams: PT, ...o });
const P = (leg) => S.priceLeg(leg, slate, A(leg));

await t("parse: 14 games, week 7, byes, sorted by kickoff", () => slate.games.length === 14 && slate.week === 7 && [...slate.byes].sort().join() === "BUF,JAX,LAC,WSH" && slate.firstKickoffMs === TNF);
await t("parse: DraftKings lines", () => { const g = slate.games[0]; return g.home.abbr === "CHI" && g.lines.ml.CHI === -155 && g.lines.ml.NE === 130 && g.lines.spread.CHI.line === -3 && g.lines.spread.CHI.odds === -108 && g.lines.total.line === 50.5 && g.lines.total.over === -120 && g.lines.total.under === 100; });
await t("parse: garbage in → null, never a throw", () => S.parseSlate(null) === null && S.parseSlate({}) === null);

// teams in text
await t("teams: nickname, city, 3-letter abbr, pair", () => S.teamsIn("Vikings ML", slate)[0] === "MIN" && S.teamsIn("Kansas City to cover", slate)[0] === "KC" && S.teamsIn("BUF over 40", slate)[0] === "BUF" && S.teamsIn("NE/CHI over", slate).sort().join() === "CHI,NE");
await t("teams: 'Dallas Goedert' is a player, not the Cowboys", () => S.teamsIn("Dallas Goedert anytime TD", slate).length === 0 && S.teamsIn("Dallas ML", slate)[0] === "DAL");
await t("teams: bare 'New York' / 'Los Angeles' are ambiguous → none", () => S.teamsIn("New York ML", slate).length === 0 && S.teamsIn("Los Angeles ML", slate).length === 0 && S.teamsIn("Giants ML", slate)[0] === "NYG");
await t("player names", () => S.playerNameOf("Kyren Williams anytime td", slate) === "Kyren Williams" && S.playerNameOf("Gibbs anytime TD", slate) === "Gibbs" && S.playerNameOf("A.J. Brown over 60 yards", slate) === "A.J. Brown" && S.playerNameOf("Derrick Henry 2+ touchdowns", slate) === "Derrick Henry" && S.playerNameOf("Dallas Goedert anytime TD", slate) === "Dallas Goedert");
await t("player names: teams / market words are not players", () => S.playerNameOf("Bills ML", slate) === null && S.playerNameOf("Bills over 24.5 points", slate) === null && S.playerNameOf("Over 50.5 Bears", slate) === null && S.playerNameOf("Take the over in NE/CHI", slate) === null && S.playerNameOf("Kansas City Chiefs ML", slate) === null);

// bye / closed
await t("bye: team leg", () => A("Bills ML").problem === "bye" && A("Bills ML").reason === "The Bills are on a bye in Week 7");
await t("bye: both teams named (the Maniacs' Buffalo-Chargers leg)", () => A("Buffalo to cover against the Chargers").reason === "The Bills and Chargers are on a bye in Week 7");
await t("bye: a player on a bye team", () => A("Josh Allen anytime TD").problem === "bye" && /Josh Allen's team, the Bills, is on a bye/.test(A("Josh Allen anytime TD").reason));
await t("bye: a team that plays is fine, unknown player is fine", () => A("Vikings ML").problem === null && A("Some Rookie anytime TD").problem === null);
await t("closed: inside 15 min of kickoff, and after", () => /within 15 minutes/.test(A("Bears ML", { atMs: TNF - 5 * 60e3 }).reason) && /already kicked off/.test(A("Bears ML", { atMs: TNF + 60e3 }).reason) && A("Bears ML", { atMs: TNF - 16 * 60e3 }).problem === null);
await t("closed: other games stay open after Thursday kickoff", () => A("Vikings ML", { atMs: TNF + 3600e3 }).problem === null);

// pricing
await t("price: ML both sides", () => P("Vikings ML").american === -285 && P("Colts ML").american === 230 && P("Chiefs win").american === 124);
await t("price: spread at the posted line only", () => P("Bears -3").american === -108 && P("Patriots +3").american === -112 && P("Bears -3.5") === null && P("Chiefs to cover").american === -120);
await t("price: totals at the posted line", () => { const o = P("Take the over in NE/CHI"), u = P("NE/CHI under 50.5"); return o.american === -120 && u.american === 100 && P("NE/CHI over 49.5") === null; });
await t("price: props, 'by 10', and bye teams → null (never invented)", () => P("Kyren Williams anytime td") === null && P("Lions by 10") === null && P("Bills ML") === null);
await t("price: no slate → null, and priceLegs leaves odds undefined (no tags rendered)", () => S.priceLeg("Vikings ML", null, null) === null && S.priceLegs({ X: { leg: "Vikings ML" } }, null).X.odds === undefined);

// when do legs lock?
await t("lock: Thursday leg → 15 min before TNF", () => iso(S.lockTime([A("Bears -3")], slate)) === "2026-10-23T00:00:00.000Z");
await t("lock: no Thursday leg → 15 min before the earliest game that HAS a leg", () => iso(S.lockTime([A("Vikings ML"), A("Panthers ML")], slate)) === "2026-10-25T16:45:00.000Z" && iso(S.lockTime([A("Packers ML")], slate)) === "2026-10-25T20:10:00.000Z");
await t("lock: a leg we can't place in a game counts as the first game (earlier is safe)", () => iso(S.lockTime([A("Vikings ML"), A("something odd")], slate)) === "2026-10-23T00:00:00.000Z" && iso(S.lockTime([A("Gibbs anytime TD", { playerTeams: {} })], slate)) === "2026-10-23T00:00:00.000Z");
await t("lock: no legs yet → the next game up (Thursday before it, Sunday's early game after)", () => iso(S.lockTime([], slate, TNF - 6 * 3600e3)) === "2026-10-23T00:00:00.000Z" && iso(S.lockTime([], slate, TNF + 3600e3)) === "2026-10-25T13:15:00.000Z");
await t("lock: no slate → null (callers fall back)", () => S.lockTime([A("Vikings ML")], null) === null);

// the whole week
const allTeams = ["Maniacs", "Immigrants", "Dirty Birds", "Crab Boilers", "Title Chase"];
const teamOfUser = (u) => ({ A: "Maniacs", B: "Immigrants", C: "Dirty Birds", D: "Crab Boilers", E: "Title Chase" })[u] || null;
const fakeSearch = async (url) => ({ ok: true, json: async () => ({ items: /Gibbs/.test(url) ? [{ displayName: "Jahmyr Gibbs", league: "nfl", teamRelationships: [{ core: { abbreviation: "DET" } }] }] : [] }) });
const thuNight = Date.parse("2026-10-22T23:15:00Z"); // 7:15pm ET Thursday
const msgs = [
  { ts: String(TNF / 1000 - 3600 + 300), user: "E", text: "Vikings ML" },         // 7:20pm ET
  { ts: String(TNF / 1000 - 3600 + 200), user: "D", text: "Bears -3" },           // 7:18pm
  { ts: String(TNF / 1000 - 3600 + 100), user: "B", text: "Gibbs anytime TD" },
  { ts: String(TNF / 1000 - 3600), user: "A", text: "Bills ML" },
];
await t("week: bye leg rejected, props resolved via search, priced, lock = TNF-15 (a Thursday leg exists)", async () => {
  const r = await S.evaluateWeek({ messages: msgs, allTeams, teamOfUser, slate, nowMs: thuNight, cache: new Map(), fetchFn: fakeSearch });
  const priced = S.priceLegs(r.legs, slate, r.playerTeams);
  return Object.keys(r.legs).sort().join() === "Crab Boilers,Immigrants,Title Chase" && r.rejected.length === 1 && r.rejected[0].team === "Maniacs" && iso(r.lockMs) === "2026-10-23T00:00:00.000Z" && priced["Crab Boilers"].odds === -108 && priced["Title Chase"].odds === -285 && priced["Immigrants"].odds === null;
});
await t("week: after the lock, a later Sunday leg is ignored; before it, it counts", async () => {
  const late = [{ ts: String(TNF / 1000 + 900), user: "C", text: "Panthers ML" }, ...msgs];
  const after = await S.evaluateWeek({ messages: late, allTeams, teamOfUser, slate, nowMs: TNF + 1800e3, cache: new Map(), fetchFn: fakeSearch });
  const before = await S.evaluateWeek({ messages: late, allTeams, teamOfUser, slate, nowMs: thuNight, cache: new Map(), fetchFn: fakeSearch });
  return !after.legs["Dirty Birds"] && !!before.legs["Dirty Birds"];
});
await t("week: no Thursday leg → lock slides to Sunday 12:45pm", async () => {
  const r = await S.evaluateWeek({ messages: msgs.filter((m) => m.user !== "D"), allTeams, teamOfUser, slate, nowMs: thuNight, cache: new Map(), fetchFn: fakeSearch });
  return iso(r.lockMs) === "2026-10-25T16:45:00.000Z"; // Vikings (1pm slate) and Gibbs/Lions (4pm) → the earliest of those, 12:45pm ET Sunday
});
await t("week: no slate → still collects legs, no lock time, nothing rejected", async () => {
  const r = await S.evaluateWeek({ messages: msgs, allTeams, teamOfUser, slate: null, nowMs: thuNight });
  return Object.keys(r.legs).length === 4 && r.lockMs === null && r.rejected.length === 0;
});

// player lookup
await t("search: full name must match exactly; a lone surname matches an active player; ambiguity → ESPN's top (most prominent) result; failures → null", async () => {
  const fx = (items, ok = true) => async () => ({ ok, json: async () => ({ items }) });
  const it = (n, ab) => ({ displayName: n, league: "nfl", teamRelationships: [{ core: { abbreviation: ab } }] });
  return await S.resolvePlayerTeam("Josh Allen", fx([it("Josh Hines-Allen", "JAX"), it("Josh Allen", "BUF")])) === "BUF"
    && await S.resolvePlayerTeam("Justin Jefferson", fx([it("Justin Jefferson", "MIN"), it("Justin Jefferson", "CLE")])) === "MIN"
    && await S.resolvePlayerTeam("Gibbs", fx([it("Jahmyr Gibbs", "DET"), it("Easton Gibbs", "SEA")])) === "DET"
    && await S.resolvePlayerTeam("A.J. Brown", fx([it("AJ Brown", "PHI")])) === "PHI"
    && await S.resolvePlayerTeam("Jordan Love", fx([it("Jordan Mailata", "PHI")])) === null
    && await S.resolvePlayerTeam("Nobody", fx([])) === null
    && await S.resolvePlayerTeam("Gibbs", fx([], false)) === null
    && await S.resolvePlayerTeam("Gibbs", async () => { throw new Error("offline"); }) === null;
});
await t("player names: a capitalized 'Anytime' still ends the name", () => S.playerNameOf("Josh Allen Anytime TD", slate) === "Josh Allen" && S.playerNameOf("Justin Jefferson Over 80 yards", slate) === "Justin Jefferson");
await t("fetchSlate: failure → null", async () => (await S.fetchSlate(7, async () => { throw new Error("offline"); })) === null && (await S.fetchSlate(7, async () => ({ ok: false }))) === null);

console.log(`parlay-slate: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
