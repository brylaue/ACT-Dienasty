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

const knowledge = {
  generated: new Date().toISOString(),
  league: "ACT, or DIE. - 12-team superflex dynasty fantasy football league, hosted on Sleeper. Founded MID-SEASON 2018, so 2018 is a partial season with a shortened schedule. Franchises persist by roster across seasons even as team names change year to year - each franchise entry lists its former names (e.g. the franchise now called 'TDs in Your Face' won the 2018 title under the name 'mcmath15').",
  seasons: seasons.map(({ _owners, _names, ...rest }) => rest),
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
