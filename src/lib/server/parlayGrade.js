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
    const leg = m[2].replace(/\s\((?:[+\-−]?\d+|n\/a|no line)\)$/, "").trim(); // drop the odds tag
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
        const p = (players[n] ||= { name: a.athlete.displayName, team, passTd: 0, passYds: 0, rushTd: 0, rushYds: 0, rec: 0, recYds: 0, recTd: 0, retTd: 0, defTd: 0 });
        const v = (key) => { const i = col(s, key); return i < 0 ? 0 : Number(a.stats?.[i]) || 0; };
        if (s.name === "passing") { p.passTd += v("passingTouchdowns"); p.passYds += v("passingYards"); }
        if (s.name === "rushing") { p.rushTd += v("rushingTouchdowns"); p.rushYds += v("rushingYards"); }
        if (s.name === "receiving") { p.rec += v("receptions"); p.recYds += v("receivingYards"); p.recTd += v("receivingTouchdowns"); }
        if (s.name === "kickReturns") p.retTd += v("kickReturnTouchdowns");
        if (s.name === "puntReturns") p.retTd += v("puntReturnTouchdowns");
        if (s.name === "interceptions") p.defTd += v("interceptionTouchdowns");
        if (s.name === "defensive") p.defTd += v("defensiveTouchdowns");
      }
    }
  }
  return { state: st.state || "pre", final: !!st.completed, players };
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
};
const UNIT = { tds: "TD", pass_tds: "passing TD", pass_yds: "passing yd", rush_yds: "rushing yd", rec_yds: "receiving yd", yds: "scrimmage yd", receptions: "catch" };
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
    if (!prop || !STAT[prop.stat]) return { status: "manual", note: prop?.stat === "first_td" ? "first-TD props need a human call" : "can't read this prop" };
    const box = boxes[g.id];
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

export const gradeSlip = (slip, slate, opts = {}) => {
  const legs = slip.legs.map((l) => ({ ...l, ...gradeLeg(l.leg, slate, opts) }));
  const count = (s) => legs.filter((l) => l.status === s).length;
  const miss = legs.find((l) => l.status === "miss") || null;
  const allDecided = legs.every((l) => ["hit", "push"].includes(l.status));
  const verdict = miss ? "miss" : allDecided && !slip.placerPicks.length && legs.length ? "hit" : null;
  return { week: slip.week, legs, placerPicks: slip.placerPicks, verdict, bustedBy: miss, counts: { hit: count("hit"), miss: count("miss"), push: count("push"), pending: count("pending"), manual: count("manual") } };
};

const ICON = { hit: "✅", miss: "❌", push: "➖", pending: "⏳", manual: "❓" };
// Slack stores emoji as :shortcodes: in message text, so match either spelling
export const isResultsPost = (text, week) => new RegExp(`^(?:📊|:bar_chart:) \\*Week ${week} results\\*`).test(String(text || ""));
export const isVerdictPost = (text, week) => new RegExp(`(?:🏁|:checkered_flag:) \\*Week ${week} parlay: (?:HIT|MISS)\\*`).test(String(text || ""));
// same message? (ignores emoji spelling, Slack's &amp; escaping and whitespace) - so an unchanged result isn't re-edited every tick
export const sameText = (a, b) => {
  const c = (s) => String(s || "").replace(/:[a-z0-9_+'-]+:/g, "").replace(/[\u{1F000}-\u{1FFFF}\u2600-\u27BF\u2B00-\u2BFF\u23E9-\u23FA\u2796\uFE0F]/gu, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();
  return c(a) === c(b);
};

export const renderResults = (r) => {
  const c = r.counts, bits = [`${c.hit} ✅`, c.miss && `${c.miss} ❌`, c.push && `${c.push} ➖`, c.pending && `${c.pending} ⏳`, c.manual && `${c.manual} ❓`].filter(Boolean);
  const rows = r.legs.map((l) => `${ICON[l.status]} *${l.team}* — ${l.leg} _(${l.note})_`).join("\n");
  const tail = [];
  if (c.manual) tail.push("_❓ = the bot can't grade it - reply *hit* or *miss* if it decides the parlay._");
  if (r.placerPicks.length && r.verdict !== "miss") tail.push(`_Placer's picks for ${r.placerPicks.join(", ")} aren't on the slip - placer, reply *hit* or *miss* when they settle._`);
  return `📊 *Week ${r.week} results* · ${bits.join(" · ")}${r.verdict ? ` · parlay *${r.verdict.toUpperCase()}*` : ""}\n${rows}${tail.length ? `\n${tail.join("\n")}` : ""}`;
};
export const renderVerdict = (r) => (r.verdict === "hit"
  ? `🏁 *Week ${r.week} parlay: HIT* 🎉 — all ${r.legs.length} legs cashed. Somebody check that the bet was actually placed.`
  : `🏁 *Week ${r.week} parlay: MISS* — busted by *${r.bustedBy.team}* (${r.bustedBy.leg}: ${r.bustedBy.note}). ${["Next week.", "There's always next week.", "The books thank you for your business."][r.week % 3]}`);
