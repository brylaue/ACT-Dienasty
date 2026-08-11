import { browser } from "$app/environment";

/*
  Trade-o-Meter analysis engine.

  Pulls live dynasty trade values from FantasyCalc (superflex, 0.5 PPR,
  12-team - matching this league's settings) and grades completed trades.
  Values are cached in localStorage for 6 hours so the whole transactions
  page costs a single extra request at most.
*/

const FC_URL =
  "https://api.fantasycalc.com/values/current?isDynasty=true&numQbs=2&numTeams=12&ppr=0.5";
const CACHE_KEY = "fcValuesV1";
const CACHE_TTL = 6 * 60 * 60 * 1000; // 6 hours

let valuesPromise = null;

export const getTradeValues = () => {
  if (valuesPromise) return valuesPromise;
  valuesPromise = loadValues();
  return valuesPromise;
};

const loadValues = async () => {
  // try localStorage cache first
  if (browser) {
    try {
      const cached = JSON.parse(localStorage.getItem(CACHE_KEY));
      if (cached && Date.now() - cached.ts < CACHE_TTL) {
        return cached.data;
      }
    } catch (e) {
      /* ignore corrupt cache */
    }
  }

  const res = await fetch(FC_URL);
  if (!res.ok) throw new Error("FantasyCalc unavailable");
  const raw = await res.json();

  const players = {};
  const picks = [];
  for (const entry of raw) {
    const sleeperId = entry.player?.sleeperId;
    if (entry.player?.position === "PICK") {
      picks.push({ name: entry.player.name, value: entry.value });
    } else if (sleeperId) {
      players[sleeperId] = entry.value;
    }
  }
  const data = { players, picks };

  if (browser) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), data }));
    } catch (e) {
      /* storage full - not a problem */
    }
  }
  return data;
};

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

const hashString = (str) => {
  let h = 0;
  for (let i = 0; i < String(str).length; i++) {
    h = (h * 31 + String(str).charCodeAt(i)) >>> 0;
  }
  return h;
};

const VERDICTS = {
  even: [
    "A fair trade? In THIS league? Groundbreaking.",
    "{W} and {L} shook hands and somehow nobody got robbed.",
    "Perfectly balanced, as all trades should be.",
    "The calculator calls it even. The group chat will not.",
    "Two adults made a reasonable decision. Suspicious.",
  ],
  edge: [
    "{W} nudges ahead on paper. {L} calls it 'a vibes pick.'",
    "The math likes {W}. {L} liked the highlight tape.",
    "{W} wins the spreadsheet — {L} better hope the film wins the season.",
    "Slight edge to {W}. Nothing a hamstring injury can't reverse.",
    "{W} comes out ahead, but not enough to gloat in the chat. (They will anyway.)",
  ],
  clear: [
    "{W} wins this one comfortably. {L}, blink twice if you need help.",
    "The calculator has {W} up big. {L} is officially 'trusting their gut.'",
    "{W} got the better end and everyone at the draft table knows it.",
    "Solid win for {W}. {L} is already drafting the 'you'll see' text.",
  ],
  fleece: [
    "🚨 FLEECE ALERT: the league office should investigate {W} immediately.",
    "{L} woke up and chose charity. {W} gladly accepted the donation.",
    "This isn't a trade, it's a heist. {W} didn't even wear a mask.",
    "Somewhere a trade calculator is filing a police report on behalf of {L}.",
    "{W} would like to thank {L} for their generous contribution to the cause.",
  ],
};

const gradeFor = (gapPct, isWinner) => {
  if (gapPct < 0.08) return "B+";
  if (gapPct < 0.2) return isWinner ? "A-" : "B";
  if (gapPct < 0.4) return isWinner ? "A" : "C+";
  return isWinner ? "A+" : "D";
};

/*
  Analyze a digested trade transaction (2-team trades only).
  Returns null when the trade can't be meaningfully graded.
*/
export const analyzeTrade = (transaction, values, teamNames) => {
  if (transaction.type != "trade") return null;
  if (transaction.rosters.length != 2) return null; // 3-team chaos: not today

  const sides = transaction.rosters.map((rosterID, ix) => ({
    rosterID,
    name: teamNames[ix] || `Team ${rosterID}`,
    total: 0,
    assets: [],
    unknowns: 0,
  }));

  for (const move of transaction.moves) {
    for (let ix = 0; ix < move.length; ix++) {
      const asset = move[ix];
      if (!asset || asset === "origin" || typeof asset !== "object") continue;
      if (asset.player) {
        const v = values.players[asset.player];
        if (v == null) {
          sides[ix].unknowns++;
        } else {
          sides[ix].total += v;
        }
      } else if (asset.pick) {
        sides[ix].total += valueForPick(
          values.picks,
          asset.pick.season,
          asset.pick.round,
        );
      } else if (asset.budget) {
        // FAAB dollars are worth roughly a late-round dart throw
        sides[ix].total += asset.budget.amount * 2;
      }
    }
  }

  if (sides[0].total + sides[1].total < 100) return null; // nothing gradeable

  const [a, b] = sides;
  const winner = a.total >= b.total ? a : b;
  const loser = a.total >= b.total ? b : a;
  const gapPct = (winner.total - loser.total) / Math.max(loser.total, 1);

  let tier = "even";
  if (gapPct >= 0.4) tier = "fleece";
  else if (gapPct >= 0.2) tier = "clear";
  else if (gapPct >= 0.08) tier = "edge";

  const lines = VERDICTS[tier];
  const line = lines[hashString(transaction.id) % lines.length]
    .replace(/\{W\}/g, winner.name)
    .replace(/\{L\}/g, loser.name);

  return {
    sides,
    winner,
    loser,
    gapPct,
    tier,
    verdict: line,
    grades: {
      [winner.rosterID]: gradeFor(gapPct, true),
      [loser.rosterID]: gradeFor(gapPct, false),
    },
  };
};
