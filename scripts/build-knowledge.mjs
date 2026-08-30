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

  // official records come from Sleeper roster settings, which include the
  // weekly top-6 bonus win/loss (constitution 3.0 double-win format) - the
  // recomputed rec{} is head-to-head only and would understate wins
  const standings = rosters
    .map((r) => {
      const st = r.settings || {};
      const h2h = rec[r.roster_id] || { w: 0, l: 0, t: 0, pf: 0 };
      const officialPf = st.fpts != null ? st.fpts + (st.fpts_decimal || 0) / 100 : h2h.pf;
      return {
        rosterID: r.roster_id,
        name: nameByRoster[r.roster_id],
        owner: ownerByRoster[r.roster_id],
        w: st.wins ?? h2h.w, l: st.losses ?? h2h.l, t: st.ties ?? h2h.t,
        h2h: `${h2h.w}-${h2h.l}${h2h.t ? "-" + h2h.t : ""}`,
        pf: Math.round(officialPf * 100) / 100,
      };
    })
    .filter((row) => row.w + row.l + row.t > 0 || (rec[row.rosterID]?.pf || 0) > 0)
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

constitution = redact(constitution)
  .replace(/call\(\[[0-9,\s]+\]\)\}?>?\s*📞?\s*Call/g, "[call button]")
  .replace(/call\(\[[0-9,\s]+\]\)/g, "[call button]");
slack = slack.map((m) => ({ ...m, text: redact(m.text) }));

// players-lite: id -> "Name|POS" for fantasy-relevant players, so the
// live endpoint can name anyone who joins a roster between bakes
const playersLite = {};
const FANTASY_POS = new Set(["QB", "RB", "WR", "TE", "K", "DEF"]);
// historical closure: every player id that appears in any trade, any
// lineup ever started, or any draft - retired players included, so the
// trade-history and player-history tools can always resolve names
const historicalIds = new Set(Object.keys(draftedBy));
// every pick in the current-year draft resolves by name, even when
// Sleeper's active flag lags for incoming rookies
try {
  const drafts = await get(`https://api.sleeper.app/v1/league/${currentLid}/drafts`);
  if (drafts?.[0]?.draft_id) {
    const dpicks = await get(`https://api.sleeper.app/v1/draft/${drafts[0].draft_id}/picks`);
    for (const pk of dpicks || []) if (pk.player_id) historicalIds.add(String(pk.player_id));
  }
} catch { /* draft picks unavailable */ }
try {
  const archive = JSON.parse(readFileSync(join(root, "static/data/transactions-archive.json"), "utf8"));
  for (const txs of Object.values(archive.seasons || {})) {
    for (const tx of txs || []) {
      for (const id of Object.keys(tx.adds || {})) historicalIds.add(id);
      for (const id of Object.keys(tx.drops || {})) historicalIds.add(id);
    }
  }
} catch { /* archive missing - closure still covers drafts/starters */ }
try {
  const ma = JSON.parse(readFileSync(join(root, "static/data/matchups-archive.json"), "utf8"));
  for (const season of Object.values(ma.seasons || {})) {
    for (const wk of season.weeks || []) for (const t of wk) for (const id of Object.keys(t.pp || {})) historicalIds.add(id);
  }
} catch { /* archive not baked yet */ }
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
  playoffTeams: st.playoff_teams === 6
    ? "6 (3 division winners, 2 record wildcards, 1 Points-For qualifier; seeds 1-2 get Week 15 byes) - per the Aug 2026 amendment, reflected in Sleeper."
    : "6 per the Aug 2026 league vote (Sleeper currently shows " + st.playoff_teams + " - the constitution governs).",
  playoffsStartWeek: st.playoff_week_start,
  tradeDeadlineWeek: "Week 14 per constitution 4.5 (no trades Week 15 through the Championship Game; trading reopens after it). Sleeper's platform setting shows no deadline - the constitution governs.",
  winsFormat: "DOUBLE-WIN format per constitution 3.0: each week every team gets a head-to-head win/loss AND the six highest-scoring teams earn an extra WIN while the six lowest earn an extra LOSS. Official records include both.",
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
  afterClaim: "A claimed player must go on the claimer's ACTIVE roster (must fit roster limits). Claims are irrevocable once accepted or once the 72-hour window passes - but BEFORE acceptance or expiry, the claimer may withdraw the claim.",
  timing: "Claims are a during-the-season mechanism per the constitution; the commissioner has discretion on timing disputes (e.g. vacations).",
};

