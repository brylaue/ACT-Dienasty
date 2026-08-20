/*
  Bakes static/data/knowledge.json - a compact, plain-text "league
  knowledge pack" that powers The Oracle (/ask): both its instant local
  search and the AI answer endpoint's context.

  Sources: rivalry-matchups.json (every game ever), Sleeper's winners
  brackets (champions), record-watch.json (record book), the constitution
  page source (tag-stripped), and the Slack vault. Runs in the weekly
  workflow after the other bakes so it always reflects fresh data.

  Run manually: node scripts/build-knowledge.mjs
*/
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { taxiClaimCost } from "../src/lib/server/taxiCost.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const get = async (url, retries = 4) => {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url);
      if (res.ok) return res.json();
      if (attempt >= retries) throw new Error(`${res.status} for ${url}`);
    } catch (err) {
      if (attempt >= retries) throw err;
    }
    await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
  }
};

const rivalry = JSON.parse(readFileSync(join(root, "static/data/rivalry-matchups.json"), "utf8"));

// player_id -> { year, round } from every draft in league history; the
// EARLIEST appearance is a player's original draft capital (2018 startup
// or their rookie-year draft). Undrafted players simply won't appear.
const draftedBy = {};

// ── per-season franchise mapping + regular-season standings ──────────
const seasons = [];
for (const [lid, s] of Object.entries(rivalry.seasons)) {
  const [rosters, users] = await Promise.all([
    get(`https://api.sleeper.app/v1/league/${lid}/rosters`),
    get(`https://api.sleeper.app/v1/league/${lid}/users`),
  ]);
  const userById = Object.fromEntries(users.map((u) => [u.user_id, u]));
  const nameByRoster = {};
  const ownerByRoster = {};
  for (const r of rosters) {
    const u = userById[r.owner_id];
    nameByRoster[r.roster_id] = (u?.metadata?.team_name || u?.display_name || `Team ${r.roster_id}`).trim();
    ownerByRoster[r.roster_id] = r.owner_id;
  }

  // standings from the baked regular-season weeks
  const rec = {}; // rosterID -> {w, l, t, pf, pa}
  for (const week of s.weeks || []) {
    if (!week) continue;
    for (const game of Object.values(week)) {
      if (!Array.isArray(game) || game.length !== 2) continue;
      const [a, b] = game;
      const pa = a.points.reduce((x, y) => x + y, 0);
      const pb = b.points.reduce((x, y) => x + y, 0);
      // 0-0 games were never actually played (the league joined Sleeper
      // mid-season in 2018, which left phantom matchups) - skip them so
      // they don't pollute records with fake ties
      if (pa === 0 && pb === 0) continue;
      for (const [t, mine, theirs] of [[a, pa, pb], [b, pb, pa]]) {
        rec[t.roster_id] ||= { w: 0, l: 0, t: 0, pf: 0, pa: 0 };
        rec[t.roster_id].pf += mine;
        rec[t.roster_id].pa += theirs;
        if (mine > theirs) rec[t.roster_id].w++;
        else if (mine < theirs) rec[t.roster_id].l++;
        else rec[t.roster_id].t++;
      }
    }
  }

  // every draft this season: record each pick's original round
  try {
    const drafts = await get(`https://api.sleeper.app/v1/league/${lid}/drafts`);
    for (const d of drafts || []) {
      if (d.status !== "complete") continue;
      const picks = await get(`https://api.sleeper.app/v1/draft/${d.draft_id}/picks`);
      for (const pk of picks || []) {
        if (!pk.player_id) continue;
        const yr = parseInt(d.season, 10);
        if (!draftedBy[pk.player_id] || draftedBy[pk.player_id].year > yr) {
          draftedBy[pk.player_id] = { year: yr, round: pk.round };
        }
      }
    }
  } catch { /* a missing draft just means fewer annotations */ }

  // champion + runner-up from Sleeper's winners bracket (completed seasons)
  let champion = null;
  let runnerUp = null;
  if (s.status === "complete") {
    try {
      const bracket = await get(`https://api.sleeper.app/v1/league/${lid}/winners_bracket`);
      const finalGame = [...bracket].sort((a, b) => b.r - a.r).find((g) => g.p === 1);
      if (finalGame?.w) {
        champion = finalGame.w;
        runnerUp = finalGame.l ?? null;
      }
    } catch {
      /* bracket unavailable - champion stays unknown for that season */
    }
  }

  const standings = Object.entries(rec)
    .map(([rid, r]) => ({
      rosterID: parseInt(rid, 10),
      name: nameByRoster[rid],
      owner: ownerByRoster[rid],
      w: r.w, l: r.l, t: r.t,
      pf: Math.round(r.pf * 100) / 100,
    }))
    .sort((a, b) => b.w - a.w || b.pf - a.pf);

  const playedWeeks = (s.weeks || []).filter((w) => w && Object.values(w).some(
    (g) => Array.isArray(g) && g.some((t) => t.points.reduce((x, y) => x + y, 0) > 0))).length;

  const seasonYear = parseInt(s.year, 10);
  seasons.push({
    year: seasonYear,
    status: s.status,
    note: seasonYear === 2018 ? "Partial season - the league began mid-season 2018, so records are from a shortened schedule." : (playedWeeks > 0 && playedWeeks < 10 && s.status === "complete" ? `Shortened season (${playedWeeks} weeks).` : undefined),
    champion: champion ? nameByRoster[champion] : null,
    runnerUp: runnerUp ? nameByRoster[runnerUp] : null,
    standings,
    _owners: ownerByRoster,
    _names: nameByRoster,
  });
}
seasons.sort((a, b) => a.year - b.year);

