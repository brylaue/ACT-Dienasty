/*
  Player props for the Parlay Builder: what a prop leg actually asks for
  (parseProp - shared with grading), and its price from The Odds API
  (free tier: 500 credits/month - https://the-odds-api.com).

  Credit budget: one event-odds call costs (markets requested) credits, so a
  prop is priced ONCE - when its leg first lands - and the price is carried
  forward in the pinned board's text ("(+140)"). A prop the books haven't
  posted yet shows "(no line)" and is retried only at the lock and once a
  day, never on every board refresh. A normal week is ~20-40 credits.
  No ODDS_API_KEY → props stay "n/a", exactly as before.
*/
import { analyzeLeg, parseProp } from "./parlaySlate.js";
export { parseProp }; // lives in parlaySlate (the board needs it too); re-exported for grading/tests

const norm = (s) => String(s || "").toLowerCase().replace(/[.']/g, "").replace(/\s+(?:jr|sr|ii|iii|iv)$/, "").trim();

// ── The Odds API ─────────────────────────────────────────────────────────
const BASE = "https://api.the-odds-api.com/v4/sports/americanfootball_nfl";
const BOOKS = ["draftkings", "fanduel", "betmgm", "williamhill_us"]; // DraftKings first; the others only fill gaps
const MARKETS = {
  tds: (p) => (p.threshold <= 1 ? ["player_anytime_td"] : ["player_tds_over"]),
  first_td: () => ["player_1st_td"],
  pass_tds: () => ["player_pass_tds", "player_pass_tds_alternate"],
  pass_yds: () => ["player_pass_yds", "player_pass_yds_alternate"],
  rush_yds: () => ["player_rush_yds", "player_rush_yds_alternate"],
  rec_yds: () => ["player_reception_yds", "player_reception_yds_alternate"],
  receptions: () => ["player_receptions", "player_receptions_alternate"],
  fgs: () => ["player_field_goals"],
  kick_pts: () => ["player_kicking_points"],
  sacks: () => ["player_sacks"],
  tackles: () => ["player_tackles_assists"],
};
export const marketsFor = (prop) => (prop && MARKETS[prop.stat] ? MARKETS[prop.stat](prop) : []);

// the matching price in an event-odds response; DraftKings preferred
export const findPropPrice = (eventOdds, playerName, prop) => {
  const want = norm(playerName), surnameOnly = !want.includes(" ");
  const nameOk = (d) => { const n = norm(d); return surnameOnly ? n.split(" ").pop() === want : n === want; };
  const markets = marketsFor(prop);
  const rank = (k) => (BOOKS.includes(k) ? BOOKS.indexOf(k) : 99);
  const books = [...(eventOdds?.bookmakers || [])].sort((a, b) => rank(a.key) - rank(b.key));
  for (const bk of books) {
    for (const mk of markets) {
      const m = (bk.markets || []).find((x) => x.key === mk);
      if (!m) continue;
      const hit = (m.outcomes || []).find((o) => nameOk(o.description) && (
        prop.dir === "under" ? o.name === "Under" && o.point === prop.point
          : o.name === "Yes" || (o.name === "Over" && (o.point == null || o.point === prop.point))
      ));
      if (hit && Number.isFinite(hit.price)) return { american: hit.price, book: bk.key, market: mk };
    }
  }
  return null;
};

let eventsCache = { at: 0, list: null };
const getEvents = async (apiKey, fetchFn) => {
  if (eventsCache.list && Date.now() - eventsCache.at < 30 * 60e3) return eventsCache.list;
  const r = await fetchFn(`${BASE}/events?apiKey=${encodeURIComponent(apiKey)}`); // the events list is free (0 credits)
  if (!r.ok) throw new Error(`odds events ${r.status}`);
  eventsCache = { at: Date.now(), list: await r.json() };
  return eventsCache.list;
};
const eventFor = (events, game) => (events || []).find((e) =>
  e.home_team === game.home.display && e.away_team === game.away.display && Math.abs(Date.parse(e.commence_time) - game.kickoffMs) < 36 * 3600e3);

// the odds tags on an existing board/slip: { team: { leg, tag } } - the
// persistent price cache (no database: the pinned message carries it)
export const pricesFromBoard = (text) => {
  const out = {};
  for (const line of String(text || "").split("\n")) {
    const m = line.replace(/ _→ [^_]*_$/, "").match(/^• \*(.+?)\* — (.+) \(([^()]*)\)$/);
    if (m) out[m[1]] = { leg: m[2], tag: m[3] };
  }
  return out;
};
const tagValue = (tag) => (tag === "no line" ? "noline" : /^[+-]?\d+$/.test(String(tag).replace("−", "-")) ? Number(String(tag).replace("−", "-")) : null);

/*
  Fill in odds for player-prop legs. legs: { team: { leg, odds, ... } } as
  priceLegs returns them (props come back null). Returns a new legs object.
   prior      pricesFromBoard(current board text) - reused when the leg is unchanged
   retry      true → also re-ask for props that showed "(no line)" (lock time / daily)
   log        optional (msg) => void
*/
export const pricePropLegs = async (legs, { slate, playerTeams = {}, prior = {}, apiKey = "", retry = false, nowMs = Date.now(), fetchFn = fetch, log = () => {} } = {}) => {
  const out = { ...legs };
  if (!slate) return out;
  const todo = []; // { team, name, prop, game }
  for (const [team, v] of Object.entries(legs)) {
    if (v.odds != null) continue; // a game line already priced it
    const info = analyzeLeg(v.leg, slate, { playerTeams });
    if (info.kind !== "player") continue;
    const p = prior[team];
    const was = p && p.leg === v.leg ? tagValue(p.tag) : null;
    if (typeof was === "number") { out[team] = { ...v, odds: was }; continue; }
    const prop = parseProp(v.leg, info.name);
    if (!prop || !marketsFor(prop).length || !info.game) { out[team] = { ...v, odds: null }; continue; }
    if (was === "noline" && !retry) { out[team] = { ...v, odds: "noline" }; continue; }
    if (info.game.state !== "pre" || info.game.kickoffMs <= nowMs) { out[team] = { ...v, odds: was ?? null }; continue; } // props come off the board at kickoff
    todo.push({ team, name: info.name, prop, game: info.game });
  }
  if (!todo.length || !apiKey) return out;
  let events;
  try { events = await getEvents(apiKey, fetchFn); } catch (e) { log(`prop odds unavailable: ${e.message}`); return out; }
  const byEvent = new Map();
  for (const x of todo) {
    const ev = eventFor(events, x.game);
    if (!ev) { out[x.team] = { ...legs[x.team], odds: "noline" }; continue; }
    if (!byEvent.has(ev.id)) byEvent.set(ev.id, []);
    byEvent.get(ev.id).push(x);
  }
  for (const [id, xs] of byEvent) {
    const markets = [...new Set(xs.flatMap((x) => marketsFor(x.prop)))];
    try {
      const r = await fetchFn(`${BASE}/events/${id}/odds?apiKey=${encodeURIComponent(apiKey)}&bookmakers=${BOOKS.join(",")}&markets=${markets.join(",")}&oddsFormat=american`);
      const left = Number(r.headers?.get?.("x-requests-remaining"));
      if (Number.isFinite(left)) log(`odds api: ${markets.length} credit(s) used, ${left} left this month`);
      if (!r.ok) throw new Error(`odds ${r.status}`);
      const data = await r.json();
      for (const x of xs) { const p = findPropPrice(data, x.name, x.prop); out[x.team] = { ...legs[x.team], odds: p ? p.american : "noline" }; }
      if (Number.isFinite(left) && left < 25) { log("odds api: under 25 credits left - stopping for this run"); break; }
    } catch (e) { log(`prop odds for event ${id} failed: ${e.message}`); }
  }
  return out;
};