// The by-laws, distilled to structure so rule questions are lookups.
// Source: the constitution (also included verbatim below). Update these
// if the constitution changes.
const bylaws = {
  rosters: "Active roster: 25 players in-season (temporarily 27 in the offseason, announced post-Super-Bowl; must cut to 25 no later than 1 day before Week 1). No position limits. Taxi squad: 5 spots. IR: 4 spots, only players on the NFL's official IR/PUP list; suspended players may NOT go on IR. IR must be cleared before offseason Blind Bidding begins or the commissioner auto-drops the players.",
  taxiEligibility: "Taxi squad holds ONLY rookies, 2nd-year, or 3rd-year players. Promote to active anytime, but once on the active roster a player cannot return to taxi until the following offseason. Offseason acquisitions must be placed on taxi no later than 1 day before Week 1. Mid-season FA adds CAN go to taxi: add to active then demote immediately, before any game that week starts. Taxi players can NEVER be traded (promote first). No taxi moves during drafts. Suspended players can't be ADDED to taxi (one already there may stay until next offseason). Sleeper updates 'years in league' right after the season - 3rd-year taxi players must be moved to active immediately when the offseason flips. IR wrinkles: a player IR'd before Week 1 may go to taxi mid-season when he clears NFL IR (if otherwise eligible); players promoted IR-to-active lose taxi eligibility - they must move IR-to-taxi directly.",
  trades: "Highly encouraged, between any owners. Tradable: players, picks up to 3 annual drafts out, and FAAB dollars. NO trades after Week 14 until after the Championship Game. Trade activity closed during live game play. Trades allowed during the annual draft (a traded on-the-clock pick keeps its remaining timer). IR players CAN be traded directly from IR (must land on an open ACTIVE spot; new owner may then IR them). Taxi players cannot be traded. Devy assets already owned are tradable; no new devy drafting. Trades process instantly; the exec committee may retroactively reverse only for collusion/foul play - value judgments are each owner's own. RENTAL TRADES BANNED outright (any loan-for-compensation arrangement; secret rentals risk expulsion under collusion by-laws).",
  freeAgency: "FAAB: $1500 blind-bid dollars per team after each annual draft, NO rollover. In-season blind bids process WEDNESDAYS. Players dropped by a team are locked from FCFS until the following week so everyone can bid. First-Come-First-Served runs after the waiver run until Sundays 1:00pm and costs $0.",
  lineups: "10 starters: 1 QB, 2 RB, 2 WR, 1 TE, 2 Flex (RB/WR/TE - the former Reception Flex became a full Flex for 2026), 1 Super Flex (QB/RB/WR/TE). Players lock individually at THEIR game's kickoff (swap freely before that). Each team gets one Sleeper 'Player Swap' per the platform's rules. Position designations follow Sleeper; disputes go to the exec committee.",
  scoring: "0.5 PPR, 2-decimal scoring. 4 pts passing TD, 6 all other TDs, 0.04/pass yd, 0.1/rush yd, 0.1/rec yd, 0.5/reception, 2 per 2-pt conversion, -2 fumble lost, -2 INT. Only starters score.",
  winsFormat: "DOUBLE WIN each week: head-to-head result PLUS the top-6 scoring teams get an extra WIN and the bottom-6 an extra LOSS. Up to 28 games per 14-week season. 3 divisions of 4; play division rivals twice, everyone else once; divisions realign every 3 years via snake selection by the best 3-year records.",
  playoffs: "AMENDED BY LEAGUE VOTE AUG 2026: Weeks 15-17, SIX teams. Seeds 1-3 = division winners by overall rank; seeds 4-5 = best remaining RECORDS (points break ties); seed 6 = highest POINTS FOR among all remaining teams regardless of record. Seeds 1 and 2 get Week 15 BYES. Week 15: #3 vs #6 and #4 vs #5. Week 16: #1 vs lowest remaining seed, #2 vs the other winner. Week 17: championship + 3rd-place game. Week 15 losers get picks 7 and 8, ordered by REGULAR SEASON RECORD - worse record takes Pick 7, the other Pick 8. Picks 9-12 unchanged: 3rd-place-game loser 9, winner 10, runner-up 11, champion 12. Sleeper reflects the 6-team format.",
  losersBracket: "Known in-league as the TOILET BOWL. 6 non-playoff teams (7 before the Aug 2026 six-team playoff amendment), weeks 15-17, seeded by record with the top seed on a Week 15 bye. The winner earns compensatory pick 1.13 (between rounds 1 and 2) - fully tradable. Since 2025-26 the winner gets ONLY the pick, no prize money.",
  draftOrder: "SIX-TEAM ERA (Aug 2026): picks 1-6 = the six non-playoff teams, worst records first (fewer points = better pick); picks 7-8 = the two Wild Card losers ordered by regular season record (worse record = Pick 7); picks 9-12 from playoff results as before. 4 rounds, straight-line (not snake). Historic 5-team rule: Picks 1-7 = worst records first (fewer points scored breaks ties toward the BETTER pick). Pick 8 = wildcard game loser. Picks 9-12 from playoff results (9 = 3rd-place-game loser, 10 = 3rd place, 11 = runner-up, 12 = champion). Rounds 1-2 untimed; rounds 3-4 have a 3-minute clock. Draft picks cannot exceed roster space - forfeit with no compensation if you can't roster them.",
  penalties: "LAST PLACE takes the ACT exam before the next rookie draft (league pays the entry fee). Consecutive-year losers may petition for an alternative exam (not career-related ones). Refusal → league vote on expulsion, or forfeiture of the 1st-round rookie pick. INACTIVITY: missing complete lineups 2 consecutive weeks or 4+ total = exec committee may seize the team for the season (seized teams can't trade). ANTI-TANKING: intentionally weak legal lineups may be adjusted by the exec committee; incomplete rosters can cost a 1st-round pick position drop per offense. Strategic rebuilds are fine - giving away unearned wins is not.",
  duesAndPrizes: "Dues rise $10/year ($150 for 2026). 15% of each year's dues rolls into the SUPER POT paid every 5 seasons - 2026 IS a Super Pot year (2022-2025 set-asides + all 2026 dues). Champion: trophy + remainder after other payouts; 2nd: 12.5%; 3rd: 8.3%; division winners get bottles of booze (max $50). Rookie of the Year (best rookie-draft skill-position pick, QBs excluded, credited to the DRAFTING team even if traded) and the Gump Hayes Award (best waiver add, QBs eligible) each pay 3.3%.",
  parlay: "Chef's Table (since 2025-26): each week the LOWEST-scoring team places a $5 league parlay; every team may submit one leg in the Slack parlay channel by Saturday night; winnings split 12 ways (after taxes on big hits).",
  governance: "Living constitution - changes voted between seasons; exec committee (commissioner + 3 elected owners) resolves anything not covered and rules on disputes; involved members recuse. Departing owners can't sell or hand off teams - the exec committee finds replacements.",
};