// ── franchise career table (continuity by ROSTER lineage) ────────────
// Rosters persist across the league chain even when the team name or
// owner changes, so roster_id is the franchise identity. Name history
// is kept so old names stay searchable (2018's "mcmath15" is today's
// "TDs in Your Face").
const franchises = {}; // roster_id -> career
for (const s of seasons) {
  for (const row of s.standings) {
    const f = (franchises[row.rosterID] ||= { name: row.name, formerNames: [], seasons: 0, w: 0, l: 0, t: 0, pf: 0, titles: 0, runnerUps: 0 });
    if (f.name !== row.name && !f.formerNames.includes(f.name)) f.formerNames.push(f.name);
    f.name = row.name; // latest name wins
    f.formerNames = f.formerNames.filter((n) => n !== row.name);
    f.seasons++;
    f.w += row.w; f.l += row.l; f.t += row.t; f.pf += row.pf;
    if (s.champion === row.name) f.titles++;
    if (s.runnerUp === row.name) f.runnerUps++;
  }
}
// per-franchise single-game records from the full history (0-0 phantoms excluded)
const gameExtremes = {}; // rosterID -> {best, worst}
for (const [lid, s] of Object.entries(rivalry.seasons)) {
  const yr = parseInt(s.year, 10);
  const scan = (week, game, playoff) => {
    if (!Array.isArray(game) || game.length !== 2) return;
    const [a, b] = game;
    const pa = a.points.reduce((x, y) => x + y, 0);
    const pb = b.points.reduce((x, y) => x + y, 0);
    if (pa === 0 && pb === 0) return;
    for (const [t, pts] of [[a, pa], [b, pb]]) {
      const e = (gameExtremes[t.roster_id] ||= {});
      if (!e.best || pts > e.best.pts) e.best = { pts: Math.round(pts * 100) / 100, year: yr, week, playoff };
      if (!e.worst || pts < e.worst.pts) e.worst = { pts: Math.round(pts * 100) / 100, year: yr, week, playoff };
    }
  };
  (s.weeks || []).forEach((week, ix) => { if (week) Object.values(week).forEach((g) => scan(ix + 1, g)); });
  // playoff games count toward a franchise's best/worst too
  Object.entries(s.playoffWeeks || {}).forEach(([wk, games]) => {
    Object.values(games || {}).forEach((g) => scan(parseInt(wk, 10), g, true));
  });
}

