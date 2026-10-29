/*
  The week's NFL slate for the Parlay Builder: who plays when, who's on a bye,
  and DraftKings' game lines (spread / total / moneyline) - all from ESPN's
  public scoreboard, whose odds provider is DraftKings. (DraftKings' own API
  403s datacenter traffic; ESPN's prop feed has lines but no prices, so
  player props are NOT priced.)

  Pure functions + two small fetchers. Shared by the cron bot and the instant
  Slack webhook. A missing/failed slate is always survivable: callers treat
  `slate === null` as "can't validate, can't price" and carry on.
*/
import { collectLegsDetailed, parlayOdds } from "./parlayCore.js";

export const LOCK_LEAD_MS = 15 * 60e3; // legs lock 15 minutes before the first game that has one

const num = (v) => {
  if (v == null || v === "") return null;
  const s = String(v).trim().toUpperCase();
  if (s === "EVEN" || s === "PK") return s === "EVEN" ? 100 : 0;
  const n = Number(s.replace(/^[OU]/, ""));
  return Number.isFinite(n) ? n : null;
};

export const parseSlate = (sb) => {
  if (!sb || !Array.isArray(sb.events)) return null;
  const teams = {}, games = [];
  const team = (x) => ({ abbr: x.abbreviation, name: x.name, city: x.location, display: x.displayName });
  for (const e of sb.events) {
    const c = e.competitions?.[0];
    const homeC = c?.competitors?.find((x) => x.homeAway === "home"), awayC = c?.competitors?.find((x) => x.homeAway === "away");
    if (!homeC || !awayC) continue;
    const home = team(homeC.team), away = team(awayC.team);
    teams[home.abbr] = home; teams[away.abbr] = away;
    const o = (c.odds || [])[0];
    const lines = { ml: {}, spread: {}, total: null };
    if (o) {
      lines.ml = { [home.abbr]: num(o.moneyline?.home?.close?.odds), [away.abbr]: num(o.moneyline?.away?.close?.odds) };
      lines.spread = {
        [home.abbr]: { line: num(o.pointSpread?.home?.close?.line), odds: num(o.pointSpread?.home?.close?.odds) },
        [away.abbr]: { line: num(o.pointSpread?.away?.close?.line), odds: num(o.pointSpread?.away?.close?.odds) },
      };
      const ov = o.total?.over?.close, un = o.total?.under?.close;
      if (ov?.line != null) lines.total = { line: num(ov.line), over: num(ov.odds), under: num(un?.odds) };
    }
    const score = { [home.abbr]: Number(homeC.score) || 0, [away.abbr]: Number(awayC.score) || 0 }; // live/final points (0-0 before kickoff)
    games.push({ id: e.id, kickoffMs: Date.parse(e.date), state: e.status?.type?.state || "pre", final: !!e.status?.type?.completed, score, home, away, lines });
  }
  const byes = new Set();
  for (const t of sb.week?.teamsOnBye || []) { const tt = team(t); teams[tt.abbr] = tt; byes.add(tt.abbr); }
  games.sort((a, b) => a.kickoffMs - b.kickoffMs);
  return { week: sb.week?.number ?? null, teams, byes, games, firstKickoffMs: games.length ? games[0].kickoffMs : null };
};