// owner identity: Sleeper is the source of truth for WHO owns each
// roster (owner_id + co_owners); the site's managers config supplies
// their real names. Falls back to the @handle when unmatched.
// names confirmed by the league that aren't in the managers config
const SUPPLEMENTAL_MANAGER_NAMES = {
  "1128772653847916544": "David McKeon", // Bryan's co-owner, roster 3
};
const managerNames = { ...SUPPLEMENTAL_MANAGER_NAMES };
try {
  const li = readFileSync(join(root, "src/lib/utils/leagueInfo.js"), "utf8");
  const re = /"managerID":\s*"(\d+)",\s*"name":\s*"([^"]+)"/g;
  let m;
  while ((m = re.exec(li))) managerNames[m[1]] = m[2];
} catch { /* config unreadable - handles still work */ }

const ownerLabel = (userId) => {
  const handle = curUserById[userId]?.display_name || "unknown";
  const real = managerNames[userId];
  return real ? `${real} (@${handle})` : `@${handle}`;
};
const ownersByRoster = {};
for (const r of curRosters) {
  const parts = [ownerLabel(r.owner_id)];
  for (const co of r.co_owners || []) parts.push(`co-owner: ${ownerLabel(co)}`);
  ownersByRoster[r.roster_id] = parts.join("; ");
}
for (const rs of rosterSection) rs.owners = ownersByRoster[rs.rosterID];
for (const f of franchiseTable) if (ownersByRoster[f.rosterID]) f.ownedBy = ownersByRoster[f.rosterID];