for (const [rid, f] of Object.entries(franchises)) {
  f.rosterID = parseInt(rid, 10);
  const e = gameExtremes[rid];
  if (e?.best) f.bestGame = `${e.best.pts} pts (${e.best.year} Week ${e.best.week}${e.best.playoff ? ', Playoffs' : ''})`;
  if (e?.worst) f.worstGame = `${e.worst.pts} pts (${e.worst.year} Week ${e.worst.week}${e.worst.playoff ? ', Playoffs' : ''})`;
}

const franchiseTable = Object.values(franchises)
  .map((f) => ({ ...f, pf: Math.round(f.pf * 100) / 100 }))
  .sort((a, b) => b.titles - a.titles || b.w - a.w);

// ── current rosters: players w/ position, original draft round, taxi/IR ──
const currentLid = rivalry.leagueID;
const [curRosters, curUsers, tradedPicks, curDrafts] = await Promise.all([
  get(`https://api.sleeper.app/v1/league/${currentLid}/rosters`),
  get(`https://api.sleeper.app/v1/league/${currentLid}/users`),
  get(`https://api.sleeper.app/v1/league/${currentLid}/traded_picks`),
  get(`https://api.sleeper.app/v1/league/${currentLid}/drafts`),
]);
const curUserById = Object.fromEntries(curUsers.map((u) => [u.user_id, u]));
const curNameByRoster = {};
for (const r of curRosters) {
  const u = curUserById[r.owner_id];
  curNameByRoster[r.roster_id] = (u?.metadata?.team_name || u?.display_name || `Team ${r.roster_id}`).trim();
}

const allRosteredIds = [...new Set(curRosters.flatMap((r) => r.players || []))];
const allPlayers = await get("https://api.sleeper.app/v1/players/nfl");

// draft context is needed to price taxi claims, so it's resolved before
// the roster section is shaped
const draftRounds = curDrafts?.[0]?.settings?.rounds || 4;
const upcomingSeason = parseInt(curDrafts?.[0]?.season || new Date().getFullYear(), 10);
const preDraft = curDrafts?.[0]?.status !== "complete";
// compensation comes out of the NEXT annual draft - the upcoming one if
// it hasn't happened yet, otherwise the following year's
const claimSeason = preDraft ? upcomingSeason : upcomingSeason + 1;

// ── Raeger Rule: who has ever been dropped? ──────────────────────────
// A player dropped to waivers and later picked back up has his claim
// cost reset to a 3rd. Completed seasons come from the transactions
// archive; the current season is fetched live (cheap, 18 small calls).
const droppedEver = new Set();
const noteDrops = (txns) => {
  for (const t of txns || []) {
    for (const id of Object.keys(t?.drops || {})) droppedEver.add(id);
  }
};
const ARCH = join(root, "static/data/transactions-archive.json");
if (existsSync(ARCH)) {
  const arch = JSON.parse(readFileSync(ARCH, "utf8"));
  for (const list of Object.values(arch.seasons || {})) noteDrops(list);
}
try {
  const weeks = await Promise.all(
    Array.from({ length: 18 }, (_, i) =>
      get(`https://api.sleeper.app/v1/league/${currentLid}/transactions/${i + 1}`).catch(() => []),
    ),
  );
  for (const w of weeks) noteDrops(w);
} catch {
  console.warn("current-season transactions unavailable - Raeger Rule flags may be incomplete");
}
console.log(`drop history: ${droppedEver.size} players have been dropped at some point`);

// the live layer prices claims itself; all it needs from the bake is the
// drop history, and only for DRAFTED players (undrafted already bottoms
// out at a 3rd, so the flag would change nothing)
const droppedPlayers = [...droppedEver].filter((id) => draftedBy[id]);

