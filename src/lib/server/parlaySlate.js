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
    games.push({ id: e.id, kickoffMs: Date.parse(e.date), state: e.status?.type?.state || "pre", home, away, lines });
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
const PROP_WORDS = /^(?:anytime|any|first|last|1st|2nd|\d|over|under|o\d|u\d|to\b|[+-]?\d|rec|yards|yds|rushing|receiving|passing|longest|(?:one|two|three|four|five|six|a|an)\b|touchdowns?|tds?\b|catches|receptions?|completions|sacks?|ints?\b|interceptions?|points)/i;
export const playerNameOf = (text, slate) => {
  const toks = String(text || "").trim().split(/\s+/);
  const isNameTok = (tk) => /^[A-Z](?:\.[A-Z])+\.?$/.test(tk) || (/^[A-Z][a-zA-Z'.-]*$/.test(tk) && /[a-z]/.test(tk)); // Kyren, McCaffrey, A.J. - not ML / TD / BUF
  const name = [];
  for (const raw of toks) { // a comma ends the name: "Jared Goff, two passing touchdowns"
    const tk = raw.replace(/[,;:]+$/, "");
    if (isNameTok(tk) && !/^(?:anytime|any|first|last|over|under|to|rushing|receiving|passing|yards)$/i.test(tk)) { name.push(tk); if (tk !== raw) break; } else break;
  }
  if (!name.length || name.length > 3) return null;
  if (!PROP_WORDS.test(toks.slice(name.length).join(" "))) return null;
  if (/^(?:Take|Going|Give|Gimme|Put|Let|Lets|The|My|Our|Over|Under|Total|Both|Either)$/.test(name[0])) return null;
  if (slate) { // every word is a team word (Bills, Kansas City Chiefs) → a team leg. "Dallas Goedert" still has a non-team word.
    const words = new Set(Object.values(slate.teams).flatMap((x) => [x.display, x.name, x.city].filter(Boolean).flatMap((s) => s.toLowerCase().split(" "))));
    if (name.every((w) => words.has(w.toLowerCase()))) return null;
  }
  return name.join(" ");
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
    return hit ? hit.teamRelationships[0].core.abbreviation : null;
  } catch { return null; }
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
    const p = priceLeg(v.leg, slate, analyzeLeg(v.leg, slate, { playerTeams }));
    out[team] = { ...v, odds: slate ? (p ? p.american : null) : undefined };
  }
  return out;
};

// Everything the bot needs to know about a week's legs, in one call:
//  - resolves player names to teams (ESPN search, cached in `cache`)
//  - drops legs that can't be played (bye / game closed) into `rejected`
//  - works out when the week locks (lockMs) and, once that moment has passed,
//    ignores anything posted after it
export const evaluateWeek = async ({ messages, replies = [], allTeams, teamOfUser, slate, nowMs = Date.now(), cache = new Map(), fetchFn = fetch }) => {
  const base = { messages, replies, allTeams, teamOfUser };
  if (!slate) return { ...collectLegsDetailed(base), lockMs: null, playerTeams: {}, slate: null };
  const names = new Set();
  collectLegsDetailed({ ...base, check: (leg) => { const n = playerNameOf(leg, slate); if (n) names.add(n.toLowerCase()); return null; } });
  const playerTeams = {};
  await Promise.all([...names].map(async (n) => {
    if (!cache.has(n)) cache.set(n, await resolvePlayerTeam(n.replace(/\b\w/g, (c) => c.toUpperCase()), fetchFn));
    playerTeams[n] = cache.get(n);
  }));
  const check = (leg, atMs) => analyzeLeg(leg, slate, { playerTeams, atMs }).reason;
  const lockOf = (legs) => lockTime(Object.values(legs).map((v) => analyzeLeg(v.leg, slate, { playerTeams })), slate, nowMs);
  let res = collectLegsDetailed({ ...base, check });
  let lockMs = lockOf(res.legs);
  if (lockMs != null && nowMs >= lockMs) { res = collectLegsDetailed({ ...base, check, beforeMs: lockMs }); lockMs = lockOf(res.legs) ?? lockMs; } // after the lock: late posts never count
  return { ...res, lockMs, playerTeams, slate };
};
export { parlayOdds };
