import { browser } from "$app/environment";
import { classifyTrade, gradeFor } from "./tradeClassification";

/*
  Trade-o-Meter analysis engine.

  Pulls live dynasty trade values from FantasyCalc (superflex, 0.5 PPR,
  12-team - matching this league's settings) and grades completed trades.
  Values are cached in localStorage for 6 hours so the whole transactions
  page costs a single extra request at most.
*/

export { classifyTrade, valueForPick } from "./tradeClassification";

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

/*
  Analyze a digested trade transaction (any number of teams) and attach a
  comedic verdict line. If a fresh, AI-written line for this exact
  transaction is available (baked weekly into static/data/commentary.json,
  keyed by transaction id), that's used - so every trade gets its own take
  instead of picking from a small repeating pool. Falls back to the
  template pool for trades that haven't gone through a bake cycle yet.
*/
export const analyzeTrade = (transaction, values, teamNames, commentary) => {
  const classified = classifyTrade(transaction, values);
  if (!classified) return null;
  const { totals, winnerIx, loserIx, gapPct, tier } = classified;

  const sides = transaction.rosters.map((rosterID, ix) => ({
    rosterID,
    name: teamNames[ix] || `Team ${rosterID}`,
    total: totals[ix],
  }));
  const winner = sides[winnerIx];
  const loser = sides[loserIx];

  const template =
    commentary?.trades?.[transaction.id] ||
    VERDICTS[tier][hashString(transaction.id) % VERDICTS[tier].length];
  const line = template
    .replace(/\{W\}/g, winner.name)
    .replace(/\{L\}/g, loser.name);

  return {
    sides,
    winner,
    loser,
    gapPct,
    tier,
    verdict: line,
    grades: Object.fromEntries(sides.map((side) => [
      side.rosterID,
      side === winner ? gradeFor(gapPct, true) : side === loser ? gradeFor(gapPct, false) : "B",
    ])),
  };
};
