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
  Classify a trade with any number of teams. Each side is graded on the
  value it RECEIVED minus the value it SENT; the winner is the side with
  the biggest net gain, the loser the biggest net loss. For two-team trades
  this reduces exactly to comparing what each side received. No team names.
  Returns null when the trade can't be meaningfully graded.
*/
export const classifyTrade = (transaction, values) => {
  if (transaction.type != "trade") return null;
  const n = transaction.rosters.length;
  if (n < 2) return null;

  const received = transaction.rosters.map(() => 0);
  const sent = transaction.rosters.map(() => 0);

  for (const move of transaction.moves) {
    let value = 0;
    let destIx = -1;
    let originIx = -1;
    for (let ix = 0; ix < move.length; ix++) {
      const asset = move[ix];
      if (asset === "origin") { originIx = ix; continue; }
      if (!asset || typeof asset !== "object") continue;
      destIx = ix;
      if (asset.player) {
        const v = values.players[asset.player];
        if (v != null) value += v;
      } else if (asset.pick) {
        value += valueForPick(values.picks, asset.pick.season, asset.pick.round);
      } else if (asset.budget) {
        // FAAB dollars are worth roughly a late-round dart throw
        value += asset.budget.amount * 2;
      }
    }
    if (destIx >= 0) received[destIx] += value;
    if (originIx >= 0) sent[originIx] += value;
  }

  const moved = received.reduce((a, b) => a + b, 0);
  if (moved < 100) return null; // nothing gradeable

  const net = received.map((r, ix) => r - sent[ix]);
  let winnerIx = 0, loserIx = 0;
  for (let ix = 1; ix < n; ix++) {
    if (net[ix] > net[winnerIx]) winnerIx = ix;
    if (net[ix] < net[loserIx]) loserIx = ix;
  }
  if (n === 2) {
    // preserve the original two-team formula so historical tradeMeta stays comparable
    winnerIx = received[0] >= received[1] ? 0 : 1;
    loserIx = winnerIx === 0 ? 1 : 0;
  }
  const gapPct = n === 2
    ? (received[winnerIx] - received[loserIx]) / Math.max(received[loserIx], 1)
    : (net[winnerIx] - net[loserIx]) / Math.max(moved / n, 1);

  let tier = "even";
  if (gapPct >= 0.4) tier = "fleece";
  else if (gapPct >= 0.2) tier = "clear";
  else if (gapPct >= 0.08) tier = "edge";

  return { totals: received, sent, net, winnerIx, loserIx, gapPct, tier, teams: n };
};

export const gradeFor = (gapPct, isWinner) => {
  if (gapPct < 0.08) return "B+";
  if (gapPct < 0.2) return isWinner ? "A-" : "B";
  if (gapPct < 0.4) return isWinner ? "A" : "C+";
  return isWinner ? "A+" : "D";
};