const describe = (id) => {
  const pl = allPlayers[id];
  const name = pl ? `${pl.first_name} ${pl.last_name}` : `Player ${id}`;
  const pos = pl?.position || "?";
  const d = draftedBy[id];
  const drafted = d ? `drafted ${d.year} R${d.round}` : "undrafted in this league's annual drafts";
  return { name, pos, drafted, round: d?.round || null };
};

const rosterSection = curRosters.map((r) => {
  const taxi = new Set(r.taxi || []);
  const ir = new Set(r.reserve || []);
  const activeRoster = [];
  const taxiSquad = [];
  const injuredReserve = [];

  for (const id of r.players || []) {
    const { name, pos, drafted, round } = describe(id);
    const line = `${name} (${pos}, ${drafted})`;
    if (taxi.has(id)) {
      const cost = taxiClaimCost({ round, dropped: droppedEver.has(id) }, claimSeason);
      taxiSquad.push(`${line} - TAXI CLAIM COST: ${cost}`);
    } else if (ir.has(id)) {
      injuredReserve.push(line);
    } else {
      activeRoster.push(line);
    }
  }

  return {
    rosterID: r.roster_id,
    name: curNameByRoster[r.roster_id],
    activeRoster,
    taxiSquad,
    injuredReserve,
  };
});
const pickSeasons = [];
if (preDraft) pickSeasons.push(upcomingSeason);
pickSeasons.push(upcomingSeason + 1, upcomingSeason + 2);
const picksByRoster = Object.fromEntries(curRosters.map((r) => [r.roster_id, []]));
for (const season of pickSeasons) {
  for (let round = 1; round <= draftRounds; round++) {
    for (const r of curRosters) {
      const traded = (tradedPicks || []).find(
        (t) => parseInt(t.season, 10) === season && t.round === round && t.roster_id === r.roster_id,
      );
      const ownerRoster = traded ? traded.owner_id : r.roster_id;
      if (picksByRoster[ownerRoster]) {
        picksByRoster[ownerRoster].push(
          `${season} R${round}${ownerRoster !== r.roster_id ? ` (via ${curNameByRoster[r.roster_id]})` : ""}`,
        );
      }
    }
  }
}
for (const rs of rosterSection) rs.picks = picksByRoster[rs.rosterID] || [];

// ── record book (reuse the record-watch bake) ────────────────────────
let records = {};
const RW = join(root, "static/data/record-watch.json");
if (existsSync(RW)) {
  const rw = JSON.parse(readFileSync(RW, "utf8"));
  records = { highs: (rw.highs || []).slice(0, 10), lows: (rw.lows || []).slice(0, 10) };
}

// ── constitution text (tag-stripped from the page source) ────────────
let constitution = "";
const CONST = join(root, "src/routes/constitution/+page.svelte");
if (existsSync(CONST)) {
  const src = readFileSync(CONST, "utf8");
  const body = src.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<style[\s\S]*?<\/style>/g, "");
  constitution = body
    .replace(/<[^>]+>/g, " ")
    .replace(/\{[^}]*\}/g, " ")
    .replace(/&middot;|&amp;|&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ── slack vault (text only, capped) ──────────────────────────────────
let slack = [];
const SLACK = join(root, "static/data/slack-archive.json");
if (existsSync(SLACK)) {
  const v = JSON.parse(readFileSync(SLACK, "utf8"));
  for (const ch of v.channels || []) {
    for (const m of (ch.messages || []).slice(-100)) {
      if (m.text) slack.push({ ch: ch.name, ts: m.ts, name: m.name, text: m.text });
    }
  }
}

// contact info never ships in the knowledge pack - it's a public,
// fetchable JSON and also becomes AI context. Phones + emails out.
const redact = (text) =>
  String(text || "")
    .replace(/\+?\d{0,2}[\s.(-]*\d{3}[\s.)-]*\d{3}[\s.-]*\d{4}/g, "[contact redacted]")
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "[contact redacted]");

constitution = redact(constitution);
slack = slack.map((m) => ({ ...m, text: redact(m.text) }));