export const fetchSlate = async (week, fetchFn = fetch) => {
  try {
    const r = await fetchFn(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?seasontype=2${week ? `&week=${week}` : ""}`);
    if (!r.ok) return null;
    return parseSlate(await r.json());
  } catch { return null; }
};

// ── naming: which team(s) does a piece of text mention? ──────────────────────
const EXTRA = { NE: ["pats"], SF: ["niners", "49ers"], TB: ["bucs", "buccaneers"], ARI: ["cards"], MIA: ["fins"], JAX: ["jags"], MIN: ["vikes"], PHI: ["iggles"], WSH: ["washington football"], DAL: ["boys"] };
const AMBIGUOUS_CITY = new Set(["New York", "Los Angeles"]);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const teamsIn = (text, slate) => {
  const t = String(text || ""), found = new Set();
  if (!slate) return [];
  for (const tm of Object.values(slate.teams)) {
    const nick = [tm.name, tm.display, ...(EXTRA[tm.abbr] || [])].filter(Boolean).map(esc).join("|");
    if (new RegExp(`\\b(?:${nick})\\b`, "i").test(t)) found.add(tm.abbr);
    else if (tm.abbr.length === 3 && new RegExp(`\\b${tm.abbr}\\b`).test(t)) found.add(tm.abbr); // BUF, DAL (uppercase only)
    else if (tm.city && !AMBIGUOUS_CITY.has(tm.city) && new RegExp(`\\b(?:${esc(tm.city)}|${esc(tm.city.toLowerCase())})\\b(?!\\s+[A-Z][a-z])`).test(t)) found.add(tm.abbr); // "Dallas Goedert" is a player, not the Cowboys
  }
  const pair = t.match(/\b([A-Z]{2,3})\s*(?:\/|@|vs\.?)\s*([A-Z]{2,3})\b/); // NE/CHI, KC@SEA
  if (pair) for (const a of pair.slice(1, 3)) if (slate.teams[a]) found.add(a);
  return [...found];
};

// "Kyren Williams anytime td" → "Kyren Williams"; "Bills ML" → null (a team, not a player)
const PROP_WORDS = /^(?:anytime|any|first|last|1st|2nd|\d|over|under|o\d|u\d|to\b|[+-]?\d|rec|yards|yds|rushing|receiving|passing|longest|(?:one|two|three|four|five|six|a|an)\b|touchdowns?|tds?\b|catches|receptions?|completions|sacks?|ints?\b|interceptions?|points|made|fgs?\b|field|kicking|pats?\b|extra|xps?\b|tackles?)/i;
export const playerNameOf = (text, slate) => {
  const toks = String(text || "").trim().split(/\s+/);
  const isNameTok = (tk) => /^[A-Z](?:\.[A-Z])+\.?$/.test(tk) || (/^[A-Z][a-zA-Z'.-]*$/.test(tk) && /[a-z]/.test(tk)) // Kyren, McCaffrey, A.J. - not ML / TD / BUF
    || (/^[a-z][a-z'.-]+$/.test(tk) && !PROP_WORDS.test(fixTypos(tk)) && !/^(?:and|or|to|the|vs|at|plus|with|for|by|in|on|ml|ats|cover|covers|win|wins|over|under|total|and)$/.test(tk)); // lowercase names too: "Mathew golden", "gibbs"
  const name = [];
  for (const raw of toks) { // a comma ends the name: "Jared Goff, two passing touchdowns"
    const tk = raw.replace(/[,;:]+$/, "");
    if (isNameTok(tk) && !/^(?:anytime|any|first|last|over|under|to|rushing|receiving|passing|yards|touchdowns?|receptions)$/i.test(fixTypos(tk))) { name.push(tk); if (tk !== raw) break; } else break;
  }
  if (!name.length || name.length > 3) return null;
  if (!PROP_WORDS.test(fixTypos(toks.slice(name.length).join(" ")))) return null;
  if (/^(?:Take|Going|Give|Gimme|Put|Let|Lets|The|My|Our|Over|Under|Total|Both|Either|I|Im|I'm|We|Me|Bet|Hammer|Lock)$/i.test(name[0])) return null;
  if (slate) { // every word is a team word (Bills, Kansas City Chiefs) → a team leg. "Dallas Goedert" still has a non-team word.
    const words = new Set(Object.values(slate.teams).flatMap((x) => [x.display, x.name, x.city].filter(Boolean).flatMap((s) => s.toLowerCase().split(" "))));
    if (name.every((w) => words.has(w.toLowerCase()))) return null;
  }
  return name.join(" ");
};


// ── typos in the prop part of a leg ("Justin Jefferson a time td", "anytine touchdwon") ──
// Only ever applied to the words AFTER the player's name, so names are left alone.
export const fixTypos = (text) => String(text || "")
  .replace(/\b(?:any\s?-?\s?time|anytim|anytine|anytme|anytiem|anyime|anytyme|anytimr|anyt|nytime|a\s?time)\b/gi, "anytime")
  .replace(/\b(?:t[ou]{1,2}c?h?\s?d[aow]{1,3}[mnw]{0,2}s?|tuchdowns?|touchdwons?|touchdonws?|tocuhdowns?|touchdowms?|tochdowns?)\b/gi, (w) => (/s$/i.test(w) ? "touchdowns" : "touchdown"))
  .replace(/\b(?:frist|firts|fisrt|fist)\b/gi, "first")
  .replace(/\b(?:reci?e?v\w*|recv)\b/gi, (w) => (/^rec(?:eiving)?$/i.test(w) ? w : "receiving"))
  .replace(/\b(?:recpt\w*|recept\w*|recpetions?|receptons?)\b/gi, "receptions")
  .replace(/\b(?:pas+ing|passin|pasing)\b/gi, "passing")
  .replace(/\b(?:rushng|rusing|rushin)\b/gi, "rushing")
  .replace(/\b(?:yrds?|yardz|yeards?)\b/gi, "yards")
  .replace(/\b(?:tdz|tds?'s|td's)\b/gi, "tds");

const WORDNUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };

// "Derrick Henry 2+ touchdowns" → { stat: "tds", dir: "over", threshold: 2 }
// stat: tds | pass_tds | pass_yds | rush_yds | rec_yds | yds (rush+rec, unpriced) | receptions | first_td
// threshold = the number the player has to reach (over) or stay under (under: value < threshold)
export const parseProp = (leg, name) => {
  let t = String(leg || "").toLowerCase();
  const at = name ? t.indexOf(name.toLowerCase()) : -1;
  if (at >= 0) t = t.slice(at + name.length);
  t = fixTypos(t).toLowerCase().replace(/^[\s,;:-]+/, "").replace(/\b(one|two|three|four|five|six)\b/g, (w) => WORDNUM[w]).replace(/\b(?:an?)\b/g, "");
  const td = /\b(?:tds?|touchdowns?|scores?)\b/.test(t);
  let stat = null;
  if (/\b(?:first|1st)\b/.test(t) && td) stat = "first_td";
  else if (/\bpass(?:ing)?\b/.test(t) && td) stat = "pass_tds";
  else if (/\bpass(?:ing)?\b/.test(t) && /\b(?:yds?|yards?)\b/.test(t)) stat = "pass_yds";
  else if (/\brush(?:ing)?\b/.test(t) && /\b(?:yds?|yards?)\b/.test(t)) stat = "rush_yds";
  else if (/\b(?:rec|receiving)\b/.test(t) && /\b(?:yds?|yards?)\b/.test(t)) stat = "rec_yds";
  else if (/\b(?:yds?|yards?)\b/.test(t)) stat = "yds";
  else if (/\b(?:receptions?|catches|recs?)\b/.test(t)) stat = "receptions";
  else if (/\b(?:fgs?|field ?goals?)\b/.test(t)) stat = "fgs";
  else if (/\bkicking\b/.test(t) && /\bpo?i?n?ts?\b|\bpoints?\b/.test(t)) stat = "kick_pts";
  else if (/\bsacks?\b/.test(t)) stat = "sacks";
  else if (/\btackles?\b/.test(t)) stat = "tackles";
  else if (td) stat = "tds";
  if (!stat) return null;
  const under = t.match(/\b(?:under|u)\s?(\d+(?:\.\d+)?)/);
  if (under) return { stat, dir: "under", threshold: Number(under[1]), point: Number(under[1]) };
  const over = t.match(/\b(?:over|o)\s?(\d+(?:\.\d+)?)/);
  const plus = t.match(/(\d+)\s?\+/);
  const bare = t.match(/\b(\d+(?:\.\d+)?)\b/);
  let threshold = 1;
  if (over) { const n = Number(over[1]); threshold = Number.isInteger(n) ? n + 1 : Math.ceil(n); }
  else if (plus) threshold = Number(plus[1]);
  else if (bare) threshold = Math.ceil(Number(bare[1]));
  if (stat === "first_td") threshold = 1;
  return { stat, dir: "over", threshold, point: threshold - 0.5 };
};


// how the bot read a prop, for the board ("→ anytime TD · MIN")
export const propLabel = (p) => {
  if (!p) return null;
  const n = p.dir === "under" ? `under ${p.point}` : `${p.threshold}+`;
  return { tds: p.threshold <= 1 ? "anytime TD" : `${p.threshold}+ TDs`, first_td: "first TD of the game", pass_tds: `${n} passing TDs`, pass_yds: `${n} passing yds`, rush_yds: `${n} rushing yds`, rec_yds: `${n} receiving yds`, yds: `${n} scrimmage yds`, receptions: `${n} catches`, fgs: `${n} made FGs`, kick_pts: `${n} kicking pts`, sacks: `${n} sacks`, tackles: `${n} tackles` }[p.stat] || null;
};

// ESPN player search → team abbr. A full name must match exactly; a lone surname
// matches any active player with it. ESPN lists the most prominent player first
// (two Justin Jeffersons, two Gibbs), and a fantasy league means that one, so
// the top match wins. null = no match or the lookup failed.
export const resolvePlayerTeam = async (name, fetchFn = fetch) => {
  try {
    const r = await fetchFn(`https://site.web.api.espn.com/apis/common/v3/search?query=${encodeURIComponent(name)}&limit=6&type=player&sport=football&league=nfl`);
    if (!r.ok) return null;
    const items = ((await r.json()).items || []).filter((i) => i.league === "nfl" && i.teamRelationships?.[0]?.core?.abbreviation);
    const norm = (x) => String(x).toLowerCase().replace(/[.']/g, "");
    const want = norm(name);
    const hit = items.find((i) => (name.includes(" ") ? norm(i.displayName) === want : norm(i.displayName).split(" ").pop() === want));
    if (hit) return hit.teamRelationships[0].core.abbreviation;
    if (name.includes(" ")) return await resolveMisspelt(name, fetchFn); // "Mathew Golden" → Matthew Golden
    return null;
  } catch { return null; }
};
// edit distance, for misspelt names
export const editDistance = (a, b) => {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
};
// ESPN's search wants the spelling right, so a misspelt full name finds nothing. Search each half of
// the name on its own and take the player whose full name is within a couple of letters of what was typed.
const resolveMisspelt = async (name, fetchFn) => {
  const norm = (x) => String(x).toLowerCase().replace(/[.']/g, "");
  const want = norm(name), parts = want.split(" ");
  const seen = new Map();
  for (const q of [parts.slice(1).join(" "), parts[0]]) {
    const r = await fetchFn(`https://site.web.api.espn.com/apis/common/v3/search?query=${encodeURIComponent(q)}&limit=10&type=player&sport=football&league=nfl`);
    if (!r.ok) continue;
    for (const i of (await r.json()).items || []) if (i.league === "nfl" && i.teamRelationships?.[0]?.core?.abbreviation) seen.set(i.displayName, i.teamRelationships[0].core.abbreviation);
  }
  const ranked = [...seen].map(([n, abbr]) => ({ abbr, dist: editDistance(norm(n), want) })).filter((x) => x.dist <= Math.max(2, Math.floor(want.length / 6))).sort((a, b) => a.dist - b.dist);
  return ranked.length && (ranked.length === 1 || ranked[0].dist < ranked[1].dist) ? ranked[0].abbr : null; // two equally close → don't guess
};

// ── one leg → which game is it in, is it playable, what's it pay ──────────────
// playerTeams: { "kyren williams": "LAR" | null } from resolvePlayerTeam
export const analyzeLeg = (leg, slate, { playerTeams = {}, atMs = null } = {}) => {
  const none = { kind: "unknown", name: null, teams: [], game: null, problem: null, reason: null };
  if (!slate) return none;
  const name = playerNameOf(leg, slate);
  const teams = name ? (playerTeams[name.toLowerCase()] ? [playerTeams[name.toLowerCase()]] : []) : teamsIn(leg, slate);
  const kind = name ? "player" : teams.length ? "team" : "unknown";
  const out = { ...none, kind, name, teams };
  if (!teams.length) return out;
  const wk = slate.week ? `Week ${slate.week}` : "this week";
  if (teams.every((a) => slate.byes.has(a))) { // every team named is off this week (a mix of bye + playing is left alone)
    const names = teams.map((a) => slate.teams[a].name);
    const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0];
    return { ...out, problem: "bye", reason: `${name ? `${name}'s team, the ${list}, is` : `The ${list} are`} on a bye in ${wk}` };
  }
  const game = slate.games.find((g) => teams.every((a) => g.home.abbr === a || g.away.abbr === a)) || (teams.length === 1 ? null : slate.games.find((g) => teams.some((a) => g.home.abbr === a || g.away.abbr === a)));
  out.game = game || null;
  if (!game) return out;
  if (atMs != null && game.kickoffMs - LOCK_LEAD_MS <= atMs) {
    return { ...out, problem: "closed", reason: `${game.away.name} @ ${game.home.name} ${game.kickoffMs <= atMs ? "has already kicked off" : "is within 15 minutes of kickoff"}, so that game is closed for legs` };
  }
  return out;
};

// DraftKings price (American) for a game-line leg; null for props / alt lines / anything we can't match exactly
export const priceLeg = (leg, slate, info) => {
  if (!slate || !info || info.kind !== "team" || !info.game) return null;
  const g = info.game, L = g.lines, t = String(leg || "");
  const side = info.teams.length === 1 ? info.teams[0] : null;
  const numIn = t.match(/(?:^|[\s(])([+-]?\d+(?:\.\d+)?)(?=\s|$|\))/);
  const isTotal = /\b(over|under|o\/u|total)\b/i.test(t) || /\b[ou]\d+(\.\d+)?\b/i.test(t);
  if (isTotal && L.total) {
    const line = numIn ? Number(numIn[1]) : L.total.line;
    if (line !== L.total.line) return null;
    const price = /\bunder\b|\bu\d/i.test(t) ? L.total.under : L.total.over;
    return price == null ? null : { american: price, market: "total", line };
  }
  if (!side) return null;
  if (/\b(ML|money\s?line|to win|wins?|win outright)\b/i.test(t) && !/\bby\b/i.test(t) && !/[+-]\d+(\.\d)\b/.test(t)) {
    return L.ml[side] == null ? null : { american: L.ml[side], market: "ML" };
  }
  const sp = L.spread[side];
  if (!sp || sp.odds == null) return null;
  if (/\b(cover|covers|ats|spread)\b/i.test(t) && !/[+-]\s?\d/.test(t)) return { american: sp.odds, market: "spread", line: sp.line };
  const m = t.match(/(?:^|\s)([+-]\s?\d+(?:\.\d+)?)(?=\s|$)/);
  if (m && Number(m[1].replace(/\s/g, "")) === sp.line) return { american: sp.odds, market: "spread", line: sp.line };
  return null; // alt line, team total, "by 10", etc.
};

// When do legs lock? 15 min before the earliest kickoff among the games the
// legs are in. A leg we can't place in a game counts as the week's first
// game (earlier is the safe side). No legs yet → the next game up.
export const lockTime = (infos, slate, nowMs = Date.now()) => {
  if (!slate || !slate.games.length) return null;
  const live = slate.games.filter((g) => g.state !== "post");
  const nextUp = live.find((g) => g.kickoffMs - LOCK_LEAD_MS > nowMs) || live[0] || slate.games[0];
  const kicks = infos.length ? infos.map((i) => (i.game ? i.game.kickoffMs : slate.firstKickoffMs)) : [nextUp.kickoffMs];
  return Math.min(...kicks) - LOCK_LEAD_MS;
};

export const priceLegs = (legs, slate, playerTeams = {}) => {
  const out = {};
  for (const [team, v] of Object.entries(legs)) {
    const info = analyzeLeg(v.leg, slate, { playerTeams });
    const p = priceLeg(v.leg, slate, info);
    const readAs = info.kind === "player" ? [propLabel(parseProp(v.leg, info.name)), info.teams[0]].filter(Boolean).join(" · ") || null : null;
    out[team] = { ...v, odds: slate ? (p ? p.american : null) : undefined, ...(readAs ? { readAs } : {}) };
  }
  return out;
};

// Everything the bot needs to know about a week's legs, in one call:
//  - resolves player names to teams (ESPN search, cached in `cache`)
//  - drops legs that can't be played (bye / game closed) into `rejected`
//  - works out when the week locks (lockMs) and, once that moment has passed,
//    ignores anything posted after it
const MISS_TTL_MS = 5 * 60e3;
const missCache = new WeakMap(); // player-cache Map → { name → when the lookup last came up empty }
const missesOf = (cache) => { if (!missCache.has(cache)) missCache.set(cache, new Map()); return missCache.get(cache); };
export const evaluateWeek = async ({ messages, replies = [], allTeams, teamOfUser, slate, nowMs = Date.now(), cache = new Map(), fetchFn = fetch }) => {
  const base = { messages, replies, allTeams, teamOfUser };
  if (!slate) return { ...collectLegsDetailed(base), lockMs: null, playerTeams: {}, slate: null, unplaced: [] };
  const names = new Set();
  collectLegsDetailed({ ...base, check: (leg) => { const n = playerNameOf(leg, slate); if (n) names.add(n.toLowerCase()); return null; } });
  const playerTeams = {};
  // A found team is cached for good. A miss (ESPN hiccup, or a name it doesn't know) is only remembered for
  // MISS_TTL_MS: caching it forever would pin the lock to Thursday night for the rest of the server's life.
  const miss = missesOf(cache);
  await Promise.all([...names].map(async (n) => {
    if (!cache.get(n) && !(miss.has(n) && nowMs - miss.get(n) < MISS_TTL_MS)) {
      const abbr = await resolvePlayerTeam(n.replace(/\b\w/g, (c) => c.toUpperCase()), fetchFn);
      if (abbr) { cache.set(n, abbr); miss.delete(n); } else miss.set(n, nowMs);
    }
    playerTeams[n] = cache.get(n) ?? null;
  }));
  const check = (leg, atMs) => analyzeLeg(leg, slate, { playerTeams, atMs }).reason;
  const lockOf = (legs) => lockTime(Object.values(legs).map((v) => analyzeLeg(v.leg, slate, { playerTeams })), slate, nowMs);
  let res = collectLegsDetailed({ ...base, check });
  let lockMs = lockOf(res.legs);
  if (lockMs != null && nowMs >= lockMs) { res = collectLegsDetailed({ ...base, check, beforeMs: lockMs }); lockMs = lockOf(res.legs) ?? lockMs; } // after the lock: late posts never count
  // legs we can't place in any game: each one holds the lock at the week's first kickoff, so say so
  const unplaced = Object.entries(res.legs).filter(([, v]) => !analyzeLeg(v.leg, slate, { playerTeams }).teams.length).map(([team, v]) => ({ team, leg: v.leg }));
  return { ...res, lockMs, playerTeams, slate, unplaced };
};
export { parlayOdds };
