/*
  "Who is the dumbest owner in the league?" - answered with receipts.
  Pure: takes the site's baked knowledge pack (static/data/knowledge.json)
  and trade commentary (static/data/commentary.json) and ranks every
  franchise on things a manager actually controls or answers for:
    - all-time record (win %) and titles
    - lineup efficiency: share of the optimal lineup's points actually started, career
    - this season's standing
    - worst bench weeks in league history, and trades this season they lost badly
  Lowest combined rank = dumbest; highest = smartest. Team names only - no
  @mentions, so nobody gets pinged into their own roast.
*/

const pct = (x) => `${Math.round(x * 100)}%`;
const ordinal = (n) => `${n}${["th", "st", "nd", "rd"][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10 < 4 ? n % 10 : 0] || "th"}`;

// "Who is the dumbest owner?" → "worst"; "who's the smartest manager?" → "best"; anything else → null
export const roastIntent = (text) => {
  const q = String(text || "").toLowerCase();
  if (/\b(bet|bets|leg|legs|parlay|pick|picks|odds|line|lock)\b/.test(q.replace(/parlay builder/g, ""))) return null; // "best bet tonight", "worst leg" - parlay questions, not a roast
  if (!/\b(owner|manager|gm|person|guy|team|franchise|drafter|trader|player in (?:the|this) league|in (?:the|this) league)\b/.test(q)) return null;
  if (/\b(dumbest|stupidest|worst|dumb|idiot|clueless|biggest (?:idiot|loser|clown|fool|moron)|least (?:smart|intelligent|competent)|most (?:clueless|incompetent)|moron|clown|bum)\b/.test(q)) return "worst";
  if (/\b(smartest|best|goat|sharpest|most (?:competent|intelligent)|genius)\b/.test(q)) return "best";
  return null;
};

