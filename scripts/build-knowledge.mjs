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

const rosterSection = curRosters.map((r) => {
  const taxi = new Set(r.taxi || []);
  const ir = new Set(r.reserve || []);
  const players = (r.players || []).map((id) => {
    const pl = allPlayers[id];
    const name = pl ? `${pl.first_name} ${pl.last_name}` : `Player ${id}`;
    const pos = pl?.position || "?";
    const d = draftedBy[id];
    const drafted = d ? `drafted ${d.year} R${d.round}` : "undrafted (free-agent pickup)";
    const flags = [taxi.has(id) ? "ON TAXI SQUAD" : null, ir.has(id) ? "IR" : null].filter(Boolean);
    return `${name} (${pos}, ${drafted}${flags.length ? ", " + flags.join(", ") : ""})`;
  });
  return { rosterID: r.roster_id, name: curNameByRoster[r.roster_id], players };
});

// owned future picks: default ownership adjusted by traded_picks
const draftRounds = curDrafts?.[0]?.settings?.rounds || 4;
const upcomingSeason = parseInt(curDrafts?.[0]?.season || new Date().getFullYear(), 10);
const preDraft = curDrafts?.[0]?.status !== "complete";
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

const knowledge = {
  generated: new Date().toISOString(),
  league: "ACT, or DIE. - 12-team superflex dynasty fantasy football league, hosted on Sleeper. Founded MID-SEASON 2018, so 2018 is a partial season with a shortened schedule. The rosters section lists every team's current players with position, ORIGINAL annual-draft round (used for taxi-squad claim costs per the constitution), TAXI SQUAD and IR flags, and the future draft picks each team owns. Franchises persist by roster across seasons even as team names change year to year - each franchise entry lists its former names (e.g. the franchise now called 'TDs in Your Face' won the 2018 title under the name 'mcmath15').",
  seasons: seasons.map(({ _owners, _names, ...rest }) => rest),
  rosters: rosterSection,
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