// ---- lineup efficiency, blunders, and waiver analytics ----
const posOf = (id) => (playersLite[id] || "|?").split("|")[1];
const ELIG = {
  QB: ["QB"], RB: ["RB"], WR: ["WR"], TE: ["TE"],
  FLEX: ["RB", "WR", "TE"], REC_FLEX: ["WR", "TE"], WRRB_FLEX: ["WR", "RB"],
  SUPER_FLEX: ["QB", "RB", "WR", "TE"], K: ["K"], DEF: ["DEF"],
};
const SLOT_ORDER = ["QB", "RB", "WR", "TE", "K", "DEF", "REC_FLEX", "WRRB_FLEX", "FLEX", "SUPER_FLEX"];
function optimalPoints(pp, lineup) {
  const slots = [...lineup].sort((a, b) => SLOT_ORDER.indexOf(a) - SLOT_ORDER.indexOf(b));
  const pool = Object.entries(pp).map(([id, pts]) => ({ id, pts, pos: posOf(id) }))
    .sort((a, b) => b.pts - a.pts);
  const used = new Set();
  let total = 0;
  for (const slot of slots) {
    const elig = ELIG[slot] || [];
    const pick = pool.find((pl) => !used.has(pl.id) && elig.includes(pl.pos) && pl.pts > 0);
    if (pick) { used.add(pick.id); total += pick.pts; }
  }
  return Math.round(total * 100) / 100;
}

const effBySeasonRoster = {}; // year -> rosterID -> {actual, optimal, perfect, worstWeek}
const blunders = [];
let matchupsArchive = null;
try {
  matchupsArchive = JSON.parse(readFileSync(join(root, "static/data/matchups-archive.json"), "utf8"));
  for (const [year, season] of Object.entries(matchupsArchive.seasons)) {
    const perRoster = {};
    season.weeks.forEach((wk, wIx) => {
      for (const t of wk) {
        if (!t.pts && !Object.keys(t.pp || {}).length) continue; // unplayed
        const opt = optimalPoints(t.pp || {}, season.lineup || []);
        if (opt <= 0) continue;
        const e = (perRoster[t.r] ||= { actual: 0, optimal: 0, perfect: 0, worst: null });
        e.actual += t.pts; e.optimal += opt;
        const left = Math.round((opt - t.pts) * 100) / 100;
        if (left < 0.01) e.perfect += 1;
        if (!e.worst || left > e.worst.left) e.worst = { week: wIx + 1, left };
        if (left > 0) blunders.push({ year: parseInt(year, 10), week: wIx + 1, rosterID: t.r, left, actual: t.pts, optimal: opt });
      }
    });
    effBySeasonRoster[year] = perRoster;
  }
} catch { /* archive missing - efficiency skipped */ }

// manager history: franchises changed hands - past trades and records
// belong to the owner AT THE TIME, not today's manager
try {
  const mhByRoster = {};
  for (const [yrKey, seasonInfo] of Object.entries(matchupsArchive?.seasons || {})) {
    const [uRes, rRes] = await Promise.all([
      get(`https://api.sleeper.app/v1/league/${seasonInfo.leagueID}/users`),
      get(`https://api.sleeper.app/v1/league/${seasonInfo.leagueID}/rosters`),
    ]);
    const uName = Object.fromEntries((uRes || []).map((u) => [u.user_id, u.display_name]));
    for (const r of rRes || []) {
      (mhByRoster[r.roster_id] ||= {})[yrKey] = uName[r.owner_id] || String(r.owner_id);
    }
  }
  for (const row of franchiseTable) {
    if (row.rosterID != null && mhByRoster[row.rosterID]) row.managerHistory = mhByRoster[row.rosterID];
  }
} catch { /* timeline best effort */ }


blunders.sort((a, b) => b.left - a.left);
const franchiseName = (rid) => curNameByRoster[rid] || `Team ${rid}`;
const benchBlunders = blunders.slice(0, 5).map((b) =>
  `${franchiseName(b.rosterID)} left ${b.left} pts on the bench (${b.year} Wk ${b.week}: scored ${b.actual}, optimal ${b.optimal})`);

