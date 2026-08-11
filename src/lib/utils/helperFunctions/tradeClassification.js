/*
  Pure, name-agnostic trade value classification. No framework imports
  (no $app/environment, no svelte stores) so this can run identically in the
  browser (via tradeAnalysis.js) and in the plain-Node bake script
  (scripts/build-commentary.mjs).
*/

const ordinal = (n) =>
  n + (["th", "st", "nd", "rd"][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10] || "th");

// Estimate a pick's value: average all FantasyCalc entries matching that
// season + round (e.g. all "2026 Pick 2.xx" slots, or "2027 2nd (Early/Mid/Late)")
export const valueForPick = (picks, season, round) => {
  const specific = new RegExp(`^${season} Pick ${round}\\.`);
  const general = new RegExp(`^${season} ${ordinal(round)}`);
  const matches = picks.filter(
    (p) => specific.test(p.name) || general.test(p.name),
  );
  if (matches.length) {
    return Math.round(
      matches.reduce((sum, p) => sum + p.value, 0) / matches.length,
    );
  }
  // fallback for rounds FantasyCalc doesn't track (4th+ rounders, far-future)
  const fallback = { 1: 2500, 2: 800, 3: 300 };
  return fallback[round] || 100;
};

/*
  Classify a 2-team trade: which side (by index 0/1) comes out ahead and by
  how much. No team names involved.
  Returns null when the trade can't be meaningfully graded.
*/
export const classifyTrade = (transaction, values) => {
  if (transaction.type != "trade") return null;
  if (transaction.rosters.length != 2) return null; // 3-team chaos: not today

  const totals = transaction.rosters.map(() => 0);

  for (const move of transaction.moves) {
    for (let ix = 0; ix < move.length; ix++) {
      const asset = move[ix];
      if (!asset || asset === "origin" || typeof asset !== "object") continue;
      if (asset.player) {
        const v = values.players[asset.player];
        if (v != null) totals[ix] += v;
      } else if (asset.pick) {
        totals[ix] += valueForPick(
          values.picks,
          asset.pick.season,
          asset.pick.round,
        );
      } else if (asset.budget) {
        // FAAB dollars are worth roughly a late-round dart throw
        totals[ix] += asset.budget.amount * 2;
      }
    }
  }

  if (totals[0] + totals[1] < 100) return null; // nothing gradeable

  const winnerIx = totals[0] >= totals[1] ? 0 : 1;
  const loserIx = winnerIx === 0 ? 1 : 0;
  const gapPct =
    (totals[winnerIx] - totals[loserIx]) / Math.max(totals[loserIx], 1);

  let tier = "even";
  if (gapPct >= 0.4) tier = "fleece";
  else if (gapPct >= 0.2) tier = "clear";
  else if (gapPct >= 0.08) tier = "edge";

  return { totals, winnerIx, loserIx, gapPct, tier };
};

export const gradeFor = (gapPct, isWinner) => {
  if (gapPct < 0.08) return "B+";
  if (gapPct < 0.2) return isWinner ? "A-" : "B";
  if (gapPct < 0.4) return isWinner ? "A" : "C+";
  return isWinner ? "A+" : "D";
};