// players-lite: id -> "Name|POS" for fantasy-relevant players, so the
// live endpoint can name anyone who joins a roster between bakes
const playersLite = {};
const FANTASY_POS = new Set(["QB", "RB", "WR", "TE", "K", "DEF"]);
// historical closure: every player id that appears in any trade, any
// lineup ever started, or any draft - retired players included, so the
// trade-history and player-history tools can always resolve names
const historicalIds = new Set(Object.keys(draftedBy));
try {
  const archive = JSON.parse(readFileSync(join(root, "static/data/transactions-archive.json"), "utf8"));
  for (const txs of Object.values(archive.seasons || {})) {
    for (const tx of txs || []) {
      for (const id of Object.keys(tx.adds || {})) historicalIds.add(id);
      for (const id of Object.keys(tx.drops || {})) historicalIds.add(id);
    }
  }
} catch { /* archive missing - closure still covers drafts/starters */ }
for (const s of Object.values(rivalry.seasons || {})) {
  for (const week of s.weeks || []) {
    if (!week) continue;
    for (const game of Object.values(week)) {
      if (!Array.isArray(game)) continue;
      for (const t of game) for (const id of t.starters || []) historicalIds.add(id);
    }
  }
}
for (const [id, pl] of Object.entries(allPlayers)) {
  if (!pl) continue;
  const relevant = (FANTASY_POS.has(pl.position) && pl.active) || allRosteredIds.includes(id) || historicalIds.has(id);
  if (relevant) playersLite[id] = `${pl.first_name} ${pl.last_name}|${pl.position || "?"}`;
}
writeFileSync(join(root, "static/data/players-lite.json"), JSON.stringify(playersLite));
console.log(`wrote static/data/players-lite.json (${Object.keys(playersLite).length} players)`);

const draftedByCompact = Object.fromEntries(
  Object.entries(draftedBy).map(([id, d]) => [id, `${d.year} R${d.round}`]),
);

// league configuration: the granular rules people actually ask about
const leagueMeta = await get(`https://api.sleeper.app/v1/league/${currentLid}`);
const nflState = await get("https://api.sleeper.app/v1/state/nfl");
const st = leagueMeta.settings || {};
const startCounts = {};
for (const pos of leagueMeta.roster_positions || []) startCounts[pos] = (startCounts[pos] || 0) + 1;
const leagueSettings = {
  name: leagueMeta.name,
  teams: leagueMeta.total_rosters,
  scoring: `${leagueMeta.scoring_settings?.rec ?? 0} PPR`,
  startingLineup: Object.entries(startCounts).filter(([p]) => p !== "BN").map(([p, n]) => `${n}x ${p}`).join(", "),
  benchSlots: startCounts.BN || 0,
  taxiSlots: st.taxi_slots,
  irSlots: st.reserve_slots,
  playoffTeams: st.playoff_teams,
  playoffsStartWeek: st.playoff_week_start,
  tradeDeadlineWeek: st.trade_deadline,
  waivers: st.waiver_type === 2 ? `FAAB budget $${st.waiver_budget}` : "rolling priority",
};

// regular-season schedule: empty until Sleeper sets it after the draft,
// then the next weekly bake picks it up automatically
const schedule = {};
const lastRegWeek = (st.playoff_week_start || 15) - 1;
for (let wk = 1; wk <= lastRegWeek; wk++) {
  try {
    const ms = await get(`https://api.sleeper.app/v1/league/${currentLid}/matchups/${wk}`);
    if (!Array.isArray(ms) || !ms.length) continue;
    const byMatch = {};
    for (const m of ms) {
      if (m.matchup_id == null) continue;
      (byMatch[m.matchup_id] ||= []).push(m.roster_id);
    }
    const pairs = Object.values(byMatch).filter((p) => p.length === 2)
      .map(([a, b]) => `${curNameByRoster[a]} vs ${curNameByRoster[b]}`);
    if (pairs.length) schedule[`week ${wk}`] = pairs;
  } catch { /* week unavailable - skip */ }
}