// best waiver/FA adds per season (Gump Hayes style): points accrued for the
// adding roster from the add week onward while the player was rostered
const waiverBests = [];
try {
  const txa = JSON.parse(readFileSync(join(root, "static/data/transactions-archive.json"), "utf8"));
  const lidToYear = Object.fromEntries(Object.entries(matchupsArchive?.seasons || {}).map(([y, s]) => [s.leagueID, y]));
  for (const [lid, txs] of Object.entries(txa.seasons || {})) {
    const year = lidToYear[lid];
    const season = matchupsArchive?.seasons?.[year];
    if (!season) continue;
    const adds = [];
    for (const tx of txs) {
      if (!["waiver", "free_agent"].includes(tx.type) || tx.status !== "complete") continue;
      for (const [pid, rid] of Object.entries(tx.adds || {})) adds.push({ pid, rid, week: tx.leg || 1 });
    }
    const scored = adds.map((a) => {
      let pts = 0;
      season.weeks.forEach((wk, wIx) => {
        if (wIx + 1 < a.week) return;
        const t = wk.find((x) => x.r === a.rid);
        if (t && a.pid in (t.pp || {})) pts += t.pp[a.pid];
      });
      return { ...a, pts: Math.round(pts * 100) / 100 };
    }).sort((x, y) => y.pts - x.pts);
    for (const top of scored.slice(0, 3)) {
      const nm = (playersLite[top.pid] || `Player ${top.pid}|`).split("|")[0];
      waiverBests.push(`${year}: ${nm} added by ${franchiseName(top.rid)} Wk ${top.week} - ${top.pts} pts the rest of the season`);
    }
  }
} catch { /* transactions archive missing */ }

// attach per-season efficiency to standings rows
for (const seasonEntry of seasons) {
  const eff = effBySeasonRoster[seasonEntry.year];
  if (!eff) continue;
  for (const row of seasonEntry.standings) {
    const e = eff[row.rosterID];
    if (!e || !e.optimal) continue;
    const pct = Math.round((e.actual / e.optimal) * 1000) / 10;
    row.lineupEfficiency = `started ${Math.round(e.actual * 10) / 10} of an optimal ${Math.round(e.optimal * 10) / 10} (${pct}%), ${e.perfect} perfect week${e.perfect === 1 ? "" : "s"}, worst week: ${e.worst.left} pts left (Wk ${e.worst.week})`;
  }
}

