/*
  Standings position vs power rank, from the power-rankings bake.

  "Rank" on a matchup means where a team sits in the STANDINGS - the same
  order as the Standings page: wins, then ties, then points for. The power
  rank is the site's composite and is shown alongside, never instead.
*/
let cache = null;

const seedOrder = (a, b) =>
  (b.wins ?? 0) - (a.wins ?? 0) || (b.ties ?? 0) - (a.ties ?? 0) || (b.fpts ?? 0) - (a.fpts ?? 0);

// synchronous: pass the already-loaded power-rankings json
export const ranksFromPowerRankings = (pr) => {
  const teams = Array.isArray(pr?.teams) ? pr.teams : [];
  const seeded = [...teams].filter((t) => t.wins != null).sort(seedOrder);
  const out = {};
  seeded.forEach((t, i) => {
    out[t.rosterID] = {
      seed: i + 1,
      record: `${t.wins}-${t.losses}${t.ties ? `-${t.ties}` : ""}`,
      pr: t.rank ?? null,
      name: String(t.name || "").trim(),
    };
  });
  return out;
};

// async + cached: for components that don't already have the bake
export const loadTeamRanks = async () => {
  if (!cache) {
    cache = fetch("/data/power-rankings.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((pr) => ({ week: pr?.week ?? null, byRoster: ranksFromPowerRankings(pr) }))
      .catch(() => ({ week: null, byRoster: {} }));
  }
  return cache;
};