// §4.3 claim mechanics, distilled to structure. The cost formula already
// lives in taxiCost.js; this is the PROCESS - who can claim, how, and
// what happens next. Update if the constitution's 4.3 changes.
const taxiClaimProcess = {
  whoCanClaim: "ANY owner may claim a player from ANY OTHER owner's taxi squad. (You cannot claim your own taxi players - they're already yours; you'd just promote them.)",
  howToClaim: "Post a notification in the league's Slack thread. The executive committee then notifies the owner whose player is being claimed.",
  ownerOptions: "The owner has 72 hours to either PROMOTE the player to their active roster (keeping him, blocking the claim) or FORFEIT him to the claimer.",
  compensation: "A pick in the NEXT year's annual draft, one round higher than the player was originally drafted (minimum a 3rd). 1st-round picks cost a 1st AND a 2nd. Undrafted players cost a 3rd.",
  ifYouLackTheExactPick: "You must own a pick in the required round for the next annual draft - OR you may designate a HIGHER round pick instead. Not owning the exact round does not block a claim if you have a better pick to offer.",
  multiplePicksInRound: "If the claimer owns multiple picks in the required round, the owner LOSING the player chooses which one they receive.",
  afterClaim: "A claimed player must go on the claimer's ACTIVE roster (must fit roster limits). Claims are irrevocable once accepted or once the 72-hour window passes.",
  timing: "Claims are a during-the-season mechanism per the constitution; the commissioner has discretion on timing disputes (e.g. vacations).",
};

const knowledge = {
  generated: new Date().toISOString(),
  leagueID: rivalry.leagueID,
  taxiClaimProcess,
  leagueSettings,
  nflState: { season: nflState.season, phase: nflState.season_type, currentWeek: nflState.week },
  schedule: Object.keys(schedule).length ? schedule : "Not yet set - Sleeper generates the season schedule after the rookie draft. It will appear here automatically once set.",
  league:
    "ACT, or DIE. - 12-team superflex dynasty fantasy football league, hosted on Sleeper. Founded MID-SEASON 2018, so 2018 is a partial season with a shortened schedule. " +
    "ROSTERS: each team in the rosters section has FOUR separate lists - activeRoster, taxiSquad, injuredReserve, and picks (future draft picks owned). " +
    "A player is on a team's taxi squad IF AND ONLY IF he appears in that team's taxiSquad list; a player in activeRoster is NOT on the taxi squad and cannot be claimed. Never infer a player's status from anything other than which list he is in. " +
    "Every taxiSquad entry already states that player's TAXI CLAIM COST, computed from constitution section 4.3 including the Raeger Rule - quote that figure rather than working the cost out yourself. " +
    "To actually make a claim, the claiming team must own a pick of that round in the next annual draft (see each team's picks list). " +
    "Watch for players with similar names: Trevor Etienne and Travis Etienne are different players on different teams. " +
    "Franchises persist by roster across seasons even as team names change year to year - each franchise entry lists its former names (e.g. the franchise now called 'TDs in Your Face' won the 2018 title under the name 'mcmath15').",
  seasons: seasons.map(({ _owners, _names, ...rest }) => rest),
  rosters: rosterSection,
  claimSeason,
  draftedBy: draftedByCompact,
  droppedPlayers,
  rosterNames: curNameByRoster,
  franchises: franchiseTable,
  records,
  constitution,
  slack,
};

writeFileSync(join(root, "static/data/knowledge.json"), JSON.stringify(knowledge));
const size = Math.round(JSON.stringify(knowledge).length / 1024);
console.log(`wrote static/data/knowledge.json (${seasons.length} seasons, ${franchiseTable.length} franchises, ~${size}KB)`);
const champs = seasons.filter((s) => s.champion).map((s) => `${s.year}: ${s.champion}`);
console.log("champions:", champs.join(" | "));