// one row per franchise with the numbers that matter
export const franchiseStats = (knowledge, commentary = {}) => {
  const fr = knowledge?.franchises || [];
  const seasons = knowledge?.seasons || [];
  const current = seasons.find((s) => s.status === "in_season") || null;
  const rows = fr.map((f) => {
    let started = 0, optimal = 0;
    for (const s of seasons) {
      const st = (s.standings || []).find((x) => x.rosterID === f.rosterID);
      const m = String(st?.lineupEfficiency || "").match(/started ([\d.]+) of an optimal ([\d.]+)/);
      if (m) { started += Number(m[1]); optimal += Number(m[2]); }
    }
    const games = f.w + f.l;
    return { rosterID: f.rosterID, name: f.name.trim(), w: f.w, l: f.l, winPct: games ? f.w / games : 0, titles: f.titles || 0, seasons: f.seasons || 0, eff: optimal ? started / optimal : null, benchLeft: optimal - started, blunders: [], badTrades: [], now: null };
  });
  const byId = new Map(rows.map((r) => [r.rosterID, r]));
  const byName = new Map(rows.map((r) => [r.name.toLowerCase(), r]));
  // the league's worst bench weeks: "Dirty Birds left 92.02 pts on the bench (2019 Wk 13: ...)"
  for (const b of knowledge?.benchBlunders || []) {
    const m = String(b).match(/^(.+?) left ([\d.]+) pts on the bench \((\d{4}) Wk (\d+)/);
    const r = m && byName.get(m[1].trim().toLowerCase());
    if (r) r.blunders.push({ pts: Number(m[2]), year: Number(m[3]), week: Number(m[4]) });
  }
  // trades this season that went clearly against them (FantasyCalc value at the time)
  for (const t of Object.values(commentary?.tradeMeta || {})) {
    if (!["fleece", "clear"].includes(t.tier)) continue;
    t.rosters.forEach((rid, i) => {
      if (rid === t.winnerRoster) return;
      const lost = Array.isArray(t.net) ? -t.net[i] : null;
      if (Array.isArray(t.net) && !(lost > 0)) return; // three-way deals: only the side that actually came out behind
      byId.get(rid)?.badTrades.push({ gapPct: t.gapPct, lost, tier: t.tier, at: t.at, partner: t.rosters.filter((x) => x !== rid).map((x) => byId.get(x)?.name).filter(Boolean) });
    });
  }
  // this season's place (wins, then points)
  if (current) {
    const order = [...current.standings].sort((a, b) => b.w - a.w || b.pf - a.pf);
    order.forEach((s, i) => { const r = byId.get(s.rosterID); if (r) r.now = { place: i + 1, of: order.length, w: s.w, l: s.l, year: current.year }; });
  }
  return rows;
};

// rank-sum across the measures; lower = dumber
export const rankFranchises = (rows) => {
  const rankBy = (key, dir = 1) => { const s = [...rows].filter((r) => r[key] != null).sort((a, b) => dir * (a[key] - b[key])); return new Map(s.map((r, i) => [r.rosterID, i + 1])); };
  const win = rankBy("winPct"), eff = rankBy("eff"), titles = rankBy("titles");
  const now = new Map([...rows].filter((r) => r.now).sort((a, b) => b.now.place - a.now.place).map((r, i) => [r.rosterID, i + 1]));
  const n = rows.length;
  return rows.map((r) => ({
    ...r,
    score: (win.get(r.rosterID) ?? n) * 2 + (eff.get(r.rosterID) ?? n) + (now.get(r.rosterID) ?? n) + (titles.get(r.rosterID) ?? n) * 0.5 - r.blunders.length * 2 - r.badTrades.length * 2,
    ranks: { win: win.get(r.rosterID), eff: eff.get(r.rosterID), now: now.get(r.rosterID) },
  })).sort((a, b) => a.score - b.score);
};

const effRankText = (r, n) => `${ordinal(n - r.ranks.eff + 1)}-best of ${n}`;
const evidence = (r, n, mode) => {
  const lines = [];
  lines.push(`${mode === "worst" && r.ranks.win <= 2 ? (r.ranks.win === 1 ? "Worst" : "Second-worst") + " all-time record" : mode === "best" && r.ranks.win >= n - 1 ? (r.ranks.win === n ? "Best" : "Second-best") + " all-time record" : "All-time"}: *${r.w}-${r.l}* (${pct(r.winPct)})${r.titles ? ` · ${r.titles} title${r.titles > 1 ? "s" : ""}` : ` · 0 titles in ${r.seasons} seasons`}`);
  if (r.eff != null) lines.push(`Lineups: started ${pct(r.eff)} of the points they had on the roster, career - ${effRankText(r, n)}${mode === "worst" ? ` (${Math.round(r.benchLeft).toLocaleString()} pts left on the bench)` : ""}`);
  if (r.now) lines.push(`${r.now.year}: ${ordinal(r.now.place)} of ${r.now.of} (${r.now.w}-${r.now.l})`);
  if (mode === "worst") {
    const b = [...r.blunders].sort((x, y) => y.pts - x.pts)[0];
    if (b) lines.push(`Hall of shame: left *${b.pts} pts* on the bench in ${b.year} Week ${b.week}${r.blunders.length > 1 ? ` (and ${r.blunders.length - 1} more of the league's ${r.blunders.length > 2 ? "worst" : "five worst"} bench weeks)` : " - one of the five worst bench weeks in league history"}`);
    const t = [...r.badTrades].sort((x, y) => y.gapPct - x.gapPct)[0];
    if (t) lines.push(`Got ${t.tier === "fleece" ? "fleeced" : "beat"} by ${t.partner.join(" & ")} in a trade this season (${t.lost ? `${Math.round(t.lost).toLocaleString()} in value` : `${pct(t.gapPct)} less value`})`);
  }
  return lines;
};

export const renderRoast = (knowledge, commentary, mode = "worst") => {
  const ranked = rankFranchises(franchiseStats(knowledge, commentary));
  if (!ranked.length) return null;
  const n = ranked.length;
  const list = mode === "best" ? [...ranked].reverse() : ranked;
  const [top, second] = list;
  const head = mode === "best" ? `🧠 *Smartest owner in the league, by the numbers: ${top.name}.*` : `🧠 *Dumbest owner in the league, by the numbers: ${top.name}.*`;
  const body = evidence(top, n, mode).map((l) => `• ${l}`).join("\n");
  const tail = second ? `_Runner-up: ${second.name} (${second.w}-${second.l}${second.eff != null ? `, ${pct(second.eff)} lineups` : ""}). ${mode === "best" ? "Humble brags welcome." : "Numbers don't lie; feelings may vary."}_` : "";
  return `${head}\n${body}${tail ? `\n${tail}` : ""}`;
};