// ---- upcoming draft order: Sleeper's if entered, else DERIVED from the
// last complete season per constitution 3.2 (picks 1-7 worst-first with
// fewer-points-better tiebreak; 8 = wildcard loser; 9/10 = 3rd-place game
// loser/winner; 11 = runner-up; 12 = champion) ----
let upcomingDraft = null;
try {
  const drafts = await get(`https://api.sleeper.app/v1/league/${currentLid}/drafts`);
  const d = drafts?.[0];
  if (d) {
    let slotByRoster = null;
    let source = "";
    try {
      const detail = await get(`https://api.sleeper.app/v1/draft/${d.draft_id}`);
      if (detail?.slot_to_roster_id && Object.keys(detail.slot_to_roster_id).length) {
        slotByRoster = {};
        for (const [slot, rid] of Object.entries(detail.slot_to_roster_id)) slotByRoster[rid] = parseInt(slot, 10);
        source = "Sleeper's entered draft order";
      }
    } catch { /* fall through to derivation */ }
    const lastComplete = seasons.filter((x) => x.standings?.length >= 12).sort((a, b) => b.year - a.year)[0];
    if (!slotByRoster && lastComplete) {
      const yr = lastComplete.year;
      const lid = Object.entries(matchupsArchive?.seasons || {}).find(([y]) => parseInt(y, 10) === yr)?.[1]?.leagueID;
      const bracket = lid ? await get(`https://api.sleeper.app/v1/league/${lid}/winners_bracket`) : [];
      const maxR = Math.max(...bracket.map((g) => g.r));
      const final = bracket.find((g) => g.r === maxR && g.p === 1) || bracket.find((g) => g.r === maxR && g.p == null);
      const third = bracket.find((g) => g.r === maxR && g.p === 3);
      const r1Games = bracket.filter((g) => g.r === 1);
      const slots = {};
      if (final) { slots[final.w] = 12; slots[final.l] = 11; }
      if (third) { slots[third.w] = 10; slots[third.l] = 9; }
      const recordOf = (rid) => lastComplete.standings.find((row) => row.rosterID === rid) || { w: 99, pf: 99999 };
      if (r1Games.length >= 2) {
        // six-team era (2026 amendment): two Wild Card losers take 7-8,
        // worse regular season record gets the earlier pick
        const losers = r1Games.map((g) => g.l).filter((x) => x != null)
          .sort((a, b) => recordOf(a).w - recordOf(b).w || recordOf(a).pf - recordOf(b).pf);
        if (losers[0] != null) slots[losers[0]] = 7;
        if (losers[1] != null) slots[losers[1]] = 8;
      } else if (r1Games[0]) {
        slots[r1Games[0].l] = 8; // five-team era: single wildcard loser
      }
      const playoffRosters = new Set(Object.keys(slots).map(Number));
      const nonPlayoff = lastComplete.standings
        .filter((row) => !playoffRosters.has(row.rosterID))
        .sort((a, b) => a.w - b.w || a.pf - b.pf); // worst first, fewer points = better pick
      nonPlayoff.forEach((row, i) => { slots[row.rosterID] = i + 1; });
      slotByRoster = slots;
      source = `derived from ${yr} results per constitution 3.2 (Sleeper order not yet entered - the commissioner enters it before the draft)`;
    }
    if (slotByRoster) {
      const order = {};
      for (const [rid, slot] of Object.entries(slotByRoster)) {
        order[`1.${String(slot).padStart(2, "0")}`] = `${(curNameByRoster[rid] || "Team " + rid).trim()} originally (${ownersByRoster[rid] || ""})`;
      }
      // annotate every pick line with its exact slot number (done first so
      // round1Slots below can state each slot's CURRENT holder)
      for (const rs of rosterSection) {
        rs.picks = (rs.picks || []).map((line) => {
          const m = line.match(/^(\d{4}) R(\d)(?: \(via (.+?)\))?$/);
          if (!m || m[1] !== String(nflState.season)) return line;
          const viaName = m[3];
          let origRoster = rs.rosterID;
          if (viaName) {
            const hit = Object.entries(curNameByRoster).find(([, n]) => (n || "").trim() === viaName.trim());
            if (hit) origRoster = parseInt(hit[0], 10);
          }
          const slot = slotByRoster[origRoster];
          return slot ? `${line} = pick ${m[2]}.${String(slot).padStart(2, "0")}` : line;
        });
      }
      // each round-1 slot: original team AND who holds it today
      const holderOfSlot = {};
      for (const rs of rosterSection) {
        for (const line of rs.picks || []) {
          const hm = line.match(/= pick 1\.(\d{2})$/);
          if (hm) holderOfSlot[`1.${hm[1]}`] = `${(rs.name || "").trim()} (${ownersByRoster[rs.rosterID] || ""})`;
        }
      }
      const round1Slots = {};
      for (const [slot, orig] of Object.entries(order).sort()) {
        const holder = holderOfSlot[slot];
        const origTeam = orig.split(" originally")[0];
        round1Slots[slot] = holder && !holder.startsWith(origTeam)
          ? `originally ${orig.replace(" originally", "")}; CURRENTLY HELD by ${holder} via trade`
          : `held by ${orig.replace(" originally", "")} (own pick, never traded)`;
      }
      let startLine = "not yet scheduled in Sleeper";
      try {
        const detail = await get(`https://api.sleeper.app/v1/draft/${d.draft_id}`);
        if (detail?.start_time) {
          startLine = new Date(detail.start_time).toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "full", timeStyle: "short" }) + " ET";
        }
      } catch { /* keep default */ }
      // the 1.13 compensatory pick (losers bracket prize) sits between
      // rounds 1 and 2 and is settled by the LAST season's losers bracket
      let compPick = "1.13 (compensatory, between rounds 1 and 2): awarded to the Toilet Bowl (losers bracket) winner - holder unknown";
      let compPickMachine = null;
      try {
        if (lastComplete) {
          const lbLid = Object.entries(matchupsArchive?.seasons || {}).find(([y]) => parseInt(y, 10) === lastComplete.year)?.[1]?.leagueID;
          const lb = lbLid ? await get(`https://api.sleeper.app/v1/league/${lbLid}/losers_bracket`) : [];
          const lbMaxR = Math.max(...lb.map((g) => g.r));
          const lbFinal = lb.find((g) => g.r === lbMaxR && (g.p === 1 || g.p == null));
          if (lbFinal?.w != null) {
            const holderName = (curNameByRoster[lbFinal.w] || "Team " + lbFinal.w).trim();
            compPick = `1.13 (compensatory, between rounds 1 and 2): held by ${holderName} (${ownersByRoster[lbFinal.w] || ""}) - won the ${lastComplete.year} Toilet Bowl (losers bracket). Fully tradable; the only Toilet Bowl prize since 2025-26. NOT tracked in Sleeper - the commissioner inserts it manually on draft day.`;
            compPickMachine = {
              pick: "1.13",
              season: nflState.season,
              holderRosterID: lbFinal.w,
              holderName,
              holderOwner: ownersByRoster[lbFinal.w] || "",
              wonYear: lastComplete.year,
            };
          }
        }
      } catch { /* bracket unavailable */ }
      if (compPickMachine) {
        round1Slots["1.13"] = `COMPENSATORY - held by ${compPickMachine.holderName} (${compPickMachine.holderOwner}), won the ${compPickMachine.wonYear} Toilet Bowl. Not tracked in Sleeper.`;
        const holderSection = rosterSection.find((rs) => rs.rosterID === compPickMachine.holderRosterID);
        if (holderSection) holderSection.picks = [...(holderSection.picks || []), `${nflState.season} 1.13 (compensatory - ${compPickMachine.wonYear} Toilet Bowl winner; not in Sleeper)`];
      }
      // a COMPLETE draft reads as results, not holdings - "who holds 1.11"
      // is a nonsense question once the pick became a player
      let draftResults = null;
      if (d.status === "complete") {
        try {
          const dpicks = await get(`https://api.sleeper.app/v1/draft/${d.draft_id}/picks`);
          draftResults = {};
          for (const pk of dpicks || []) {
            const slot = `${pk.round}.${String(pk.draft_slot).padStart(2, "0")}`;
            const who = `${pk.metadata?.first_name || ""} ${pk.metadata?.last_name || ""}`.trim();
            draftResults[slot] = `${who} (${pk.metadata?.position || "?"}) - drafted by ${(curNameByRoster[pk.roster_id] || "roster " + pk.roster_id).trim()} (${(ownersByRoster[pk.roster_id] || "").split(" (")[0]})`;
          }
        } catch { /* board unavailable - keep slot view */ }
      }
      upcomingDraft = {
        year: nflState.season,
        status: d.status,
        statusNote: d.status === "complete"
          ? "THIS DRAFT IS COMPLETE. Every " + nflState.season + " pick was used - nobody 'holds' " + nflState.season + " picks anymore. results below shows exactly who was selected at each slot and by whom. For 'which pick did X trade away' questions: name the slot AND the player it became, from results."
          : "Draft not yet held - round1Slots shows current pick ownership.",
        startTime: startLine,
        compPick113: compPick,
        compPick: compPickMachine,
        results: draftResults,
        appendixNote: "In Appendix A's 2025 results, round-1 entries are numbered 1-13; entry 13 IS pick 1.13 (that year's compensatory pick).",
        format: `${d.type}, ${d.settings?.rounds || 4} rounds`,
        note: "AUTHORITATIVE pick ownership: round1Slots states each slot's current holder, and every roster's picks list shows exact slots. Never re-derive ownership from traded_picks or trade history. Order source: " + source,
        round1Slots: draftResults ? undefined : round1Slots,
        slotByOriginalRoster: slotByRoster,
      };
    }
  }
} catch { /* draft data unavailable - picks stay unannotated */ }

const knowledge = {
  generated: new Date().toISOString(),
  upcomingDraft,
  benchBlunders,
  bestWaiverAdds: waiverBests,
  leagueID: rivalry.leagueID,
  bylaws,
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
  leagueChain: Object.values(matchupsArchive?.seasons || {}).map((x) => x.leagueID).concat([currentLid]),
  rosterNames: curNameByRoster,
  ownersByRoster,
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
