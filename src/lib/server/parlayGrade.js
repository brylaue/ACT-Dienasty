/*
  Grading the week's slip as games finish. Inputs are the lock notice's text
  (the frozen slip), ESPN's scoreboard for that week (parseSlate: scores +
  state) and ESPN box scores for games with player legs. Pure functions
  except fetchBox. The cron bot posts the result in the lock notice's thread.

  Each leg → hit | miss | push | pending | manual (can't grade: vague prop,
  first-TD, a player with no stats, a leg we can't place in a game).
  The parlay → miss as soon as one leg misses; hit when every leg is decided
  hit/push and the placer didn't have to pick for anyone; otherwise open.
*/
import { analyzeLeg } from "./parlaySlate.js";
import { parseProp } from "./parlayProps.js";

const norm = (s) => String(s || "").toLowerCase().replace(/[.']/g, "").replace(/\s+(?:jr|sr|ii|iii|iv)$/, "").trim();

// "🔒 *Week 7 legs are locked* — 6/12 in. ...\n• *Title Chase* — Derrick Henry 2+ touchdowns (n/a)\n..."
export const parseSlipNotice = (text) => {
  const t = String(text || "");
  const wk = t.match(/Week (\d+) legs are locked/i);
  if (!wk) return null;
  const legs = [];
  for (const line of t.split("\n")) {
    const m = line.match(/^• \*(.+?)\* — (.+)$/);
    if (!m) continue;
    const leg = m[2].replace(/ _→ [^_]*_$/, "").replace(/\s\((?:[+\-−]?\d+|n\/a|no line)\)$/, "").trim(); // drop the "how we read it" note and the odds tag
    legs.push({ team: m[1], leg });
  }
  const picks = t.match(/_Placer picks for: (.+?)\._/);
  return { week: Number(wk[1]), legs, placerPicks: picks ? picks[1].split(/,\s*/) : [] };
};

// ESPN summary → { state, final, players: { normName: { team, passTd, passYds, rushTd, rushYds, rec, recYds, recTd, retTd, defTd } } }
export const parseBox = (summary) => {
  const st = summary?.header?.competitions?.[0]?.status?.type || {};
  const players = {};
  const col = (s, key) => (s.keys || []).indexOf(key);
  for (const side of summary?.boxscore?.players || []) {
    const team = side.team?.abbreviation;
    for (const s of side.statistics || []) {
      for (const a of s.athletes || []) {
        const n = norm(a.athlete?.displayName);
        if (!n) continue;
        const p = (players[n] ||= { name: a.athlete.displayName, team, passTd: 0, passYds: 0, rushTd: 0, rushYds: 0, rec: 0, recYds: 0, recTd: 0, retTd: 0, defTd: 0, fgm: 0, kickPts: 0, sacks: 0, tackles: 0 });
        const v = (key) => { const i = col(s, key); return i < 0 ? 0 : Number(a.stats?.[i]) || 0; };
        if (s.name === "passing") { p.passTd += v("passingTouchdowns"); p.passYds += v("passingYards"); }
        if (s.name === "rushing") { p.rushTd += v("rushingTouchdowns"); p.rushYds += v("rushingYards"); }
        if (s.name === "receiving") { p.rec += v("receptions"); p.recYds += v("receivingYards"); p.recTd += v("receivingTouchdowns"); }
        if (s.name === "kickReturns") p.retTd += v("kickReturnTouchdowns");
        if (s.name === "puntReturns") p.retTd += v("puntReturnTouchdowns");
        if (s.name === "interceptions") p.defTd += v("interceptionTouchdowns");
        if (s.name === "defensive") { p.defTd += v("defensiveTouchdowns"); p.sacks += v("sacks"); p.tackles += v("totalTackles"); }
        if (s.name === "kicking") { const i = col(s, "fieldGoalsMade/fieldGoalAttempts"); p.fgm += i < 0 ? 0 : Number(String(a.stats?.[i] || "0").split("/")[0]) || 0; p.kickPts += v("totalKickingPoints"); }
      }
    }
  }
  // the game's first touchdown: "Jameson Williams 16 Yd pass from Jared Goff (Jake Bates Kick)" → Jameson Williams
  const firstTd = (summary?.scoringPlays || []).find((p) => /touchdown/i.test(p.type?.text || p.scoringType?.name || ""));
  const firstTdBy = firstTd ? norm((firstTd.text || "").match(/^(.+?)\s+\d+\s+Yd/i)?.[1] || (firstTd.text || "").split(" (")[0]) : null;
  return { state: st.state || "pre", final: !!st.completed, players, firstTdBy };
};

export const fetchBox = async (gameId, fetchFn = fetch) => {
  try {
    const r = await fetchFn(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${gameId}`);
    return r.ok ? parseBox(await r.json()) : null;
  } catch { return null; }
};

const STAT = {
  tds: (p) => p.rushTd + p.recTd + p.retTd + p.defTd, // "anytime TD" = scored one; a QB's passing TDs don't count
  pass_tds: (p) => p.passTd, pass_yds: (p) => p.passYds, rush_yds: (p) => p.rushYds, rec_yds: (p) => p.recYds,
  yds: (p) => p.rushYds + p.recYds, receptions: (p) => p.rec,
  fgs: (p) => p.fgm, kick_pts: (p) => p.kickPts, sacks: (p) => p.sacks, tackles: (p) => p.tackles,
};
const UNIT = { tds: "TD", pass_tds: "passing TD", pass_yds: "passing yd", rush_yds: "rushing yd", rec_yds: "receiving yd", yds: "scrimmage yd", receptions: "catch", fgs: "made FG", kick_pts: "kicking pt", sacks: "sack", tackles: "tackle" };
const plural = (n, u) => `${n} ${u}${n === 1 ? "" : u.endsWith("h") ? "es" : "s"}`;
const scoreLine = (g) => `${g.away.abbr} ${g.score[g.away.abbr]}-${g.score[g.home.abbr]} ${g.home.abbr}${g.final ? ", final" : ""}`;

const findPlayer = (box, name, team) => {
  if (!box) return null;
  const want = norm(name), all = Object.values(box.players);
  const pool = team ? all.filter((p) => p.team === team) : all;
  const exact = pool.find((p) => norm(p.name) === want);
  if (exact) return exact;
  if (!want.includes(" ")) { const s = pool.filter((p) => norm(p.name).split(" ").pop() === want); if (s.length === 1) return s[0]; }
  return null;
};

// one leg → { status, note }
export const gradeLeg = (leg, slate, { boxes = {}, playerTeams = {} } = {}) => {
  const info = analyzeLeg(leg, slate, { playerTeams });
  if (!info.game) return { status: "manual", note: "couldn't match it to a game" };
  const g = info.game;
  if (g.state === "pre") return { status: "pending", note: `${g.away.abbr} @ ${g.home.abbr} hasn't kicked off` };
  const t = String(leg);

  if (info.kind === "player") {
    const prop = parseProp(t, info.name);
    const box = boxes[g.id];
    if (prop?.stat === "first_td") {
      if (!box) return { status: "pending", note: "box score not in yet" };
      if (box.firstTdBy) { const want = norm(info.name), by = box.firstTdBy; const mine = by === want || (!want.includes(" ") && by.split(" ").pop() === want) || (want.includes(" ") && by.split(" ").pop() === want.split(" ").pop() && by[0] === want[0]); return { status: mine ? "hit" : "miss", note: `first TD: ${by.replace(/\b\w/g, (c) => c.toUpperCase())}` }; }
      return box.final ? { status: "miss", note: "no touchdowns in the game" } : { status: "pending", note: "no TD yet" };
    }
    if (!prop || !STAT[prop.stat]) return { status: "manual", note: "can't read this prop" };
    if (!box) return { status: "pending", note: "box score not in yet" };
    const p = findPlayer(box, info.name, info.teams[0]);
    if (!p) return box.final ? { status: "manual", note: `no stats for ${info.name} (inactive?)` } : { status: "pending", note: `${info.name} hasn't recorded a stat yet` };
    const val = STAT[prop.stat](p), u = UNIT[prop.stat];
    const done = box.final || g.final;
    if (prop.dir === "under") {
      if (val >= prop.threshold) return { status: "miss", note: plural(val, u) };
      return done ? { status: "hit", note: plural(val, u) } : { status: "pending", note: `${plural(val, u)} so far` };
    }
    if (val >= prop.threshold) return { status: "hit", note: plural(val, u) };
    return done ? { status: "miss", note: plural(val, u) } : { status: "pending", note: `${plural(val, u)} so far` };
  }

  // team legs: total / moneyline / spread - decided at the final whistle
  const total = g.score[g.home.abbr] + g.score[g.away.abbr];
  const numIn = t.match(/(?:^|[\s(])([ou]?)(\d+(?:\.\d+)?)(?=\s|$|\))/i);
  if (/\b(over|under|o\/u|total)\b/i.test(t) || /\b[ou]\d+(\.\d+)?\b/i.test(t)) {
    const line = numIn ? Number(numIn[2]) : g.lines?.total?.line;
    if (line == null) return { status: "manual", note: "no total line to grade against" };
    const under = /\bunder\b|\bu\d/i.test(t);
    if (!under && total > line) return { status: "hit", note: scoreLine(g) };
    if (under && total > line) return { status: "miss", note: scoreLine(g) };
    if (!g.final) return { status: "pending", note: scoreLine(g) };
    return { status: total === line ? "push" : under ? "hit" : "miss", note: scoreLine(g) };
  }
  const side = info.teams.length === 1 ? info.teams[0] : null;
  if (!side) return { status: "manual", note: "can't tell which side" };
  const other = side === g.home.abbr ? g.away.abbr : g.home.abbr;
  if (!g.final) return { status: "pending", note: scoreLine(g) };
  const margin = g.score[side] - g.score[other];
  if (/\b(ML|money\s?line|to win|wins?|win outright)\b/i.test(t) && !/[+-]\d/.test(t)) {
    return { status: margin > 0 ? "hit" : margin < 0 ? "miss" : "push", note: scoreLine(g) };
  }
  const m = t.match(/(?:^|\s)([+-]\s?\d+(?:\.\d+)?)(?=\s|$)/);
  const line = m ? Number(m[1].replace(/\s/g, "")) : /\b(cover|covers|ats|spread)\b/i.test(t) ? g.lines?.spread?.[side]?.line : null;
  if (line == null) return { status: "manual", note: "can't read the line" };
  const res = margin + line;
  return { status: res > 0 ? "hit" : res < 0 ? "miss" : "push", note: `${scoreLine(g)} (${line > 0 ? "+" : ""}${line})` };
};

// The leg(s) that broke the parlay: the first to go down, not just any miss.
// "First" = the earliest game among the misses; legs that lost in the same
// kickoff window broke it together. Once a results post has named a breaker
// (opts.breakers, from the previous post) it sticks, so a later game can't
// steal the blame.
export const gradeSlip = (slip, slate, opts = {}) => {
  const legs = slip.legs.map((l) => ({ ...l, ...gradeLeg(l.leg, slate, opts), kickoffMs: analyzeLeg(l.leg, slate, { playerTeams: opts.playerTeams || {} }).game?.kickoffMs ?? Infinity }));
  const count = (s) => legs.filter((l) => l.status === s).length;
  const misses = legs.filter((l) => l.status === "miss");
  let breakers = misses.filter((l) => (opts.breakers || []).includes(l.team));
  if (!breakers.length && misses.length) { const first = Math.min(...misses.map((l) => l.kickoffMs)); breakers = misses.filter((l) => l.kickoffMs === first); }
  for (const l of breakers) l.broke = true;
  const allDecided = legs.every((l) => ["hit", "push"].includes(l.status));
  const verdict = misses.length ? "miss" : allDecided && !slip.placerPicks.length && legs.length ? "hit" : null;
  return { week: slip.week, legs, placerPicks: slip.placerPicks, verdict, breakers, alsoMissed: misses.filter((l) => !l.broke), bustedBy: breakers[0] || null, counts: { hit: count("hit"), miss: count("miss"), push: count("push"), pending: count("pending"), manual: count("manual") } };
};
// teams a previous results post marked 💥 (Slack may spell it :boom:)
export const breakersFromResults = (text) => [...String(text || "").matchAll(/^(?:💥|:boom:) \*(.+?)\* — /gm)].map((m) => m[1]);

const ICON = { broke: "💥", hit: "✅", miss: "❌", push: "➖", pending: "⏳", manual: "❓" };
// Slack stores emoji as :shortcodes: in message text, so match either spelling
export const isResultsPost = (text, week) => new RegExp(`^(?:📊|:bar_chart:) \\*Week ${week} results\\*`).test(String(text || ""));
export const isVerdictPost = (text, week) => new RegExp(`(?:🏁|:checkered_flag:) \\*Week ${week} parlay: (?:HIT|MISS)\\*`).test(String(text || ""));
// same message? (ignores emoji spelling, Slack's &amp; escaping and whitespace) - so an unchanged result isn't re-edited every tick
export const sameText = (a, b) => {
  const c = (s) => String(s || "").replace(/:[a-z0-9_+'-]+:/g, "").replace(/[\u{1F000}-\u{1FFFF}\u2600-\u27BF\u2B00-\u2BFF\u23E9-\u23FA\u2796\uFE0F]/gu, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();
  return c(a) === c(b);
};

export const renderResults = (r) => {
  const c = r.counts, bits = [`${c.hit} ✅`, c.miss && `${c.miss} ❌${r.breakers.length ? ` (💥 ${r.breakers.map((l) => l.team).join(" & ")})` : ""}`, c.push && `${c.push} ➖`, c.pending && `${c.pending} ⏳`, c.manual && `${c.manual} ❓`].filter(Boolean);
  const rows = r.legs.map((l) => `${ICON[l.broke ? "broke" : l.status]} *${l.team}* — ${l.leg} _(${l.note})_${l.broke ? " — *broke the parlay*" : ""}`).join("\n");
  const tail = [];
  if (c.manual) tail.push("_❓ = the bot can't grade it - reply *hit* or *miss* if it decides the parlay._");
  if (r.placerPicks.length && r.verdict !== "miss") tail.push(`_Placer's picks for ${r.placerPicks.join(", ")} aren't on the slip - placer, reply *hit* or *miss* when they settle._`);
  return `📊 *Week ${r.week} results* · ${bits.join(" · ")}${r.verdict ? ` · parlay *${r.verdict.toUpperCase()}*` : ""}\n${rows}${tail.length ? `\n${tail.join("\n")}` : ""}`;
};
const names = (ls) => ls.map((l) => `*${l.team}* (${l.leg}: ${l.note})`);
const joinAnd = (xs) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}` : xs[0]);
export const renderVerdict = (r) => {
  if (r.verdict === "hit") return `🏁 *Week ${r.week} parlay: HIT* 🎉 — all ${r.legs.length} legs cashed. Somebody check that the bet was actually placed.`;
  const b = r.breakers, together = b.length > 1;
  const slot = together && Number.isFinite(b[0].kickoffMs) ? ` in the ${new Date(b[0].kickoffMs).toLocaleString("en-US", { timeZone: "America/New_York", weekday: "long", hour: "numeric", minute: "2-digit" }).replace(":00", "")} ET games` : "";
  const head = together ? `💥 Broken by ${joinAnd(names(b))} - they went down together${slot}.` : `💥 Broken by ${names(b)[0]} - the first leg to go down.`;
  const also = r.alsoMissed.length ? ` Also missed: ${r.alsoMissed.map((l) => `${l.team} (${l.leg})`).join(", ")}.` : "";
  return `🏁 *Week ${r.week} parlay: MISS* — ${head}${also} ${["Next week.", "There's always next week.", "The books thank you for your business."][r.week % 3]}`;
};
